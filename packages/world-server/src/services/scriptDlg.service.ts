/**
 * ScriptDlgService -- `PACKETTYPE_SCRIPTDLG` (0x00ff00b0).
 *
 * `DPSrvr::OnScriptDialogReq` (DPSrvr.cpp:807-879) reads:
 *   OBJID objid   String key(256)   int nGlobal1..nGlobal4
 *
 * Flow (all gated by the 400ms `__QUEST_1208` rate-limit):
 *   1. Resolve the NPC (`prj.GetMover(objid)`) + distance gate
 *      (`MAX_LEN_MOVER_MENU = 1024` squared, npchecker.h:4).
 *   2. Run the NPC's dialog script for the pressed key. The simple subset
 *      (`Speak` -> broadcast chat; `LaunchQuest` -> begin quest) is executed here;
 *      advanced states (`source` bodies with `EndQuest`/`SetQuestState`/item
 *      ops) are not yet ported -- `ponytail`.
 *   3. Post-dialog sweep (DPSrvr.cpp:859-875): scan `m_aQuest` for an active
 *      quest whose `SetEndCondDialog` (PROJECT.CPP:1974) charKey matches the
 *      NPC and addKey matches the pressed key -> set `m_bDialog` -> SETQUEST.
 *
 * v15 note: propQuest.inc uses `SetEndCondCharacter` (the "meet NPC" UI hint),
 * not `SetEndCondDialog` (the sweep trigger), so the sweep is dormant on v15
 * data -- but it is the C++ spec, cheap, and future-proofs the engine. The real
 * quest trigger is the dialog script calling `EndQuest`/`BeginQuest`, blocked
 * on porting the `source` bodies.
 *
 * The service owns no socket bytes (rule 02) -- handlers write returned frames.
 *
 * @module services/scriptDlg
 */

import type { DialogFile, DialogIndex, DialogState, QuestDef, QuestIndex } from '@flyff/resources';
import { prefixForNpc, stateForKey, dialogText } from '@flyff/resources';
import type { CPlayer } from '../entities/player';
import type { CMover } from '../entities/mover';
import type { QuestService } from './quest.service';
import { QUEST_FLAG } from '@flyff/core/constants/quest';
import { createLogger } from '@flyff/core/logger';
import { buildSetQuest } from '../net/snapshot/quest.serializer';
import { ChatSerializer } from '../net/snapshot/chat.serializer';
import { ScriptDialogSerializer, type ScriptFunc } from '../net/snapshot/scriptDialog.serializer';

const logger = createLogger({ module: 'scriptDlg-service' });

/** C++ `__QUEST_1208` rate limit (`DPSrvr.cpp:824`). */
const SCRIPT_DLG_COOLDOWN_MS = 400;

/** C++ reads `lpKey[256]` -- wire string can be up to 255 chars. */
const MAX_SCRIPT_KEY = 255;

/** C++ `MAX_LEN_MOVER_MENU` (npchecker.h:4) -- squared distance gate. */
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

/** Squared 3D distance -- matches C++ `D3DXVec3LengthSq`. */
function distSq(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Extract the `(charKey, addKey)` pair from a quest's `SetEndCondDialog` call
 * (PROJECT.CPP:1978/1981). Returns `undefined` when the quest has no such
 * condition -- the sweep skips it.
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
   * `DPSrvr::OnScriptDialogReq` -- rate-limit + distance gate, run the simple
   * dialog subset, then the post-dialog sweep. Returns outbound frames for the
   * handler to write. `Date.now()` is injected by the handler (testable).
   */
  async dialog(player: CPlayer, frame: ScriptDlgFrame, now: number): Promise<ScriptDlgResult> {
    if (now - player.m_tickScript < SCRIPT_DLG_COOLDOWN_MS)
      return { ok: false, reason: 'rate_limited' };
    if (frame.key.length > MAX_SCRIPT_KEY)
      return { ok: false, reason: 'key_too_long' };

    const npc = this.deps.spawnManager.get(frame.objid);
    if (!npc)
      return { ok: false, reason: 'invalid_target' };
    if (distSq(player.m_vPos, npc.m_vPos) > MAX_LEN_MOVER_MENU_SQ)
      return { ok: false, reason: 'too_far' };

    player.m_tickScript = now;
    const frames: Buffer[] = [];
    // Dialog prefix is resolved from the propMover key (`MI_MAFL_BOBOKU` ->
    // `mafl_boboku`). C++ keys `CNpcProperty` by the character.inc block, but
    // those outfit blocks aren't parsed yet (raw/README.md); `m_szKey` carries
    // the same identity in MI_* form, which `prefixForNpc` strips + lowercases.
    const npcKey = npc.m_szKey;

    await this.runState(player, npc, npcKey, frame.key, frames);
    this.sweepDialogCond(player, npcKey, frame.key, frames);
    logger.info(
      { charId: player.m_idPlayer, objid: frame.objid, npcKey, prefix: prefixForNpc(this.deps.dialogs, npcKey), key: frame.key, frames: frames.length },
      'SCRIPTDLG resolved',
    );
    return { ok: true, frames };
  }

  /**
   * Resolve + execute the dialog state for the pressed key. Emits the per-clicker
   * menu (`Say` body + `AddKey` buttons + `Exit`) as a RUNSCRIPTFUNC frame, the
   * `Speak` lines as broadcast chat (C++ `ScriptLib.cpp:40` -> `AddChat`), and
   * fires `LaunchQuest` -> `questService.beginQuest` when a quest id is present.
   */
  private async runState(
    player: CPlayer, npc: CMover, npcKey: string, key: string, frames: Buffer[],
  ): Promise<void> {
    const prefix = prefixForNpc(this.deps.dialogs, npcKey);
    if (!prefix) return;
    const file = this.deps.dialogs.byPrefix.get(prefix);
    const keyIdx = keyToIndex(key);
    const state = stateForKey(this.deps.dialogs, prefix, keyIdx);
    if (!state) return;

    this.emitMenu(player, state, frames);
    // v15 `#init` (state 0) buttons are generated by the compiled WorldDialog.dll,
    // which we don't ship -- the extracted state-0 body only carries `Speak` (chat
    // bubble), so without synthesis the dialog window opens empty for every NPC.
    // When state 0 has no menu ops of its own, synthesize a visible menu from the
    // data we have: greeting as SAY + this NPC's menu-bearing states flattened to
    // AddKey buttons + Exit. ponytail: replace with the real #addKey/quest-state
    // logic when the `source`-body interpreter lands.
    if (keyIdx === 0) this.synthInitialMenu(player, state, file, frames);

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
   * Synthesize a visible `#init` menu when state 0 produced no ops of its own.
   * Emits the greeting as a SAY (so the window isn't blank) and flattens each
   * menu-bearing child state's `AddKey` buttons into the initial menu (capped +
   * deduped by label). No-op when state 0 already has `say`/`keys`/`exit`. See
   * {@link runState} for the `ponytail` note.
   *
   * No `Exit` here: FUNCTYPE_EXIT calls `CWndDialog::Destroy()` on the client
   * (DPClient.cpp:14219), so an unconditional Exit in the #init batch closes the
   * window the client just opened -- the dialog flashes and disappears. The
   * player closes the dialog via the window's close box / ESC; a state may still
   * queue a data-driven Exit (see {@link emitMenu}) when its script body calls it.
   */
  private synthInitialMenu(
    player: CPlayer, state: DialogState, file: DialogFile | undefined, frames: Buffer[],
  ): void {
    if ((state.say?.length ?? 0) > 0 || (state.keys?.length ?? 0) > 0 || state.exit) return;
    const funcs: ScriptFunc[] = [];
    const greeting = state.speak?.[0];
    if (greeting !== undefined) {
      const text = dialogText(this.deps.dialogs, greeting);
      if (text !== undefined) funcs.push({ type: 'say', text });
    }
    const seen = new Set<string>();
    if (file) {
      const indices = Object.keys(file.states)
        .map((n) => Number(n)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      for (const idx of indices) {
        if (funcs.length >= 9) break; // greeting + <=8 buttons fits the CWndDialog layout
        const st = file.states[String(idx)];
        if (!st) continue;
        for (const k of st.keys ?? []) {
          const word = dialogText(this.deps.dialogs, k.label) ?? '';
          if (word === '' || seen.has(word)) continue;
          seen.add(word);
          funcs.push({ type: 'addKey', word, key: String(k.key ?? idx) });
          if (funcs.length >= 9) break;
        }
      }
    }
    funcs.unshift({ type: 'removeAllKeys' });
    frames.push(this.scriptDialog.build(player.m_idPlayer, funcs));
  }

  /**
   * Build the per-user RUNSCRIPTFUNC frame for `state` -- the ops a C++
   * `CNpcScript::<prefix>_<idx>` body queues via `AddRunScriptFunc`
   * (`User.cpp:6259`). A leading `RemoveAllKeys` clears any prior button set so
   * each state renders a fresh menu (the client window persists across button
   * clicks and keeps key buttons until cleared -- `WndDialog.cpp:710`). The
   * `AddKey` routing key is the target state index stringified so the client's
   * echo round-trips through `keyToIndex`. States with no `say`/`keys`/`exit`
   * (e.g. `speak`-only or `launch_quest`-only) emit no menu frame -- matching
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
   * DPSrvr.cpp:859-875 -- mark the dialog-condition flag on the active quest
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
 * Dialog states are keyed by stringified index (`"0"`, `"9"`, ...). Empty key or
 * `#init` (DPSrvr.cpp:850) routes to state 0; otherwise parse the leading int.
 */
function keyToIndex(key: string): number {
  if (key.length === 0 || key === '#init') return 0;
  const n = parseInt(key, 10);
  return Number.isNaN(n) ? 0 : n;
}
