import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ScriptDlgService } from '../../src/services/scriptDlg.service';
import { QUEST_FLAG } from '@flyff/core/constants/quest';
import type { CPlayer } from '@flyff/entities';
import type { CMover } from '@flyff/entities';
import type { DialogIndex, QuestDef, QuestIndex } from '@flyff/resources';
import type { QuestService } from '@flyff/quest';
import type { ScriptFunc } from '../../src/net/snapshot/scriptDialog.serializer';

const NPC_ID = 0x40000001;

/** Minimal CPlayer stand-in -- only the fields `dialog()` touches. */
function mkPlayer(overrides: Partial<CPlayer> = {}): CPlayer {
  return {
    m_idPlayer: 99,
    m_tickScript: -10000,
    m_vPos: { x: 0, y: 0, z: 0 },
    m_aQuest: [],
    _dirty: new Set<string>(),
    ...overrides,
  } as unknown as CPlayer;
}

function mkNpc(characterKey?: string, pos = { x: 0, y: 0, z: 0 }): CMover {
  return {
    m_idMover: NPC_ID, m_vPos: pos,
    m_szKey: characterKey ?? '',
  } as unknown as CMover;
}

function mkDialogs(strings: string[] = [], prefix = 'mafl_test'): DialogIndex {
  return {
    strings,
    npcToPrefix: new Map([['MaFl_Test', prefix]]),
    byPrefix: new Map(),
  };
}

function mkQuests(defs: QuestDef[]): QuestIndex {
  return { byId: new Map(defs.map((d) => [d.id, d])), drops: new Map() } as unknown as QuestIndex;
}

/** SetEndCondDialog quest command for the sweep. */
function endDialogQuest(id: number, charKey: string, addKey: string): QuestDef {
  return {
    _version: '1.0', id, symbol: `Q${id}`, commands: [
      { cmd: 'SetEndCondDialog', args: [
        { type: 'str', value: charKey }, { type: 'str', value: addKey },
      ] },
    ],
    states: {}, quest_items: [],
  } as unknown as QuestDef;
}

/** Fake ChatSerializer returning a sentinel so we can assert it was used. */
const fakeChat = { build: (id: number, _text: string) => Buffer.from([0xc0, id & 0xff]) };

/** Fake ScriptDialogSerializer capturing the op lists it was handed. */
function fakeScriptDialog(): { serializer: { build: (id: number, f: ScriptFunc[]) => Buffer }; calls: ScriptFunc[][]; sentinel: Buffer } {
  const calls: ScriptFunc[][] = [];
  const sentinel = Buffer.from([0x24]);
  return {
    sentinel,
    calls,
    serializer: { build: (_id: number, funcs: ScriptFunc[]) => { calls.push(funcs); return sentinel; } },
  };
}

function fakeQuestService(): { svc: QuestService; began: number[]; frame: Buffer } {
  const began: number[] = [];
  const frame = Buffer.from([0xb0]);
  const svc = {
    beginQuest: async (_p: CPlayer, id: number) => { began.push(id); return { ok: true, frames: [frame] }; },
  } as unknown as QuestService;
  return { svc, began, frame };
}

describe('ScriptDlgService.dialog', () => {
  it('rate-limits sends within 400ms', async () => {
    const { svc } = fakeQuestService();
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs: mkDialogs(), quests: mkQuests([]), questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(mkPlayer({ m_tickScript: 1000 }), { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 1100);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'rate_limited');
  });

  it('rejects an over-long key', async () => {
    const { svc } = fakeQuestService();
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs: mkDialogs(), quests: mkQuests([]), questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(mkPlayer(), { objid: NPC_ID, key: 'x'.repeat(256), nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'key_too_long');
  });

  it('resolves an NPC with no dialog prefix to zero frames (monster / unknown NPC)', async () => {
    const { svc } = fakeQuestService();
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc() },
      dialogs: mkDialogs(), quests: mkQuests([]), questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(mkPlayer(), { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.frames.length, 0);
  });

  it('returns invalid_target when no mover exists for the objid', async () => {
    const { svc } = fakeQuestService();
    const s = new ScriptDlgService({
      spawnManager: { get: () => undefined },
      dialogs: mkDialogs(), quests: mkQuests([]), questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(mkPlayer(), { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'invalid_target');
  });

  it('rejects when the player is beyond MAX_LEN_MOVER_MENU', async () => {
    const { svc } = fakeQuestService();
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test', { x: 100, y: 0, z: 0 }) },
      dialogs: mkDialogs(), quests: mkQuests([]), questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(mkPlayer({ m_vPos: { x: 0, y: 0, z: 0 } }), { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    assert.equal(out.ok, false); // 100^2 = 10000 > 1024
    if (!out.ok) assert.equal(out.reason, 'too_far');
  });

  it('emits Speak lines as chat frames resolved from the string table', async () => {
    const { svc } = fakeQuestService();
    const dialogs = mkDialogs(['', '', '', '', '', 'hello there']);
    dialogs.byPrefix.set('mafl_test', {
      _version: '1.0', prefix: 'mafl_test', character_key: 'MaFl_Test',
      states: { '0': { speak: [5] } },
    } as never);
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs, quests: mkQuests([]), questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(mkPlayer(), { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    assert.equal(out.ok, true);
    // Speak->chat frame is emitted alongside the synthesized #init menu frame.
    if (out.ok) assert.ok(out.frames.some((f) => f.equals(Buffer.from([0xc0, NPC_ID & 0xff]))));
  });

  it('fires beginQuest when a launch state carries a quest id', async () => {
    const { svc, began, frame } = fakeQuestService();
    const dialogs = mkDialogs();
    dialogs.byPrefix.set('mafl_test', {
      _version: '1.0', prefix: 'mafl_test', character_key: 'MaFl_Test',
      states: { '1': { launch_quest: true, launch_quest_id: 7 } },
    } as never);
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs, quests: mkQuests([]), questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(mkPlayer(), { objid: NPC_ID, key: '1', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    assert.deepEqual(began, [7]);
    if (out.ok) assert.ok(out.frames.includes(frame));
  });

  it('skips beginQuest when launch state has no quest id (simple-subset gap)', async () => {
    const { svc, began } = fakeQuestService();
    const dialogs = mkDialogs();
    dialogs.byPrefix.set('mafl_test', {
      _version: '1.0', prefix: 'mafl_test', character_key: 'MaFl_Test',
      states: { '1': { launch_quest: true } },
    } as never);
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs, quests: mkQuests([]), questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(mkPlayer(), { objid: NPC_ID, key: '1', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    assert.deepEqual(began, []);
    if (out.ok) assert.equal(out.frames.length, 0);
  });

  it('sweep sets the DIALOG flag + emits SETQUEST for the matching active quest', async () => {
    const { svc } = fakeQuestService();
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
    });
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs: mkDialogs(), quests: mkQuests([endDialogQuest(7, 'MaFl_Test', '0')]),
      questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(player, { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    if (!out.ok) throw new Error('expected ok');
    assert.equal(out.frames.length, 1); // SETQUEST only
    assert.equal(player.m_aQuest[0].flags & QUEST_FLAG.DIALOG, QUEST_FLAG.DIALOG);
    assert.ok(player._dirty.has('m_aQuest'));
  });

  it('sweep is a no-op when the flag is already set (C++ breaks on first match)', async () => {
    const { svc } = fakeQuestService();
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: QUEST_FLAG.DIALOG } as never],
    });
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs: mkDialogs(), quests: mkQuests([endDialogQuest(7, 'MaFl_Test', '0')]),
      questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(player, { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    if (!out.ok) throw new Error('expected ok');
    assert.equal(out.frames.length, 0);
  });

  it('sweep ignores a quest whose charKey does not match the NPC', async () => {
    const { svc } = fakeQuestService();
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
    });
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs: mkDialogs(), quests: mkQuests([endDialogQuest(7, 'MaFl_Other', '0')]),
      questService: svc, chat: fakeChat as never,
    });
    const out = await s.dialog(player, { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    if (!out.ok) throw new Error('expected ok');
    assert.equal(out.frames.length, 0);
    assert.equal(player.m_aQuest[0].flags, 0);
  });

  it('emits a RUNSCRIPTFUNC menu (RemoveAllKey + Say + AddKey + Exit) for a menu state', async () => {
    const { svc } = fakeQuestService();
    const { serializer, calls } = fakeScriptDialog();
    const dialogs = mkDialogs(['', '', 'hello']); // index 2 = 'hello'; others unresolved
    dialogs.byPrefix.set('mafl_test', {
      _version: '1.0', prefix: 'mafl_test', character_key: 'MaFl_Test',
      states: { '0': { say: [2], keys: [{ label: 2 }, { label: 5, key: 7, param: 3 }], exit: true } },
    } as never);
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs, quests: mkQuests([]), questService: svc,
      chat: fakeChat as never, scriptDialog: serializer as never,
    });
    const out = await s.dialog(mkPlayer(), { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    if (!out.ok) throw new Error('expected ok');
    assert.equal(calls.length, 1);
    const f = calls[0]!;
    assert.equal(f[0]!.type, 'removeAllKeys');
    assert.deepEqual(f[1], { type: 'say', text: 'hello' });
    assert.deepEqual(f[2], { type: 'addKey', word: 'hello', key: '2' }); // label 2, no key -> routes to 2
    assert.deepEqual(f[3], { type: 'addKey', word: '', key: '7', param: 3 }); // label 5 unresolved -> ''
    assert.equal(f[4]!.type, 'exit');
  });

  it('synthesizes a #init menu (greeting SAY, no Exit) for a speak-only state 0', async () => {
    const { svc } = fakeQuestService();
    const { serializer, calls } = fakeScriptDialog();
    const dialogs = mkDialogs(['', '', '', '', '', 'hi']);
    dialogs.byPrefix.set('mafl_test', {
      _version: '1.0', prefix: 'mafl_test', character_key: 'MaFl_Test',
      states: { '0': { speak: [5] } },
    } as never);
    const s = new ScriptDlgService({
      spawnManager: { get: () => mkNpc('MaFl_Test') },
      dialogs, quests: mkQuests([]), questService: svc,
      chat: fakeChat as never, scriptDialog: serializer as never,
    });
    const out = await s.dialog(mkPlayer(), { objid: NPC_ID, key: '', nGlobal1: 0, nGlobal2: 0, nGlobal3: 0, nGlobal4: 0 }, 0);
    if (!out.ok) throw new Error('expected ok');
    assert.equal(calls.length, 1); // synthesized menu
    const funcs = calls[0];
    assert.equal(funcs[0].type, 'removeAllKeys');
    assert.deepEqual(funcs.filter((f) => f.type === 'say'), [{ type: 'say', text: 'hi' }]);
    // No Exit: FUNCTYPE_EXIT destroys the client CWndDialog, so the synth #init
    // batch must not queue one (the player closes via the window close box / ESC).
    assert.equal(funcs.filter((f) => f.type === 'exit').length, 0);
    assert.ok(out.frames.some((f) => f.equals(Buffer.from([0xc0, NPC_ID & 0xff])))); // Speak chat too
  });
});
