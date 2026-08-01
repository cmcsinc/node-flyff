/**
 * PartyHandler tests -- IN_WORLD gate, forged-id reject, each opcode delegates.
 * @module handlers/party.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PartyHandler } from '../../src/handlers/party.handler';
import type { PartyService } from '../../src/services/party.service';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

const PLAYER_ID = 42;

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  return {
    session: { state, charId: PLAYER_ID },
    write: () => true,
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
  };
}

function fakePm(p?: CPlayer): PlayerManager {
  return { get: () => p } as unknown as PlayerManager;
}

function player(): CPlayer {
  return { m_idPlayer: PLAYER_ID, m_szName: 'me' } as unknown as CPlayer;
}

function makeService(): { svc: PartyService; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec = (method: string) =>
    (...args: unknown[]) => { calls.push({ method, args }); };
  const svc = {
    invite: rec('invite'),
    decline: rec('decline'),
    accept: rec('accept'),
    leaveOrKick: rec('leaveOrKick'),
    changeLeader: rec('changeLeader'),
    changeItemMode: rec('changeItemMode'),
    changeExpMode: rec('changeExpMode'),
    changeTroup: rec('changeTroup'),
    chat: rec('chat'),
  } as unknown as PartyService;
  return { svc, calls };
}

/** MEMBERREQUEST body: uLeaderId, uMemberId, BOOL bTroup (4 bytes). */
const memberReq = (leader: number, member: number) => {
  const w = new PacketWriter();
  w.writeDword(leader); w.writeDword(member); w.writeDword(0);
  return w.build();
};

/** ADDPARTYMEMBER body: uLeader, lLv, lJob, lSex, uMember, mLv, mJob, mSex. */
const addPartyMember = (leader: number, member: number) => {
  const w = new PacketWriter();
  w.writeDword(leader); w.writeDword(15); w.writeDword(2); w.writeDword(0);
  w.writeDword(member); w.writeDword(12); w.writeDword(1); w.writeDword(1);
  return w.build();
};

/** PARTYCHAT body: dpidUser, idParty, String msg. */
const partyChat = (dpid: number, party: number, msg: string) => {
  const w = new PacketWriter();
  w.writeDword(dpid); w.writeDword(party); w.writeString(msg);
  return w.build();
};

describe('PartyHandler', () => {
  let p: CPlayer;
  let harness: ReturnType<typeof makeService>;
  let handler: PartyHandler;

  beforeEach(() => {
    p = player();
    harness = makeService();
    handler = new PartyHandler({ playerManager: fakePm(p), partyService: harness.svc });
  });

  it('destroys when not IN_WORLD', () => {
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleMemberRequest(sock as never, new PacketReader(memberReq(PLAYER_ID, 2)));
    assert.equal(sock._destroyed, true);
  });

  it('forged uLeaderId (not session player) -> drop, no delegate', () => {
    handler.handleMemberRequest(mockSocket() as never, new PacketReader(memberReq(999, 2)));
    assert.equal(harness.calls.length, 0);
  });

  it('handleMemberRequest delegates with validated leader', () => {
    handler.handleMemberRequest(mockSocket() as never, new PacketReader(memberReq(PLAYER_ID, 2)));
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].method, 'invite');
    assert.deepEqual(harness.calls[0].args, [p, 2]);
  });

  it('handleAddPartyMember delegates accept(leaderId) from the 8-DWORD body', () => {
    handler.handleAddPartyMember(mockSocket() as never, new PacketReader(addPartyMember(7, PLAYER_ID)));
    assert.equal(harness.calls[0].method, 'accept');
    assert.deepEqual(harness.calls[0].args, [p, 7]);
  });

  it('handleRemovePartyMember delegates leaveOrKick(targetId)', () => {
    const w = new PacketWriter();
    w.writeDword(PLAYER_ID); w.writeDword(7);
    handler.handleRemovePartyMember(mockSocket() as never, new PacketReader(w.build()));
    assert.equal(harness.calls[0].method, 'leaveOrKick');
    assert.deepEqual(harness.calls[0].args, [p, 7]);
  });

  it('handlePartyChangeLeader delegates changeLeader(targetId)', () => {
    const w = new PacketWriter();
    w.writeDword(PLAYER_ID); w.writeDword(7);
    handler.handlePartyChangeLeader(mockSocket() as never, new PacketReader(w.build()));
    assert.deepEqual(harness.calls[0].args, [p, 7]);
  });

  it('handlePartyChangeItemMode delegates changeItemMode(nItemMode)', () => {
    const w = new PacketWriter();
    w.writeDword(PLAYER_ID); w.writeDword(1);
    handler.handlePartyChangeItemMode(mockSocket() as never, new PacketReader(w.build()));
    assert.deepEqual(harness.calls[0].args, [p, 1]);
  });

  it('handlePartyChangeExpMode delegates changeExpMode(nExpMode)', () => {
    const w = new PacketWriter();
    w.writeDword(PLAYER_ID); w.writeDword(1);
    handler.handlePartyChangeExpMode(mockSocket() as never, new PacketReader(w.build()));
    assert.deepEqual(harness.calls[0].args, [p, 1]);
  });

  it('handlePartyChat delegates chat(msg)', () => {
    handler.handlePartyChat(mockSocket() as never, new PacketReader(partyChat(PLAYER_ID, 5, 'hi')));
    assert.deepEqual(harness.calls[0].args, [p, 'hi']);
  });

  it('handleMemberRequestCancle declines when field 2 (uMember) = session player', () => {
    // Neuz sends (m_uLeader, m_uMember) -- leader first, invitee second.
    const w = new PacketWriter();
    w.writeDword(7); w.writeDword(PLAYER_ID); w.writeDword(0);
    handler.handleMemberRequestCancle(mockSocket() as never, new PacketReader(w.build()));
    assert.equal(harness.calls[0].method, 'decline');
  });

  it('handleMemberRequestCancle drops when uMember is not the session player', () => {
    const w = new PacketWriter();
    w.writeDword(PLAYER_ID); w.writeDword(7); w.writeDword(0);
    handler.handleMemberRequestCancle(mockSocket() as never, new PacketReader(w.build()));
    assert.equal(harness.calls.length, 0);
  });

  it('handleChangeTroup delegates changeTroup(name) when bSendName is TRUE', () => {
    const w = new PacketWriter();
    w.writeDword(PLAYER_ID); w.writeDword(1); w.writeString('Braves');
    handler.handleChangeTroup(mockSocket() as never, new PacketReader(w.build()));
    assert.equal(harness.calls[0].method, 'changeTroup');
    assert.deepEqual(harness.calls[0].args, [p, 'Braves']);
  });

  it('handleChangeTroup drops a forged idPlayer or bSendName=FALSE', () => {
    const forged = new PacketWriter();
    forged.writeDword(999); forged.writeDword(1); forged.writeString('X');
    handler.handleChangeTroup(mockSocket() as never, new PacketReader(forged.build()));
    const noName = new PacketWriter();
    noName.writeDword(PLAYER_ID); noName.writeDword(0);
    handler.handleChangeTroup(mockSocket() as never, new PacketReader(noName.build()));
    assert.equal(harness.calls.length, 0);
  });
});
