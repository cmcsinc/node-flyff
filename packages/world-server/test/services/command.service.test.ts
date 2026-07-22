import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '../../src/entities/player.js';
import { PlayerManager } from '../../src/managers/player.manager.js';
import { CommandService } from '../../src/services/command.service.js';
import { AUTH } from '../../src/constants/authority.js';
import { NoticeSerializer } from '../../src/net/snapshot/notice.serializer.js';
import { TEXT_GENERAL } from '../../src/net/snapshot/constants.js';
import { MODE } from '../../src/constants/mode.js';
import type { CharacterRow } from '@flyff/database';

interface SpySocket {
  write: (b: Buffer) => boolean;
  _sent: Buffer[];
}

function makeRow(id: number, name: string): CharacterRow {
  return {
    id, account_id: 1, name, slot: 0, class: 1, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0, level: 1,
    exp: 0n, hp: 1, mp: 1, max_hp: 1, max_mp: 1, strength: 1, stamina: 1,
    dexterity: 1, intelligence: 1, x: 0, y: 0, z: 0, world_id: 'W', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
  };
}

function spySock(): SpySocket {
  const sent: Buffer[] = [];
  return { write: (b) => { sent.push(b); return true; }, _sent: sent };
}

function makePlayer(id: number, name: string, authority = AUTH.GENERAL): CPlayer {
  const p = CPlayer.fromRow(makeRow(id, name), spySock(), authority);
  return p;
}

/** Minimal SpawnManager stub -- `get`/`kill`/`size` over a Map. */
function makeSpawnManager(movers = new Map<number, { m_idMover: number }>()) {
  return {
    get: (id: number) => movers.get(id),
    kill: (id: number) => movers.delete(id),
    get size() { return movers.size; },
  } as unknown as import('../../src/managers/spawn.manager.js').SpawnManager;
}

/** Minimal QuestService stub capturing calls + returning canned frames. */
function makeQuestService() {
  const calls: Array<{ op: string; questId?: number; state?: number }> = [];
  const frame = Buffer.from([0xb0]);
  const ok = (frames: Buffer[] = [frame]) => ({ ok: true as const, frames });
  return {
    calls,
    svc: {
      beginQuest: async (_p: CPlayer, questId: number) => { calls.push({ op: 'begin', questId }); return ok(); },
      endQuest: async (_p: CPlayer, questId: number) => { calls.push({ op: 'end', questId }); return ok(); },
      setQuestState: async (_p: CPlayer, questId: number, state: number) => { calls.push({ op: 'state', questId, state }); return ok(); },
      cancelQuest: async (_p: CPlayer, questId: number) => { calls.push({ op: 'cancel', questId }); return ok(); },
      removeAllQuests: async (_p: CPlayer) => { calls.push({ op: 'removeAll' }); return ok(); },
      removeCompleteQuests: async (_p: CPlayer) => { calls.push({ op: 'removeComplete' }); return ok(); },
    } as unknown as import('../../src/services/quest.service.js').QuestService,
  };
}

function setup() {
  const playerManager = new PlayerManager();
  const commandService = new CommandService({
    playerManager,
    spawnManager: makeSpawnManager(),
    questService: makeQuestService().svc,
  });
  return { playerManager, commandService };
}

describe('CommandService -- routing', () => {
  it('returns unknown for a bare slash', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'Alice');
    assert.deepEqual(commandService.route(p, '/'), { ok: false, reason: 'unknown' });
  });

  it('returns unknown for an unrecognized command', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'Alice');
    assert.deepEqual(commandService.route(p, '/frobnicate x'), { ok: false, reason: 'unknown' });
  });

  it('rejects a GM command when the player lacks authority', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'Alice', AUTH.GENERAL);
    assert.deepEqual(commandService.route(p, '/te 100 200'), { ok: false, reason: 'no_auth' });
  });
});

describe('CommandService -- whisper', () => {
  it('delivers a whisper to both sender and target', () => {
    const { playerManager, commandService } = setup();
    const alice = makePlayer(1, 'Alice');
    const bob = makePlayer(2, 'Bob');
    playerManager.add(alice);
    playerManager.add(bob);

    const result = commandService.route(alice, '/w Bob hello there');
    assert.equal(result.ok, true);
    const aliceSock = alice.socket as unknown as SpySocket;
    const bobSock = bob.socket as unknown as SpySocket;
    assert.equal(aliceSock._sent.length, 1, 'sender gets echo');
    assert.equal(bobSock._sent.length, 1, 'target gets whisper');
    assert.deepEqual(aliceSock._sent[0], bobSock._sent[0], 'both receive identical bytes');
  });

  it('replies with a ReturnSay when whispering yourself (no whisper delivered)', () => {
    const { playerManager, commandService } = setup();
    const alice = makePlayer(1, 'Alice');
    playerManager.add(alice);
    commandService.route(alice, '/w Alice hi');
    const sent = (alice.socket as unknown as SpySocket)._sent;
    assert.equal(sent.length, 1, 'ReturnSay reply only');
    // ReturnSay flag value (2 = self-target) is asserted in returnSay.serializer.test
  });

  it('replies with not-found flag for an unknown target', () => {
    const { playerManager, commandService } = setup();
    const alice = makePlayer(1, 'Alice');
    playerManager.add(alice);
    commandService.route(alice, '/w Nobody msg');
    const sent = (alice.socket as unknown as SpySocket)._sent;
    assert.equal(sent.length, 1);
  });
});

describe('CommandService -- shout', () => {
  it('broadcasts a shout to every live player', () => {
    const { playerManager, commandService } = setup();
    const a = makePlayer(1, 'A');
    const b = makePlayer(2, 'B');
    const c = makePlayer(3, 'C');
    playerManager.add(a); playerManager.add(b); playerManager.add(c);

    commandService.route(a, '/s hello world');
    for (const p of [a, b, c]) {
      assert.equal((p.socket as unknown as SpySocket)._sent.length, 1, `${p.m_szName} got shout`);
    }
  });
});

describe('CommandService -- teleport', () => {
  it('moves the player to given coords and sends SETPOS', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.GAMEMASTER);
    playerManager.add(gm);

    const result = commandService.route(gm, '/te 100 200');
    assert.equal(result.ok, true);
    assert.equal(gm.m_vPos.x, 100);
    assert.equal(gm.m_vPos.z, 200);
    assert.equal(gm.m_vPos.y, 0);
    assert.equal((gm.socket as unknown as SpySocket)._sent.length, 1, 'SETPOS sent');
    assert.ok(gm._dirty.has('x'));
    assert.ok(gm._dirty.has('z'));
  });

  it('teleports to a target player\'s position', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.GAMEMASTER);
    const bob = makePlayer(2, 'Bob');
    bob.m_vPos = { x: 555, y: 0, z: 666 };
    playerManager.add(gm);
    playerManager.add(bob);

    commandService.route(gm, '/te Bob');
    assert.equal(gm.m_vPos.x, 555);
    assert.equal(gm.m_vPos.z, 666);
  });

  it('refuses non-numeric, non-player token with not-found reply', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.GAMEMASTER);
    playerManager.add(gm);
    commandService.route(gm, '/te Ghost');
    assert.equal((gm.socket as unknown as SpySocket)._sent.length, 1, 'ReturnSay sent');
  });
});

describe('CommandService -- summon', () => {
  it('moves the target to the caller\'s position', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.GAMEMASTER);
    const bob = makePlayer(2, 'Bob');
    gm.m_vPos = { x: 10, y: 0, z: 20 };
    bob.m_vPos = { x: 0, y: 0, z: 0 };
    playerManager.add(gm);
    playerManager.add(bob);

    commandService.route(gm, '/su Bob');
    assert.equal(bob.m_vPos.x, 10);
    assert.equal(bob.m_vPos.z, 20);
    assert.equal((bob.socket as unknown as SpySocket)._sent.length, 1, 'target gets SETPOS');
  });
});

describe('CommandService -- system + level', () => {
  it('broadcasts a /sys notice to every live player (GM2 only)', () => {
    const { playerManager, commandService } = setup();
    const admin = makePlayer(1, 'Admin', AUTH.GAMEMASTER2);
    const a = makePlayer(2, 'A');
    const b = makePlayer(3, 'B');
    playerManager.add(admin); playerManager.add(a); playerManager.add(b);

    commandService.route(admin, '/sys server reboot in 5');
    for (const p of [admin, a, b]) {
      assert.equal((p.socket as unknown as SpySocket)._sent.length, 1);
    }
  });

  it('NoticeSerializer emits the TEXT_GENERAL state byte (Florist __S_SERVER_UNIFY)', () => {
    // OnText (DPClient.cpp:1341) reads BYTE nState before the string when
    // __S_SERVER_UNIFY is defined (it is, in Florist). Omit the byte and the
    // string-length DWORD shifts -> silent drop. Layout after the subtype WORD:
    //   [SNAPSHOT:4][NULL_ID:4][count:2][objid:4][subtype:2][TEXT_GENERAL:1]...
    const buf = new NoticeSerializer().build('hi');
    assert.equal(buf[16], TEXT_GENERAL, 'TEXT_GENERAL byte must precede the string');
  });

  it('sets the player level on /lv (admin only)', () => {
    const { playerManager, commandService } = setup();
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    playerManager.add(admin);

    commandService.route(admin, '/lv 60');
    assert.equal(admin.m_nLevel, 60);
    assert.ok(admin._dirty.has('level'));
  });

  it('rejects out-of-range level silently', () => {
    const { playerManager, commandService } = setup();
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    playerManager.add(admin);
    const before = admin.m_nLevel;
    commandService.route(admin, '/lv 9999');
    assert.equal(admin.m_nLevel, before);
  });
});

describe('CommandService -- gold (/gg)', () => {
  it('adds gold, WAL-journals, persists live, and sends SetPointParam to self', () => {
    const playerManager = new PlayerManager();
    const journaled: Array<{ charId: number; type: string; payload: unknown }> = [];
    const goldSaved: number[] = [];
    const commandService = new CommandService({
      playerManager,
      spawnManager: makeSpawnManager(),
      questService: makeQuestService().svc,
      journal: { append: (e) => { journaled.push(e); } },
      charRepo: { updateGold: async (_id: number, gold: number) => { goldSaved.push(gold); } } as never,
    });
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    playerManager.add(admin);

    const result = commandService.route(admin, '/gg 1000');
    assert.equal(result.ok, true);
    assert.equal(admin.m_nGold, 1000);
    assert.equal(journaled.length, 1);
    assert.equal(journaled[0]!.type, 'CHAR_GOLD');
    assert.equal((journaled[0]!.payload as { gold: number }).gold, 1000);
    assert.deepEqual(goldSaved, [1000], 'live updateGold write fires with the new total');
    assert.equal((admin.socket as unknown as SpySocket)._sent.length, 1, 'SetPointParam sent to self');
  });

  it('clamps the total to [0, MAX_GOLD]', () => {
    const playerManager = new PlayerManager();
    const commandService = new CommandService({
      playerManager,
      spawnManager: makeSpawnManager(),
      questService: makeQuestService().svc,
    });
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    admin.m_nGold = 500;
    playerManager.add(admin);

    commandService.route(admin, '/gg -1000');   // would underflow -> clamped to 0
    assert.equal(admin.m_nGold, 0);
  });

  it('rejects /gg at non-admin authority', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'P', AUTH.GAMEMASTER2);
    assert.deepEqual(commandService.route(p, '/gg 1000'), { ok: false, reason: 'no_auth' });
  });
});

describe('CommandService -- undying (/undying /ud /noundying /noud)', () => {
  it('sets MATCHLESS and clears MATCHLESS2 on /undying, broadcasting MODIFYMODE', () => {
    const { playerManager, commandService } = setup();
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    const watcher = makePlayer(2, 'Watcher');
    admin.m_dwMode = MODE.MATCHLESS2; // pre-set tier-2 -- enable must clear it
    playerManager.add(admin);
    playerManager.add(watcher);

    const result = commandService.route(admin, '/undying');
    assert.equal(result.ok, true);
    assert.notEqual(admin.m_dwMode & MODE.MATCHLESS, 0, 'MATCHLESS set');
    assert.equal(admin.m_dwMode & MODE.MATCHLESS2, 0, 'MATCHLESS2 cleared');

    const adminSock = admin.socket as unknown as SpySocket;
    const watchSock = watcher.socket as unknown as SpySocket;
    assert.equal(adminSock._sent.length, 1, 'self receives MODIFYMODE');
    assert.equal(watchSock._sent.length, 1, 'peer receives MODIFYMODE');
    assert.deepEqual(adminSock._sent[0], watchSock._sent[0], 'identical framed bytes');
  });

  it('honors the /ud abbreviation', () => {
    const { commandService } = setup();
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    commandService.route(admin, '/ud');
    assert.notEqual(admin.m_dwMode & MODE.MATCHLESS, 0);
  });

  it('clears both MATCHLESS tiers on /noundying', () => {
    const { commandService } = setup();
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    admin.m_dwMode = MODE.MATCHLESS | MODE.MATCHLESS2;

    commandService.route(admin, '/noud');
    assert.equal(admin.m_dwMode & MODE.MATCHLESS, 0);
    assert.equal(admin.m_dwMode & MODE.MATCHLESS2, 0);
  });

  it('rejects /undying at non-admin authority', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'P', AUTH.GAMEMASTER2);
    assert.deepEqual(commandService.route(p, '/undying'), { ok: false, reason: 'no_auth' });
    assert.equal(p.m_dwMode, 0, 'no mode change on reject');
  });
});

describe('CommandService -- invisible (/inv)', () => {
  it('sets TRANSPARENT + broadcasts MODIFYMODE; /noinv clears it', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'Gm', AUTH.GAMEMASTER);
    playerManager.add(gm);
    commandService.route(gm, '/inv');
    assert.notEqual(gm.m_dwMode & MODE.TRANSPARENT, 0);
    assert.equal((gm.socket as unknown as SpySocket)._sent.length, 1, 'MODIFYMODE broadcast to self');

    commandService.route(gm, '/noinv');
    assert.equal(gm.m_dwMode & MODE.TRANSPARENT, 0);
  });

  it('rejects /inv at GENERAL authority', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'P', AUTH.GENERAL);
    assert.deepEqual(commandService.route(p, '/inv'), { ok: false, reason: 'no_auth' });
    assert.equal(p.m_dwMode, 0);
  });
});

describe('CommandService -- count (/cnt)', () => {
  it('sends a TEXT frame with player + monster counts to self', () => {
    const playerManager = new PlayerManager();
    const spawn = makeSpawnManager(new Map([[1, { m_idMover: 1 }], [2, { m_idMover: 2 }]]));
    const commandService = new CommandService({
      playerManager, spawnManager: spawn, questService: makeQuestService().svc,
    });
    const gm = makePlayer(1, 'Gm', AUTH.GAMEMASTER);
    playerManager.add(gm);

    commandService.route(gm, '/cnt');
    const sent = (gm.socket as unknown as SpySocket)._sent;
    assert.equal(sent.length, 1);
    // Body after SNAPSHOT|NULL_ID|cb|NULL_ID|0x00a0|TEXT_GENERAL = DWORD len + ASCII
    const text = sent[0]!.subarray(17).toString('ascii', 4);
    assert.match(text, /Players online: 1/);
    assert.match(text, /Monsters: 2/);
  });
});

describe('CommandService -- removeTotalGold (/rtg)', () => {
  it('removes gold, WAL-journals the new total, persists live, sends SetPointParam', () => {
    const playerManager = new PlayerManager();
    const journaled: Array<{ charId: number; type: string; payload: unknown }> = [];
    const goldSaved: number[] = [];
    const commandService = new CommandService({
      playerManager, spawnManager: makeSpawnManager(), questService: makeQuestService().svc,
      journal: { append: (e) => { journaled.push(e); } },
      charRepo: { updateGold: async (_id: number, gold: number) => { goldSaved.push(gold); } } as never,
    });
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    admin.m_nGold = 500;
    playerManager.add(admin);

    commandService.route(admin, '/rtg 200');
    assert.equal(admin.m_nGold, 300);
    assert.equal(journaled[0]!.type, 'CHAR_GOLD');
    assert.equal((journaled[0]!.payload as { gold: number }).gold, 300);
    assert.deepEqual(goldSaved, [300], 'live updateGold write fires with the new total');
  });

  it('prints the current total when amount exceeds balance (no mutation)', () => {
    const playerManager = new PlayerManager();
    const commandService = new CommandService({
      playerManager, spawnManager: makeSpawnManager(), questService: makeQuestService().svc,
    });
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    admin.m_nGold = 100;
    playerManager.add(admin);

    commandService.route(admin, '/rtg 9999');
    assert.equal(admin.m_nGold, 100, 'unchanged');
    const sent = (admin.socket as unknown as SpySocket)._sent;
    assert.equal(sent.length, 1, 'AddText with current total');
  });
});

describe('CommandService -- removeNpc (/rn)', () => {
  it('kills the mover + broadcasts DEL_OBJ', () => {
    const playerManager = new PlayerManager();
    const movers = new Map([[0x40000001, { m_idMover: 0x40000001 }]]);
    const spawn = makeSpawnManager(movers);
    const commandService = new CommandService({
      playerManager, spawnManager: spawn, questService: makeQuestService().svc,
    });
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    playerManager.add(admin);

    const res = commandService.route(admin, '/rn 1073741825'); // 0x40000001
    assert.equal(res.ok, true);
    assert.equal(movers.size, 0, 'mover removed from spawn map');
    assert.equal((admin.socket as unknown as SpySocket)._sent.length, 1, 'DEL_OBJ broadcast');
  });

  it('is a no-op for an unknown objid', () => {
    const playerManager = new PlayerManager();
    const commandService = new CommandService({
      playerManager, spawnManager: makeSpawnManager(), questService: makeQuestService().svc,
    });
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    playerManager.add(admin);
    commandService.route(admin, '/rn 999');
    assert.equal((admin.socket as unknown as SpySocket)._sent.length, 0);
  });
});

describe('CommandService -- disguise (/dis)', () => {
  it('sets m_dwDisguise + broadcasts DISGUISE; /nodis clears', () => {
    const { playerManager, commandService } = setup();
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    playerManager.add(admin);
    commandService.route(admin, '/dis 168');
    assert.equal(admin.m_dwDisguise, 168);
    assert.equal((admin.socket as unknown as SpySocket)._sent.length, 1);

    commandService.route(admin, '/nodis');
    assert.equal(admin.m_dwDisguise, 0);
  });

  it('rejects a non-numeric /dis arg silently', () => {
    const { playerManager, commandService } = setup();
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    playerManager.add(admin);
    commandService.route(admin, '/dis frobnicate');
    assert.equal(admin.m_dwDisguise, 0);
    assert.equal((admin.socket as unknown as SpySocket)._sent.length, 0);
  });
});

describe('CommandService -- quest admin (/bq /eq /qs /rq /raq /rcq)', () => {
  it('routes each variant to the matching QuestService method + forwards the frame', async () => {
    const playerManager = new PlayerManager();
    const { svc, calls } = makeQuestService();
    const commandService = new CommandService({
      playerManager, spawnManager: makeSpawnManager(), questService: svc,
    });
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    playerManager.add(admin);

    commandService.route(admin, '/bq 7');
    commandService.route(admin, '/eq 8');
    commandService.route(admin, '/qs 9 2');
    commandService.route(admin, '/rq 10');
    commandService.route(admin, '/raq');
    commandService.route(admin, '/rcq');
    // Quest ops are async (void-fired); let them settle.
    await Promise.resolve(); await Promise.resolve();

    assert.deepEqual(calls, [
      { op: 'begin', questId: 7 },
      { op: 'end', questId: 8 },
      { op: 'state', questId: 9, state: 2 },
      { op: 'cancel', questId: 10 },
      { op: 'removeAll' },
      { op: 'removeComplete' },
    ]);
    assert.equal((admin.socket as unknown as SpySocket)._sent.length, 6, 'one frame per op');
  });

  it('rejects quest admin at non-admin authority', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'P', AUTH.GAMEMASTER2);
    assert.deepEqual(commandService.route(p, '/bq 7'), { ok: false, reason: 'no_auth' });
  });

  it('drops /bq with a non-numeric quest id', async () => {
    const playerManager = new PlayerManager();
    const { svc, calls } = makeQuestService();
    const commandService = new CommandService({
      playerManager, spawnManager: makeSpawnManager(), questService: svc,
    });
    const admin = makePlayer(1, 'Admin', AUTH.ADMINISTRATOR);
    playerManager.add(admin);
    commandService.route(admin, '/bq hello');
    await Promise.resolve();
    assert.equal(calls.length, 0);
  });
});

// --- new ports: self-mode toggles -------------------------------------------

describe('CommandService -- mode toggles', () => {
  /** MODIFYMODE snapshot payload: objid + WORD 0x00d3 + DWORD mode (LE). */
  function readMode(buf: Buffer, objid: number): number {
    const idx = buf.indexOf(objid & 0xff, 0);
    void idx;
    // SNAPSHOT header = 4+4+2 (PACKETTYPE, NULL_ID, cb) then objid(4)+sub(2)+mode(4)
    return buf.readUInt32LE(buf.length - 4);
  }

  it('/ok sets ONEKILL and /nook clears it; both broadcast MODIFYMODE', () => {
    const { playerManager, commandService } = setup();
    const p = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    playerManager.add(p);

    commandService.route(p, '/ok');
    assert.equal(p.m_dwMode & MODE.ONEKILL, MODE.ONEKILL, 'ONEKILL set');
    assert.equal(readMode((p.socket as unknown as SpySocket)._sent[0]!, p.m_idPlayer), p.m_dwMode);

    commandService.route(p, '/nook');
    assert.equal(p.m_dwMode & MODE.ONEKILL, 0, 'ONEKILL cleared');
  });

  it('/gmitem /gmnotitem toggle the ITEM bit', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    commandService.route(p, '/gmitem');
    assert.equal(p.m_dwMode & MODE.ITEM, MODE.ITEM);
    commandService.route(p, '/gmnotitem');
    assert.equal(p.m_dwMode & MODE.ITEM, 0);
  });

  it('/gmobserve sets the OBSERVE composite, /gmnotobserve clears every bit in it', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    commandService.route(p, '/gmobserve');
    assert.equal(p.m_dwMode & MODE.OBSERVE, MODE.OBSERVE);
    commandService.route(p, '/gmnotobserve');
    assert.equal(p.m_dwMode & MODE.OBSERVE, 0);
  });

  it('/es toggles EXPUP_STOP each call', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    commandService.route(p, '/es');
    assert.equal(p.m_dwMode & MODE.EXPUP_STOP, MODE.EXPUP_STOP, 'first call sets');
    commandService.route(p, '/es');
    assert.equal(p.m_dwMode & MODE.EXPUP_STOP, 0, 'second call clears');
  });

  it('mode toggles reject below ADMINISTRATOR', () => {
    const { commandService } = setup();
    const p = makePlayer(1, 'GM', AUTH.GAMEMASTER);
    assert.deepEqual(commandService.route(p, '/ok'), { ok: false, reason: 'no_auth' });
    assert.deepEqual(commandService.route(p, '/gmitem'), { ok: false, reason: 'no_auth' });
  });
});

// --- /out (disconnect) ------------------------------------------------------

describe('CommandService -- out (/out)', () => {
  it('destroys the target socket + removes it from the manager', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.GAMEMASTER2);
    const bob = makePlayer(2, 'Bob');
    let destroyed = false;
    (bob.socket as { destroy?: () => void }).destroy = () => { destroyed = true; };
    playerManager.add(gm); playerManager.add(bob);

    const result = commandService.route(gm, '/out Bob');
    assert.equal(result.ok, true);
    assert.equal(destroyed, true, 'target socket destroyed');
    assert.equal(playerManager.get(2), undefined, 'removed from manager');
  });

  it('self-target returns the self ReturnSay and does not disconnect', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.GAMEMASTER2);
    let destroyed = false;
    (gm.socket as { destroy?: () => void }).destroy = () => { destroyed = true; };
    playerManager.add(gm);

    commandService.route(gm, '/out GM');
    assert.equal(destroyed, false);
    assert.equal(playerManager.size, 1);
  });

  it('unknown target returns the not-found ReturnSay', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.GAMEMASTER2);
    playerManager.add(gm);
    commandService.route(gm, '/out Nobody');
    assert.equal((gm.socket as unknown as SpySocket)._sent.length, 1, 'ReturnSay reply');
  });
});

// --- /ak (radius kill) ------------------------------------------------------

interface MoverStub {
  m_idMover: number;
  m_vPos: { x: number; y: number; z: number };
  m_nZoneId: number;
  m_bDead: boolean;
}

/** SpawnManager stub that supports `inZone` for /ak. */
function makeZoneSpawnManager(movers: MoverStub[]) {
  return {
    get: (id: number) => movers.find((m) => m.m_idMover === id),
    kill: (id: number) => { const i = movers.findIndex((m) => m.m_idMover === id); if (i >= 0) movers.splice(i, 1); return i >= 0; },
    get size() { return movers.length; },
    inZone: (zoneId: number) => movers.filter((m) => m.m_nZoneId === zoneId),
  } as unknown as import('../../src/managers/spawn.manager.js').SpawnManager;
}

describe('CommandService -- aroundKill (/ak)', () => {
  it('kills every live monster within 64m in the same zone + broadcasts one DEL_OBJ', () => {
    const playerManager = new PlayerManager();
    const movers: MoverStub[] = [
      { m_idMover: 0x40000001, m_vPos: { x: 0, y: 0, z: 0 }, m_nZoneId: 1, m_bDead: false },
      { m_idMover: 0x40000002, m_vPos: { x: 10, y: 0, z: 10 }, m_nZoneId: 1, m_bDead: false },
      { m_idMover: 0x40000003, m_vPos: { x: 100, y: 0, z: 100 }, m_nZoneId: 1, m_bDead: false }, // out of range
      { m_idMover: 0x40000004, m_vPos: { x: 1, y: 0, z: 1 }, m_nZoneId: 2, m_bDead: false },     // other zone
    ];
    const spawnManager = makeZoneSpawnManager(movers);
    const commandService = new CommandService({
      playerManager, spawnManager,
      questService: makeQuestService().svc,
    });
    const gm = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    gm.m_vPos = { x: 0, y: 0, z: 0 };
    gm.m_nZoneId = 1;
    playerManager.add(gm);

    const result = commandService.route(gm, '/ak');
    assert.equal(result.ok, true);
    const liveIds = movers.map((m) => m.m_idMover);
    assert.deepEqual(liveIds.sort(), [0x40000003, 0x40000004].sort(), 'only far + other-zone survive');
    const sent = (gm.socket as unknown as SpySocket)._sent;
    assert.equal(sent.length, 1, 'one batched DEL_OBJ broadcast');
    // Framed buffer = 0x5E + 4B size + payload; cb WORD sits at payload offset 8
    // -> framed offset 13. Should be 2 (two slain monsters in the zone).
    assert.equal(sent[0]!.readUInt16LE(13), 2, 'cb=2 sub-records');
  });

  it('is a no-op when no monsters are in range', () => {
    const playerManager = new PlayerManager();
    const movers: MoverStub[] = [
      { m_idMover: 0x40000009, m_vPos: { x: 999, y: 0, z: 999 }, m_nZoneId: 1, m_bDead: false },
    ];
    const spawnManager = makeZoneSpawnManager(movers);
    const commandService = new CommandService({
      playerManager, spawnManager, questService: makeQuestService().svc,
    });
    const gm = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    gm.m_nZoneId = 1;
    playerManager.add(gm);

    commandService.route(gm, '/ak');
    assert.equal(movers.length, 1, 'nothing killed');
    assert.equal((gm.socket as unknown as SpySocket)._sent.length, 0, 'no broadcast');
  });
});

// --- /ci (create item) ------------------------------------------------------

describe('CommandService -- createItem (/ci)', () => {
  it('adds the item to the bag + sends CREATEITEM', async () => {
    const playerManager = new PlayerManager();
    const added: Array<{ itemId: number; count: number; slot: number }> = [];
    const inventoryService = {
      addItem: (p: CPlayer, itemId: number, count: number) => {
        const slot = 0;
        added.push({ itemId, count, slot });
        p.m_Inventory[slot] = { itemId, count };
        return { ok: true as const, slot, itemId, count };
      },
    } as unknown as import('../../src/services/inventory.service.js').InventoryService;
    const commandService = new CommandService({
      playerManager, spawnManager: makeSpawnManager(),
      questService: makeQuestService().svc, inventoryService,
    });
    const gm = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    playerManager.add(gm);

    commandService.route(gm, '/ci 2500 3');
    assert.deepEqual(added, [{ itemId: 2500, count: 3, slot: 0 }]);
    assert.equal(gm.m_Inventory[0]!.itemId, 2500);
    assert.equal((gm.socket as unknown as SpySocket)._sent.length, 1, 'CREATEITEM sent');
  });

  it('defaults count to 1 and drops on a non-numeric itemId', async () => {
    const playerManager = new PlayerManager();
    const added: number[] = [];
    const inventoryService = {
      addItem: (p: CPlayer, itemId: number, count: number) => {
        added.push(itemId);
        p.m_Inventory[0] = { itemId, count };
        return { ok: true as const, slot: 0, itemId, count };
      },
    } as unknown as import('../../src/services/inventory.service.js').InventoryService;
    const commandService = new CommandService({
      playerManager, spawnManager: makeSpawnManager(),
      questService: makeQuestService().svc, inventoryService,
    });
    const gm = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    playerManager.add(gm);

    commandService.route(gm, '/ci 2500');
    assert.equal(added[0], 2500);
    assert.equal(gm.m_Inventory[0]!.count, 1, 'defaults to 1');

    added.length = 0;
    commandService.route(gm, '/ci frob');
    assert.equal(added.length, 0, 'non-numeric id dropped');
  });

  it('no-ops when inventoryService is absent', () => {
    const { commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    commandService.route(gm, '/ci 2500');
    assert.equal((gm.socket as unknown as SpySocket)._sent.length, 0);
  });
});

// --- /ul (user list) + /stat ------------------------------------------------

describe('CommandService -- userList (/ul) + stat (/stat)', () => {
  it('/ul sends a TEXT notice listing live player names', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    const other = makePlayer(2, 'Boba');
    playerManager.add(gm); playerManager.add(other);

    commandService.route(gm, '/ul');
    const sent = (gm.socket as unknown as SpySocket)._sent;
    assert.equal(sent.length, 1, 'notice sent');
    assert.ok(sent[0]!.includes(0xa0), 'TEXT sub-type byte present'); // 0x00a0
  });

  it('/stat str sets + persists the attribute', async () => {
    const playerManager = new PlayerManager();
    const updates: Partial<Record<string, number>>[] = [];
    const charRepo = {
      updateStats: async (_id: number, stats: Partial<Record<string, number>>) => { updates.push(stats); },
    } as unknown as Pick<CharacterRow, never> & { updateStats(id: number, s: Partial<Record<string, number>>): Promise<void> };
    const commandService = new CommandService({
      playerManager, spawnManager: makeSpawnManager(),
      questService: makeQuestService().svc, charRepo,
    });
    const gm = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    playerManager.add(gm);

    commandService.route(gm, '/stat str 42');
    await Promise.resolve();
    assert.equal(gm.m_nStr, 42);
    assert.deepEqual(updates, [{ strength: 42 }]);
    assert.ok(gm._dirty.has('strength'));
  });

  it('/stat all sets every attribute, /stat bad rejects silently', async () => {
    const playerManager = new PlayerManager();
    const charRepo = {
      updateStats: async () => {},
    } as unknown as { updateStats(id: number, s: Record<string, number>): Promise<void> };
    const commandService = new CommandService({
      playerManager, spawnManager: makeSpawnManager(),
      questService: makeQuestService().svc, charRepo,
    });
    const gm = makePlayer(1, 'GM', AUTH.ADMINISTRATOR);
    playerManager.add(gm);

    commandService.route(gm, '/stat all 15');
    await Promise.resolve();
    assert.equal(gm.m_nStr, 15);
    assert.equal(gm.m_nSta, 15);
    assert.equal(gm.m_nDex, 15);
    assert.equal(gm.m_nInt, 15);

    commandService.route(gm, '/stat bogus 5');
    await Promise.resolve();
    // unknown target name leaves stats untouched (still 15)
    assert.equal(gm.m_nStr, 15);
  });
});

