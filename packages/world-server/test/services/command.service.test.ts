import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '../../src/entities/player.js';
import { PlayerManager } from '../../src/managers/player.manager.js';
import { CommandService } from '../../src/services/command.service.js';
import { AUTH } from '../../src/constants/authority.js';
import { NoticeSerializer } from '../../src/net/snapshot/notice.serializer.js';
import { TEXT_GENERAL } from '../../src/net/snapshot/constants.js';
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

function setup() {
  const playerManager = new PlayerManager();
  const commandService = new CommandService({ playerManager });
  return { playerManager, commandService };
}

describe('CommandService — routing', () => {
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

describe('CommandService — whisper', () => {
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

describe('CommandService — shout', () => {
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

describe('CommandService — teleport', () => {
  it('moves the player to given coords and sends REPLACE', () => {
    const { playerManager, commandService } = setup();
    const gm = makePlayer(1, 'GM', AUTH.GAMEMASTER);
    playerManager.add(gm);

    const result = commandService.route(gm, '/te 100 200');
    assert.equal(result.ok, true);
    assert.equal(gm.m_vPos.x, 100);
    assert.equal(gm.m_vPos.z, 200);
    assert.equal(gm.m_vPos.y, 0);
    assert.equal((gm.socket as unknown as SpySocket)._sent.length, 1, 'REPLACE sent');
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

describe('CommandService — summon', () => {
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
    assert.equal((bob.socket as unknown as SpySocket)._sent.length, 1, 'target gets REPLACE');
  });
});

describe('CommandService — system + level', () => {
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
    // string-length DWORD shifts → silent drop. Layout after the subtype WORD:
    //   [SNAPSHOT:4][NULL_ID:4][count:2][objid:4][subtype:2][TEXT_GENERAL:1]…
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
