/**
 * ScriptDlgService — `PACKETTYPE_SCRIPTDLG` (0x00ff00b0).
 *
 * `DPSrvr::OnScriptDialogReq` (DPSrvr.cpp:807-879) reads:
 *   OBJID objid   String key(256)   int nGlobal1..nGlobal4
 *
 * Flow (all gated by the 400ms `__QUEST_1208` rate-limit):
 *   1. Resolve the NPC (`prj.GetMover(objid)`) + distance gate
 *      (`MAX_LEN_MOVER_MENU = 1024` squared, npchecker.h:4).
 *   2. Run the NPC's dialog script for the pressed key. The simple subset
 *      (`Speak` → broadcast chat; `LaunchQuest` → begin quest) is executed here;
 *      advanced states (`source` bodies with `EndQuest`/`SetQuestState`/item
 *      ops) are not yet ported — `ponytail`.
 *   3. Post-dialog sweep (DPSrvr.cpp:859-875): scan `m_aQuest` for an active
 *      quest whose `SetEndCondDialog` (PROJECT.CPP:1974) charKey matches the
 *      NPC and addKey matches the pressed key → set `m_bDialog` → SETQUEST.
 *
 * v15 note: propQuest.inc uses `SetEndCondCharacter` (the "meet NPC" UI hint),
 * not `SetEndCondDialog` (the sweep trigger), so the sweep is dormant on v15
 * data — but it is the C++ spec, cheap, and future-proofs the engine. The real
 * quest trigger is the dialog script calling `EndQuest`/`BeginQuest`, blocked
 * on porting the `source` bodies.
 *
 * The service owns no socket bytes (rule 02) — handlers write returned frames.
 *
 * @module services/scriptDlg
 */

import type { DialogIndex, DialogState, QuestDef, QuestIndex } from '@flyff/resources';
import { prefixForNpc, stateForKey, dialogText } from '@flyff/resources';
import type { CPlayer } from '../entities/player.js';
import type { CMover } from '../entities/mover.js';
import type { QuestService } from './quest.service.js';
import { QUEST_FLAG } from '@flyff/core/constants/quest.js';
import { buildSetQuest } from '../net/snapshot/quest.serializer.js';
import { ChatSerializer } from '../net/snapshot/chat.serializer.js';
import { ScriptDialogSerializer, type ScriptFunc } from '../net/snapshot/scriptDialog.serializer.js';

/** C++ `__QUEST_1208` rate limit (`DPSrvr.cpp:824`). */
const SCRIPT_DLG_COOLDOWN_MS = 400;

/** C++ reads `lpKey[256]` — wire string can be up to 255 chars. */
const MAX_SCRIPT_KEY = 255;

/** C++ `MAX_LEN_MOVER_MENU` (npchecker.h:4) — squared distance gate. */
const MAX_LEN_MOVER_MENU_SQ = 1024;

export interface ScriptDlgFrame {
  objid: number;
  key: string;
  nGlobal1: number;
  nGlobal2: number;
  nGlobal3: number;
  nGlobal4: number;
}

/** SpawnManager surface this service consumes (just the objid lookup). */
export interface ScriptDlgSpawnLookup {
  get(id: number): CMover | undefined;
}

export interface ScriptDlgDeps {
  spawnManager: ScriptDlgSpawnLookup;
  dialogs: DialogIndex;
  quests: QuestIndex;
  questService: QuestService;
  /** Chat serializer for `Speak` broadcast text. Injected for testability. */
  chat?: ChatSerializer;
  /** RUNSCRIPTFUNC serializer for the per-clicker dialog menu. Testable. */
  scriptDialog?: ScriptDialogSerializer;
}

export type ScriptDlgResult =
  | { ok: true; frames: Buffer[] }
  | { ok: false; reason: 'rate_limited' | 'invalid_target' | 'key_too_long' | 'too_far' };

/** Squared 3D distance — matches C++ `D3DXVec3LengthSq`. */
function distSq(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Extract the `(charKey, addKey)` pair from a quest's `SetEndCondDialog` call
 * (PROJECT.CPP:1978/1981). Returns `undefined` when the quest has no such
 * condition — the sweep skips it.
 */
function endCondDialog(def: QuestDef): { charKey: string; addKey: string } | undefined {
  for (const c of def.commands) {
    if (c.cmd !== 'SetEndCondDialog') continue;
    const charKey = c.args[0]?.value;
    const addKey = c.args[1]?.value;
    if (typeof charKey === 'string' && typeof addKey === 'string')
      return { charKey, addKey };
  }
  return undefined;
}

export class ScriptDlgService {
  private readonly chat: ChatSerializer;
  private readonly scriptDialog: ScriptDialogSerializer;
  constructor(private deps: ScriptDlgDeps) {
    this.chat = deps.chat ?? new ChatSerializer();
    this.scriptDialog = deps.scriptDialog ?? new ScriptDialogSerializer();
  }

  /**
   * `DPSrvr::OnScriptDialogReq` — rate-limit + distance gate, run the simple
   * dialog subset, then the post-dialog sweep. Returns outbound frames for the
   * handler to write. `Date.now()` is injected by the handler (testable).
   */
  async dialog(player: CPlayer, frame: ScriptDlgFrame, now: number): Promise<ScriptDlgResult> {
    if (now - player.m_tickScript < SCRIPT_DLG_COOLDOWN_MS)
      return { ok: false, reason: 'rate_limited' };
    if (frame.key.length > MAX_SCRIPT_KEY)
      return { ok: false, reason: 'key_too_long' };

    const npc = this.deps.spawnManager.get(frame.objid);
    if (!npc?.outfit)
      return { ok: false, reason: 'invalid_target' };
    if (distSq(player.m_vPos, npc.m_vPos) > MAX_LEN_MOVER_MENU_SQ)
      return { ok: false, reason: 'too_far' };

    player.m_tickScript = now;
    const frames: Buffer[] = [];
    const npcKey = npc.outfit.characterKey;

    await this.runState(player, npc, npcKey, frame.key, frames);
    this.sweepDialogCond(player, npcKey, frame.key, frames);
    return { ok: true, frames };
  }

  /**
   * Resolve + execute the dialog state for the pressed key. Emits the per-clicker
   * menu (`Say` body + `AddKey` buttons + `Exit`) as a RUNSCRIPTFUNC frame, the
   * `Speak` lines as broadcast chat (C++ `ScriptLib.cpp:40` → `AddChat`), and
   * fires `LaunchQuest` → `questService.beginQuest` when a quest id is present.
   */
  private async runState(
    player: CPlayer, npc: CMover, npcKey: string, key: string, frames: Buffer[],
  ): Promise<void> {
    const prefix = prefixForNpc(this.deps.dialogs, npcKey);
    if (!prefix) return;
    const keyIdx = keyToIndex(key);
    const state = stateForKey(this.deps.dialogs, prefix, keyIdx);
    if (!state) return;

    this.emitMenu(player, state, frames);

    for (const n of state.speak ?? []) {
      const text = dialogText(this.deps.dialogs, n);
      if (text !== undefined) frames.push(this.chat.build(npc.m_idMover, text));
    }
    if (state.launch_quest && state.launch_quest_id !== undefined) {
      const res = await this.deps.questService.beginQuest(player, state.launch_quest_id);
      if (res.ok) frames.push(...res.frames);
    }
  }

  /**
   * Build the per-user RUNSCRIPTFUNC frame for `state` — the ops a C++
   * `CNpcScript::<prefix>_<idx>` body queues via `AddRunScriptFunc`
   * (`User.cpp:6259`). A leading `RemoveAllKeys` clears any prior button set so
   * each state renders a fresh menu (the client window persists across button
   * clicks and keeps key buttons until cleared — `WndDialog.cpp:710`). The
   * `AddKey` routing key is the target state index stringified so the client's
   * echo round-trips through `keyToIndex`. States with no `say`/`keys`/`exit`
   * (e.g. `speak`-only or `launch_quest`-only) emit no menu frame — matching
   * C++, which queues nothing when the script body calls none of these.
   */
  private emitMenu(player: CPlayer, state: DialogState, frames: Buffer[]): void {
    const funcs: ScriptFunc[] = [];
    for (const n of state.say ?? []) {
      const text = dialogText(this.deps.dialogs, n);
      if (text !== undefined) funcs.push({ type: 'say', text });
    }
    for (const k of state.keys ?? []) {
      const word = dialogText(this.deps.dialogs, k.label) ?? '';
      const addKey: Extract<ScriptFunc, { type: 'addKey' }> = {
        type: 'addKey', word, key: String(k.key ?? k.label),
      };
      if (k.param !== undefined) addKey.param = k.param;
      funcs.push(addKey);
    }
    if (state.exit) funcs.push({ type: 'exit' });
    if (funcs.length === 0) return;
    funcs.unshift({ type: 'removeAllKeys' });
    frames.push(this.scriptDialog.build(player.m_idPlayer, funcs));
  }

  /**
   * DPSrvr.cpp:859-875 — mark the dialog-condition flag on the active quest
   * whose `SetEndCondDialog` matches the talked-to NPC + pressed key. Emits a
   * SETQUEST frame per match so the client quest tracker updates.
   */
  private sweepDialogCond(player: CPlayer, npcKey: string, key: string, frames: Buffer[]): void {
    const keyIdx = String(keyToIndex(key));
    for (const q of player.m_aQuest) {
      const def = this.deps.quests.byId.get(q.id);
      if (!def) continue;
      const cond = endCondDialog(def);
      if (!cond || cond.charKey !== npcKey || cond.addKey !== keyIdx) continue;
      if (q.flags & QUEST_FLAG.DIALOG) continue;
      q.flags |= QUEST_FLAG.DIALOG;
      player._dirty.add('m_aQuest');
      frames.push(buildSetQuest(player.m_idPlayer, q));
      break; // C++ breaks on the first match.
    }
  }
}

/**
 * Dialog states are keyed by stringified index (`"0"`, `"9"`, …). Empty key or
 * `#init` (DPSrvr.cpp:850) routes to state 0; otherwise parse the leading int.
 */
function keyToIndex(key: string): number {
  if (key.length === 0 || key === '#init') return 0;
  const n = parseInt(key, 10);
  return Number.isNaN(n) ? 0 : n;
}
