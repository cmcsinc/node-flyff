/**
 * ScriptDlgService -- `PACKETTYPE_SCRIPTDLG` (0x00ff00b0).
 *
 * `DPSrvr::OnScriptDialogReq` (DPSrvr.cpp:914) reads:
 *   OBJID objid   String key(256)   int nGlobal1..nGlobal4
 * and runs the NPC's dialog script. v19 quest offering is driven by the
 * improved quest interface (`__IMPROVE_QUEST_INTERFACE`): selecting a quest
 * from `APP_DIALOG_EX`'s list round-trips a reserved key string
 * (`QUEST_BEGIN`, `QUEST_END`, ...) with the quest id in `nGlobal2`.
 *
 * Quest offer flow (port of C++ `__QuestEnd`, ScriptHelper.cpp:518-661):
 *   - On dialog open, scan the NPC's begin/end quests; classify each via
 *     {@link canBegin} / {@link isComplete}; push one `FUNCTYPE_NEWQUEST`
 *     (begin-eligible) or `FUNCTYPE_CURRQUEST` (end-eligible) entry per quest
 *     with `quest=questId`. The client renders these as rows in the dialog's
 *     New/Current quest list boxes.
 *   - Single begin-eligible quest + no pending completion -> skip the list and
 *     open the begin confirmation directly (C++ `vecNewQuest.size()==1`).
 *   - Selecting a quest sends `QUEST_BEGIN`/`QUEST_END` (+ questId in nGlobal2)
 *     -> show confirmation (`addAnswer` YES/NO). YES -> `QUEST_BEGIN_YES` ->
 *     `questService.beginQuest`.
 *
 * The service owns no socket bytes (rule 02) -- handlers write returned frames.
 *
 * @module services/scriptDlg
 */

import type { DialogFile, DialogIndex, DialogState, QuestDef, QuestIndex } from '@flyff/resources';
import { prefixForNpc, stateForKey, dialogText } from '@flyff/resources';
import type { CPlayer } from '@flyff/entities';
import type { CMover } from '@flyff/entities';
import { MAX_INVENTORY } from '@flyff/entities';
import type { QuestService } from '@flyff/quest';
import { QS_END, QUEST_FLAG } from '@flyff/core/constants/quest';
import { createLogger } from '@flyff/core/logger';
import { buildSetQuest, canBegin, isComplete, isNextLevel } from '@flyff/quest';
import type { InventoryOps } from '@flyff/quest';
import { ChatSerializer } from '@flyff/world-core';
import { ScriptDialogSerializer, type ScriptFunc } from '../net/snapshot/scriptDialog.serializer';
import {
  interpretDialog,
  type DialogInterpBindings,
  type DialogInterpSink,
} from './dialogInterpreter';

const logger = createLogger({ module: 'scriptDlg-service' });

/** C++ `__QUEST_1208` rate limit (`DPSrvr.cpp:930`). */
const SCRIPT_DLG_COOLDOWN_MS = 400;

/** C++ reads `lpKey[256]` -- wire string can be up to 255 chars. */
const MAX_SCRIPT_KEY = 255;

/** C++ `MAX_LEN_MOVER_MENU` (npchecker.h:4) -- squared distance gate. */
const MAX_LEN_MOVER_MENU_SQ = 1024;

/** C++ `SRT_QUESTOFFICE` (defineNeuz.h:85) -- Quest Office NPC structure type.
 *  These NPCs offer ALL eligible quests (not just those bound via SetCharacter). */
const SRT_QUESTOFFICE = 10;

/**
 * Reserved v19 quest round-trip keys (`_Common/scriptdialog.cpp:213-241` +
 * `ScriptHelper.cpp`). The client sends these verbatim with the quest id in
 * `nGlobal2` when the player acts on a quest list row or a YES/NO answer.
 */
const QUEST_KEY = {
  BEGIN: 'QUEST_BEGIN',
  BEGIN_YES: 'QUEST_BEGIN_YES',
  BEGIN_NO: 'QUEST_BEGIN_NO',
  END: 'QUEST_END',
  END_COMPLETE: 'QUEST_END_COMPLETE',
  END_FAIL: 'QUEST_END_FAIL',
  NEXT_LEVEL: 'QUEST_NEXT_LEVEL',
} as const;

const QUEST_ROUTE_KEYS: ReadonlySet<string> = new Set<string>(Object.values(QUEST_KEY));

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
  /** `#define` symbol table (`raw/define*.h`) -- resolves `QUEST_*` / `II_*`
   *  tokens inside dialog `source:` bodies. Empty map => symbols unresolved. */
  defines?: Map<string, number>;
  /** `IDS_PROPQUEST_INC_* -> display text` from propQuest.txt.txt. Resolves
   *  quest titles + per-state desc/cond/status for the dialog UI. */
  questText?: Map<string, string>;
  /** Chat serializer for `Speak` broadcast text. Injected for testability. */
  chat?: ChatSerializer;
  /** RUNSCRIPTFUNC serializer for the per-clicker dialog menu. Testable. */
  scriptDialog?: ScriptDialogSerializer;
}

/** Quest action queued by the interpreter -- resolved + executed after the
 *  dialog frame is built so SETQUEST reward frames append to the burst. */
type QuestIntent = { kind: 'begin'; id: number } | { kind: 'end'; id: number };

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

/** Copy a charKey->questIds map with lowercased keys so `MaFl_Valin` and
 *  `MI_MAFL_VALIN` resolve to the same entry. Tolerates a missing map (older
 *  test fixtures that stub `quests` without `byNpc`). */
function lowerKeys(src: ReadonlyMap<string, number[]> | undefined): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (!src) return out;
  for (const [k, v] of src) out.set(k.toLowerCase(), v);
  return out;
}

/** Normalize an NPC to its lowercased charKey for begin/end quest lookups.
 *  Prefers `m_szCharacterKey` (character.inc block key, populated from
 *  `charBlock.key` for every placed NPC); falls back to `outfit.characterKey`,
 *  then to stripping `MI_` off the propMover key. Returns undefined if none. */
function npcLookupKey(npc: CMover): string | undefined {
  const ck = npc.m_szCharacterKey || npc.outfit?.characterKey;
  if (ck) return ck.toLowerCase();
  const stripped = npc.m_szKey?.replace(/^MI_/i, '');
  return stripped ? stripped.toLowerCase() : undefined;
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
  /** Lowercased charKey -> quest ids (mirrors `quests.byNpc`, case-normalized
   *  so `MI_MAFL_VALIN` and `MaFl_Valin` collapse to the same key). */
  private readonly beginByKey: Map<string, number[]>;
  private readonly endByKey: Map<string, number[]>;
  /** Count of RUNSCRIPTFUNC menu frames pushed during the current `runState`.
   *  Lets the offer scan know whether a dialog menu already rendered, so it
   *  appends quest rows rather than wiping the prior menu. */
  private menuCount = 0;
  constructor(private deps: ScriptDlgDeps) {
    this.chat = deps.chat ?? new ChatSerializer();
    this.scriptDialog = deps.scriptDialog ?? new ScriptDialogSerializer();
    this.beginByKey = lowerKeys(deps.quests.byNpc?.begin);
    this.endByKey = lowerKeys(deps.quests.byNpc?.end);
  }

  /**
   * `DPSrvr::OnScriptDialogReq` -- rate-limit + distance gate, run the dialog
   * state machine + quest offer scan, then the post-dialog sweep. Returns
   * outbound frames for the handler to write. `now` is injected by the handler.
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
    // Dialog prefix + quest lookup both key off the character.inc block key
    // (`MaFl_Boboku`), carried verbatim by `m_szCharacterKey`. `m_szKey` (MI_*)
    // only matches for convention-following props -- `MI_NPC_*` rule-breakers
    // (Stima, Phacham, ...) strip to the wrong stem. Prefer the character key.
    const npcKey = npc.m_szCharacterKey || npc.m_szKey;

    // v19 quest round-trip: selecting a quest from APP_DIALOG_EX's list sends a
    // reserved key with the quest id in nGlobal2. Route before the state machine.
    if (QUEST_ROUTE_KEYS.has(frame.key)) {
      await this.handleQuestRoute(player, npc, frame.key, frame.nGlobal2, frames);
      return { ok: true, frames };
    }

    const menuEmitted = await this.runState(player, npc, npcKey, frame.key, frames);
    this.sweepDialogCond(player, npcKey, frame.key, frames);
    // Quest offer scan runs on every dialog-open (keyIdx 0): pushes NEWQUEST/
    // CURRQUEST rows into the v19 quest list boxes. Reaches quest NPCs whose
    // state-0 is a shop menu (Boboku) or who have no dialog file at all.
    if (keyToIndex(frame.key) === 0) this.emitQuestOffer(player, npc, frames, menuEmitted);
    const prefix = prefixForNpc(this.deps.dialogs, npcKey);
    const lk = npcLookupKey(npc);
    logger.info(
      {
        charId: player.m_idPlayer,
        npcKey,
        charKey: npc.m_szCharacterKey ?? null,
        prefix: prefix ?? null,
        hasSource: stateForKey(this.deps.dialogs, prefix ?? '', keyToIndex(frame.key))?.source != null,
        key: frame.key,
        beginQuests: (this.beginByKey.get(lk ?? '') ?? []).length,
        endQuests: (this.endByKey.get(lk ?? '') ?? []).length,
        frames: frames.length,
      },
      'SCRIPTDLG click',
    );
    return { ok: true, frames };
  }

  /**
   * Resolve + execute the dialog state for the pressed key. When the state has a
   * `source` body (the unported C++ subset), the {@link interpretDialog}
   * evaluator runs it -- emitting `Say`/`AddKey`/`Exit` ops, `Speak` chat, and
   * queuing explicit `BeginQuest(n)`/`EndQuest(n)` intents. States without
   * `source` fall through to the structured-subset emitter. State 0 always also
   * runs {@link synthInitialMenu} so the `#init` greeting + buttons render even
   * though the compiled `WorldDialog.dll` (which generates them natively) is
   * not shipped.
   */
  private async runState(
    player: CPlayer, npc: CMover, npcKey: string, key: string, frames: Buffer[],
  ): Promise<boolean> {
    this.menuCount = 0;
    const prefix = prefixForNpc(this.deps.dialogs, npcKey);
    if (!prefix) return false;
    const file = this.deps.dialogs.byPrefix.get(prefix);
    const keyIdx = keyToIndex(key);
    const state = stateForKey(this.deps.dialogs, prefix, keyIdx);
    if (!state) return false;

    const intents: QuestIntent[] = [];
    if (state.source) {
      this.runSource(player, npc, state.source, intents, frames);
    } else {
      this.emitMenu(player, state, frames);
      for (const n of state.speak ?? []) {
        const text = dialogText(this.deps.dialogs, n);
        if (text !== undefined) frames.push(this.chat.build(npc.m_idMover, text));
      }
    }

    // Honor an explicit `BeginQuest(n)`/`EndQuest(n)` from the source body. The
    // bare `LaunchQuest()` form is handled by the eager offer scan on dialog
    // open (emitQuestOffer), so it is a no-op here.
    if (state.launch_quest_id !== undefined) intents.push({ kind: 'begin', id: state.launch_quest_id });

    // v19 `#init` (state 0) buttons are generated by the compiled WorldDialog.dll,
    // which we don't ship. Synthesize a visible #init menu from sibling states.
    if (keyIdx === 0) this.synthInitialMenu(player, state, file, frames);

    for (const intent of intents) await this.applyIntent(player, npc, intent, frames);
    return this.menuCount > 0;
  }

  /**
   * Run a `source:` body through the interpreter. Say/AddKey/Exit collect into a
   * single RUNSCRIPTFUNC burst (leading removeAllKeys); Speak emits chat bubbles;
   * BeginQuest/EndQuest queue for post-burst resolution. Mirrors how
   * `emitMenu` builds frames so sourced + structured states render identically.
   */
  private runSource(
    player: CPlayer, npc: CMover, source: string,
    intents: QuestIntent[], frames: Buffer[],
  ): void {
    const ops: ScriptFunc[] = [];
    const speaks: number[] = [];
    let exit = false;
    const sink: DialogInterpSink = {
      say: (n) => {
        const text = dialogText(this.deps.dialogs, n);
        if (text !== undefined) ops.push({ type: 'say', text });
      },
      speak: (n) => { speaks.push(n); },
      addKey: (label, key, param) => {
        const word = dialogText(this.deps.dialogs, label) ?? '';
        const f: Extract<ScriptFunc, { type: 'addKey' }> = { type: 'addKey', word, key: String(key ?? label) };
        if (param !== undefined) f.param = param;
        ops.push(f);
      },
      addCondKey: (label, key) => {
        const word = dialogText(this.deps.dialogs, label) ?? '';
        ops.push({ type: 'addKey', word, key: String(key) });
      },
      removeKey: () => { /* ponytail: ScriptFunc has no removeKey op yet */ },
      exit: () => { exit = true; },
      launchQuest: () => { /* bare LaunchQuest(): eager emitQuestOffer covers it */ },
      beginQuest: (id) => { intents.push({ kind: 'begin', id }); },
      endQuest: (id) => { intents.push({ kind: 'end', id }); },
      changeJob: () => { /* ponytail: job change via dialog */ },
      createItem: () => { /* ponytail: inventory grant via dialog */ },
      removeAllItem: () => { /* ponytail: inventory wipe via dialog */ },
    };
    interpretDialog(source, this.makeBindings(player), sink);

    for (const n of speaks) {
      const text = dialogText(this.deps.dialogs, n);
      if (text !== undefined) frames.push(this.chat.build(npc.m_idMover, text));
    }
    if (ops.length > 0 || exit) {
      const funcs = ops.length > 0 ? [{ type: 'removeAllKeys' } as ScriptFunc, ...ops] : [{ type: 'removeAllKeys' } as ScriptFunc];
      if (exit) funcs.push({ type: 'exit' });
      frames.push(this.scriptDialog.build(player.m_idPlayer, funcs));
      this.menuCount++;
    }
  }

  /** Resolve + execute an explicit BeginQuest(n)/EndQuest(n) from a source body. */
  private async applyIntent(
    player: CPlayer, _npc: CMover, intent: QuestIntent, frames: Buffer[],
  ): Promise<void> {
    if (intent.kind === 'begin') await this.applyBegin(player, intent.id, frames);
    else await this.applyEnd(player, intent.id, frames);
  }

  /**
   * Emit the v19 quest offer scan (port of C++ `__QuestEnd`'s offer loop,
   * ScriptHelper.cpp:542-587). Classifies the NPC's begin/end quests and pushes
   * one `FUNCTYPE_NEWQUEST` (begin-eligible) or `FUNCTYPE_CURRQUEST`
   * (end-eligible active) row per quest into the dialog's quest list boxes.
   *
   * Single begin-eligible quest + no pending completion -> skip the list and
   * open the begin confirmation directly (C++ `vecNewQuest.size()==1`).
   *
   * `dialogMenuEmitted` says whether `runState` already pushed a menu frame; if
   * so we append rows (no removeAllKeys, which would wipe the shop/greeting
   * menu), otherwise we open a fresh menu frame.
   */
  private emitQuestOffer(
    player: CPlayer, npc: CMover, frames: Buffer[], dialogMenuEmitted: boolean,
  ): void {
    const lk = npcLookupKey(npc);
    const isQuestOffice = npc.m_nStructure === SRT_QUESTOFFICE;
    if (!lk && !isQuestOffice) return;
    const inv = this.questInv(player);
    // C++ `__QuestEnd` (ScriptHelper.cpp:542-586) classifies the NPC's quests
    // into four buckets so the dialog lists every quest the client renders an
    // icon for. Dropping next/current previously left NPCs showing a grey
    // ?/! icon with an empty quest list on click.
    const newQuests: number[] = [];   // yellow "!" -- begin-eligible
    const nextQuests: number[] = [];  // grey "!"   -- level too low, within 5
    const endQuests: number[] = [];   // green "?"  -- active, end-eligible
    const currQuests: number[] = [];  // grey "?"   -- active, not complete
    const seen = new Set<number>();
    const classify = (qid: number): void => {
      if (seen.has(qid)) return;
      seen.add(qid);
      const def = this.deps.quests.byId.get(qid);
      if (!def) {
        logger.warn({ charId: player.m_idPlayer, qid }, 'classify: quest def not in byId');
        return;
      }
      const q = player.findQuest(qid);
      const complete = player.isCompleteQuest(qid);
      if (!q && !complete) {
        const begin = canBegin(player, def, inv);
        if (begin.ok) newQuests.push(qid);
        else if (isNextLevel(player, def, inv)) nextQuests.push(qid);
        else logger.warn({ charId: player.m_idPlayer, qid, reason: begin.reason, lvl: player.m_nLevel, job: player.m_nJob, sex: player.m_nSex }, 'classify: canBegin+isNextLevel both failed');
      } else if (q && !complete && q.state !== QS_END) {
        if (isComplete(player, q, def, inv).ok) endQuests.push(qid);
        else currQuests.push(qid);
      } else {
        logger.warn({ charId: player.m_idPlayer, qid, hasQ: !!q, complete, state: q?.state }, 'classify: fell through (already complete or QS_END)');
      }
    };
    // Quest Office NPCs (SRT_QUESTOFFICE) offer ALL eligible quests, not just
    // those bound to this NPC via SetCharacter/SetEndCondCharacter. Iterate the
    // full quest catalog instead of the per-NPC byNpc maps.
    if (npc.m_nStructure === SRT_QUESTOFFICE) {
      for (const [qid] of this.deps.quests.byId) classify(qid);
    } else {
      for (const qid of this.beginByKey.get(lk) ?? []) classify(qid);
      for (const qid of this.endByKey.get(lk) ?? []) classify(qid);
    }
    // C++ single-new-quest shortcut (`ScriptHelper.cpp:654`): exactly one
    // begin-eligible quest and nothing else pending -> skip the list and open
    // the begin confirmation directly.
    if (
      newQuests.length === 1 && nextQuests.length === 0 &&
      endQuests.length === 0 && currQuests.length === 0
    ) {
      this.questBeginConfirm(player, newQuests[0]!, frames);
      this.menuCount++;
      return;
    }
    const funcs: ScriptFunc[] = [];
    for (const qid of newQuests)
      funcs.push({ type: 'newQuest', word: this.questLabel(qid), key: QUEST_KEY.BEGIN, quest: qid });
    for (const qid of nextQuests)
      funcs.push({ type: 'newQuest', word: this.questLabel(qid), key: QUEST_KEY.NEXT_LEVEL, quest: qid });
    for (const qid of endQuests)
      funcs.push({ type: 'currQuest', word: this.questLabel(qid), key: QUEST_KEY.END, quest: qid });
    for (const qid of currQuests)
      funcs.push({ type: 'currQuest', word: this.questLabel(qid), key: QUEST_KEY.END, quest: qid });
    if (funcs.length === 0) {
      // Diagnostic: if byNpc has entries but all failed classification, or byNpc
      // is empty for this NPC, this log reveals which. Remove once root-caused.
      const beginList = this.beginByKey.get(lk);
      const endList = this.endByKey.get(lk);
      if ((beginList?.length ?? 0) > 0 || (endList?.length ?? 0) > 0) {
        logger.warn(
          {
            charId: player.m_idPlayer, lk,
            beginKeys: beginList?.length ?? 0,
            endKeys: endList?.length ?? 0,
            seen: seen.size,
            newQ: newQuests.length, nextQ: nextQuests.length,
            endQ: endQuests.length, currQ: currQuests.length,
          },
          'quest offer: NPC has byNpc entries but 0 rows classified',
        );
      } else {
        logger.warn(
          { charId: player.m_idPlayer, lk, charKey: npc.m_szCharacterKey ?? null, propKey: npc.m_szKey ?? null },
          'quest offer: byNpc miss -- NPC key not in begin/end maps',
        );
      }
      return;
    }
    if (!dialogMenuEmitted) funcs.unshift({ type: 'removeAllKeys' });
    frames.push(this.scriptDialog.build(player.m_idPlayer, funcs));
  }

  /**
   * Dispatch a reserved v19 quest round-trip key. `QUEST_BEGIN`/`QUEST_END` open
   * a confirmation (Say + YES/NO answer buttons); `QUEST_BEGIN_YES` grants the
   * quest via `questService.beginQuest`; `QUEST_END_COMPLETE` completes it.
   * `QUEST_BEGIN_NO`/`QUEST_END_FAIL`/`QUEST_NEXT_LEVEL` close the window.
   * Quest id comes from `nGlobal2` (C++ `dwVal2` round-trip).
   */
  private async handleQuestRoute(
    player: CPlayer, npc: CMover, key: string, questId: number, frames: Buffer[],
  ): Promise<void> {
    if (!questId || !this.deps.quests.byId.has(questId)) {
      this.closeDialog(player, frames);
      return;
    }
    switch (key) {
      case QUEST_KEY.BEGIN:
        this.questBeginConfirm(player, questId, frames);
        return;
      case QUEST_KEY.END:
        this.questEndConfirm(player, questId, frames);
        return;
      case QUEST_KEY.BEGIN_YES:
        await this.applyBegin(player, questId, frames);
        return;
      case QUEST_KEY.END_COMPLETE:
        await this.applyEnd(player, questId, frames);
        return;
      case QUEST_KEY.NEXT_LEVEL:
        frames.push(this.scriptDialog.build(player.m_idPlayer, [
          { type: 'removeAllKeys' },
          { type: 'say', text: 'You are not yet ready for this quest.' },
          { type: 'exit' },
        ]));
        return;
      default:
        // BEGIN_NO / END_FAIL -> close.
        this.closeDialog(player, frames);
    }
    void npc;
  }

  /** `__QuestBegin` confirmation: quest title + YES/NO answer buttons
   *  (keys round-trip `QUEST_BEGIN_YES` / `QUEST_BEGIN_NO` with questId). */
  private questBeginConfirm(player: CPlayer, questId: number, frames: Buffer[]): void {
    frames.push(this.scriptDialog.build(player.m_idPlayer, [
      { type: 'removeAllKeys' },
      { type: 'say', text: this.questLabel(questId) },
      { type: 'say', text: 'Will you accept this quest?' },
      { type: 'addAnswer', word: 'Yes', key: QUEST_KEY.BEGIN_YES, quest: questId },
      { type: 'addAnswer', word: 'No', key: QUEST_KEY.BEGIN_NO, quest: questId },
    ]));
  }

  /** `__QuestEnd` confirmation: complete-eligible -> OK=>`QUEST_END_COMPLETE`;
   *  not yet eligible -> OK=>`QUEST_END_FAIL` (closes). */
  private questEndConfirm(player: CPlayer, questId: number, frames: Buffer[]): void {
    const def = this.deps.quests.byId.get(questId);
    const q = player.findQuest(questId);
    const eligible = def && q ? isComplete(player, q, def, this.questInv(player)).ok : false;
    const label = this.questLabel(questId);
    if (eligible) {
      frames.push(this.scriptDialog.build(player.m_idPlayer, [
        { type: 'removeAllKeys' },
        { type: 'say', text: `${label} -- quest complete!` },
        { type: 'addAnswer', word: 'OK', key: QUEST_KEY.END_COMPLETE, quest: questId },
      ]));
    } else {
      frames.push(this.scriptDialog.build(player.m_idPlayer, [
        { type: 'removeAllKeys' },
        { type: 'say', text: `${label} -- conditions not yet met.` },
        { type: 'addAnswer', word: 'OK', key: QUEST_KEY.END_FAIL, quest: questId },
      ]));
    }
  }

  /** Grant a quest; append SETQUEST + reward frames, then close. Logs the
   *  `QuestFailReason` when `canBegin` rejects so the click isn't silent. */
  private async applyBegin(player: CPlayer, questId: number, frames: Buffer[]): Promise<void> {
    const res = await this.deps.questService.beginQuest(player, questId);
    if (res.ok) {
      frames.push(...res.frames);
      frames.push(this.scriptDialog.build(player.m_idPlayer, [
        { type: 'removeAllKeys' },
        { type: 'say', text: 'Quest accepted.' },
        { type: 'exit' },
      ]));
    } else {
      logger.info({ charId: player.m_idPlayer, questId, reason: res.reason }, 'quest begin rejected');
      frames.push(this.scriptDialog.build(player.m_idPlayer, [
        { type: 'removeAllKeys' },
        { type: 'say', text: `Cannot begin quest (${res.reason}).` },
        { type: 'exit' },
      ]));
    }
  }

  /** Complete a quest; append SETQUEST + reward frames, then close. */
  private async applyEnd(player: CPlayer, questId: number, frames: Buffer[]): Promise<void> {
    const res = await this.deps.questService.endQuest(player, questId);
    if (res.ok) {
      frames.push(...res.frames);
      frames.push(this.scriptDialog.build(player.m_idPlayer, [
        { type: 'removeAllKeys' },
        { type: 'say', text: 'Quest complete.' },
        { type: 'exit' },
      ]));
    } else {
      logger.info({ charId: player.m_idPlayer, questId, reason: res.reason }, 'quest end rejected');
      this.closeDialog(player, frames);
    }
  }

  private closeDialog(player: CPlayer, frames: Buffer[]): void {
    frames.push(this.scriptDialog.build(player.m_idPlayer, [
      { type: 'removeAllKeys' },
      { type: 'exit' },
    ]));
  }

  /** Build the interpreter bindings view over player + world state. Queries that
   *  depend on unported systems (party/guild/inventory detail) return safe
   *  defaults so conditional bodies degrade rather than crash. */
  private makeBindings(player: CPlayer): DialogInterpBindings {
    const defines = this.deps.defines ?? new Map<string, number>();
    return {
      resolveSymbol: (sym) => defines.get(sym),
      questState: (id) => player.findQuest(id)?.state ?? -1,
      isSetQuest: (id) => (player.findQuest(id) !== undefined || player.isCompleteQuest(id)) ? 1 : 0,
      playerJob: () => player.m_nJob,
      playerLvl: () => player.m_nLevel,
      getItemNum: () => 0,           // ponytail: inventory count
      emptyInventoryNum: () => 32,   // ponytail: assume room
      playerGold: () => player.m_nGold ?? 0,
      partySize: () => 1,
      isParty: () => 0,
      isPartyMaster: () => 1,        // solo player is their own master
      isGuild: () => 0,
      isGuildMaster: () => 0,
      isGuildQuest: () => 0,
      guildQuestState: () => -1,
      playerExpPercent: () => 0,
      random: (n) => (n > 0 ? Math.floor(Math.random() * n) : 0),
      isWormonServer: () => 0,
    };
  }

  /** Real `InventoryOps` view over the player's live bag, so the offer scan's
   *  `canBegin`/`isComplete` see actual item counts (gather-quest completion,
   *  begin-item gates). Reads `m_Inventory` directly -- no InventoryService
   *  dependency. `count` sums every stack matching `itemId`; `emptySlots`
   *  counts unoccupied slots in the main-bag range `[0, MAX_INVENTORY)`. */
  private questInv(player: CPlayer): InventoryOps {
    return {
      count: (itemId: number): number => {
        let n = 0;
        for (const s of player.m_Inventory) {
          if (s && s.itemId === itemId) n += s.count;
        }
        return n;
      },
      emptySlots: (): number => {
        let n = 0;
        for (let i = 0; i < MAX_INVENTORY; i++) if (!player.m_Inventory[i]) n++;
        return n;
      },
    };
  }

  /**
   * Synthesize a visible `#init` menu when state 0 produced no ops of its own.
   * Emits the greeting as a SAY (so the window isn't blank) and flattens each
   * menu-bearing child state's `AddKey` buttons into the initial menu (capped +
   * deduped by label). No-op when state 0 already has `say`/`keys`/`exit`. See
   * {@link runState} for the `ponytail` note.
   *
   * No `Exit` here: FUNCTYPE_EXIT calls `CWndDialog::Destroy()` on the client
   * (DPClient.cpp:14402), so an unconditional Exit in the #init batch closes the
   * window the client just opened -- the dialog flashes and disappears. The
   * player closes the dialog via the window's close box / ESC.
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
    if (funcs.length === 0) return;
    funcs.unshift({ type: 'removeAllKeys' });
    frames.push(this.scriptDialog.build(player.m_idPlayer, funcs));
    this.menuCount++;
  }

  /** Display label for a quest button. Resolves `IDS_PROPQUEST_INC_*` titles
   *  via the propQuest text table; falls back to the raw title, the symbol, or
   *  the id (mirrors C++ `m_szTitle` lookup). */
  private questLabel(qid: number): string {
    const def = this.deps.quests.byId.get(qid);
    if (!def) return `Quest ${qid}`;
    return this.resolveText(def.title) ?? def.title ?? def.symbol ?? `Quest ${qid}`;
  }

  /** Resolve an `IDS_PROPQUEST_INC_*` token to display text, or undefined. */
  private resolveText(token: string | undefined): string | undefined {
    if (!token || !token.startsWith('IDS_')) return token;
    const t = this.deps.questText?.get(token);
    return t && t.length > 0 ? t : undefined;
  }

  /**
   * Build the per-user RUNSCRIPTFUNC frame for `state` -- the ops a C++
   * `CNpcScript::<prefix>_<idx>` body queues via `AddRunScriptFunc`
   * (`User.cpp:6259`). A leading `RemoveAllKeys` clears any prior button set so
   * each state renders a fresh menu. The `AddKey` routing key is the target
   * state index stringified so the client's echo round-trips through
   * `keyToIndex`. States with no `say`/`keys`/`exit` emit no menu frame.
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
    this.menuCount++;
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
 * `#init` (DPSrvr.cpp:850,955) routes to state 0; otherwise parse the leading int.
 */
function keyToIndex(key: string): number {
  if (key.length === 0 || key === '#init') return 0;
  const n = parseInt(key, 10);
  return Number.isNaN(n) ? 0 : n;
}
