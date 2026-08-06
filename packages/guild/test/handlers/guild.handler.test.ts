/**
 * GuildHandler tests -- IN_WORLD gate, wire widths (the BYTE-leading
 * GUILD_CLASS body and the 8-byte GUILD_MEMBER_INFO), forged self-id rejects,
 * rank bounds, and the truncated-packet warn-and-drop contract.
 *
 * Bodies are built exactly as the `Neuz/DPClient.cpp` senders cited in the
 * handler's doc comment lay them out.
 * @module handlers/guild.handler.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { MAX_GM_LEVEL, GUD_CAPTAIN, PF_INVITATION, PF_MEMBERLEVEL } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import { GuildHandler } from '../../src/handlers/guild.handler';
import type { GuildService } from '../../src/services/guild.service';

const PLAYER_ID = 42;
const OTHER_ID = 7;

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

function makeService(): { svc: GuildService; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec = (method: string) =>
    (...args: unknown[]) => { calls.push({ method, args }); };
  const svc = {
    invite: rec('invite'),
    decline: rec('decline'),
    accept: rec('accept'),
    leaveOrKick: rec('leaveOrKick'),
    destroy: rec('destroy'),
    setMemberLevel: rec('setMemberLevel'),
    setMemberClass: rec('setMemberClass'),
    setMemberAlias: rec('setMemberAlias'),
    changeMaster: rec('changeMaster'),
    setLogo: rec('setLogo'),
    setNotice: rec('setNotice'),
    setAuthority: rec('setAuthority'),
    setRankPenya: rec('setRankPenya'),
    rename: rec('rename'),
  } as unknown as GuildService;
  return { svc, calls };
}

/** `w.build()` from a list of writer ops. */
function body(fn: (w: PacketWriter) => void): PacketReader {
  const w = new PacketWriter();
  fn(w);
  return new PacketReader(w.build());
}

describe('GuildHandler', () => {
  let p: CPlayer;
  let harness: ReturnType<typeof makeService>;
  let handler: GuildHandler;

  beforeEach(() => {
    p = player();
    harness = makeService();
    handler = new GuildHandler({ playerManager: fakePm(p), guildService: harness.svc });
  });

  describe('session gate', () => {
    it('destroys the socket and calls no service method when not IN_WORLD', () => {
      const sock = mockSocket(SessionState.CONNECTED);
      handler.handleGuildInvite(sock as never, body((w) => w.writeDword(5)));
      assert.equal(sock._destroyed, true);
      assert.equal(harness.calls.length, 0);
    });

    it('destroys when the session has no charId', () => {
      // Built inline: an explicit `undefined` would hit mockSocket's default.
      let destroyed = false;
      const sock = {
        session: { state: SessionState.IN_WORLD },
        write: () => true,
        destroy: () => { destroyed = true; },
      };
      handler.handleDestroyGuild(sock as never, body((w) => w.writeDword(PLAYER_ID)));
      assert.equal(destroyed, true);
      assert.equal(harness.calls.length, 0);
    });

    it('destroys when the player is not live in the manager', () => {
      const h = new GuildHandler({ playerManager: fakePm(undefined), guildService: harness.svc });
      const sock = mockSocket();
      h.handleDestroyGuild(sock as never, body((w) => w.writeDword(PLAYER_ID)));
      assert.equal(sock._destroyed, true);
      assert.equal(harness.calls.length, 0);
    });
  });

  describe('handleGuildInvite / handleIgnoreGuildInvite', () => {
    it('invite delegates the objid', () => {
      handler.handleGuildInvite(mockSocket() as never, body((w) => w.writeDword(1234)));
      assert.equal(harness.calls[0].method, 'invite');
      assert.deepEqual(harness.calls[0].args, [p, 1234]);
    });

    it('decline ignores the echoed inviter id', () => {
      handler.handleIgnoreGuildInvite(mockSocket() as never, body((w) => w.writeDword(OTHER_ID)));
      assert.equal(harness.calls[0].method, 'decline');
      assert.deepEqual(harness.calls[0].args, [p]);
    });
  });

  describe('handleAddGuildMember', () => {
    /** `u_long idMaster | GUILD_MEMBER_INFO { u_long idPlayer; BYTE; pad[3] }`. */
    const addMember = (idMaster: number, infoId: number, trailing = 0) => body((w) => {
      w.writeDword(idMaster);
      w.writeDword(infoId);
      w.writeByte(100);            // nMultiNo
      w.writeByte(0); w.writeByte(0); w.writeByte(0); // struct tail padding
      if (trailing) w.writeDword(trailing);
    });

    it('accepts when the struct names the session player', () => {
      handler.handleAddGuildMember(mockSocket() as never, addMember(OTHER_ID, PLAYER_ID));
      assert.equal(harness.calls[0].method, 'accept');
      assert.deepEqual(harness.calls[0].args, [p]);
    });

    it('rejects when GUILD_MEMBER_INFO.idPlayer names someone else', () => {
      handler.handleAddGuildMember(mockSocket() as never, addMember(OTHER_ID, 999));
      assert.equal(harness.calls.length, 0);
    });

    it('consumes the full 8-byte struct (a trailing DWORD stays unread)', () => {
      const w = new PacketWriter();
      w.writeDword(OTHER_ID);
      w.writeDword(PLAYER_ID);
      w.writeByte(100); w.writeByte(0); w.writeByte(0); w.writeByte(0);
      w.writeDword(0xdeadbeef);
      const reader = new PacketReader(w.build());
      handler.handleAddGuildMember(mockSocket() as never, reader);
      assert.equal(harness.calls.length, 1);
      // idMaster(4) + GUILD_MEMBER_INFO(8) = 12 bytes -- 5 would leave the id
      // half-read and shift everything after it.
      assert.equal(reader.offset, 12);
      assert.equal(reader.remaining, 4);
    });
  });

  describe('handleRemoveGuildMember / handleDestroyGuild', () => {
    it('remove delegates leaveOrKick(idPlayer)', () => {
      handler.handleRemoveGuildMember(
        mockSocket() as never,
        body((w) => { w.writeDword(OTHER_ID); w.writeDword(99); }),
      );
      assert.equal(harness.calls[0].method, 'leaveOrKick');
      assert.deepEqual(harness.calls[0].args, [p, 99]);
    });

    it('destroy delegates with the session player (body id ignored)', () => {
      handler.handleDestroyGuild(mockSocket() as never, body((w) => w.writeDword(PLAYER_ID)));
      assert.equal(harness.calls[0].method, 'destroy');
      assert.deepEqual(harness.calls[0].args, [p]);
    });
  });

  describe('handleGuildMemberLevel', () => {
    const memberLevel = (idMaster: number, idPlayer: number, lv: number) =>
      body((w) => { w.writeDword(idMaster); w.writeDword(idPlayer); w.writeDword(lv); });

    it('delegates (targetId, memberLv)', () => {
      handler.handleGuildMemberLevel(mockSocket() as never, memberLevel(PLAYER_ID, 99, GUD_CAPTAIN));
      assert.equal(harness.calls[0].method, 'setMemberLevel');
      assert.deepEqual(harness.calls[0].args, [p, 99, GUD_CAPTAIN]);
    });

    it('rejects a rank past the array rather than indexing it', () => {
      handler.handleGuildMemberLevel(mockSocket() as never, memberLevel(PLAYER_ID, 99, MAX_GM_LEVEL));
      handler.handleGuildMemberLevel(mockSocket() as never, memberLevel(PLAYER_ID, 99, 0xffffffff));
      assert.equal(harness.calls.length, 0);
      // The top legal rank still passes.
      handler.handleGuildMemberLevel(
        mockSocket() as never, memberLevel(PLAYER_ID, 99, MAX_GM_LEVEL - 1),
      );
      assert.equal(harness.calls.length, 1);
    });
  });

  describe('handleGuildClass (the BYTE width trap)', () => {
    /** `BYTE nFlag | u_long idMaster | u_long idPlayer` -- 9 bytes, not 12. */
    const guildClass = (flag: number, idMaster: number, idPlayer: number) =>
      body((w) => { w.writeByte(flag); w.writeDword(idMaster); w.writeDword(idPlayer); });

    it('resolves (targetId, up=true) from a 1-byte leading nFlag', () => {
      handler.handleGuildClass(mockSocket() as never, guildClass(1, PLAYER_ID, 99));
      assert.equal(harness.calls[0].method, 'setMemberClass');
      assert.deepEqual(
        harness.calls[0].args, [p, 99, true],
        'reading nFlag as a DWORD would shift both ids',
      );
    });

    it('nFlag 0 means demote', () => {
      handler.handleGuildClass(mockSocket() as never, guildClass(0, PLAYER_ID, 99));
      assert.deepEqual(harness.calls[0].args, [p, 99, false]);
    });

    it('any nFlag other than 1 is a demote (C++ tests == 1)', () => {
      handler.handleGuildClass(mockSocket() as never, guildClass(2, PLAYER_ID, 99));
      assert.deepEqual(harness.calls[0].args, [p, 99, false]);
    });

    it('consumes exactly 9 bytes', () => {
      const w = new PacketWriter();
      w.writeByte(1); w.writeDword(PLAYER_ID); w.writeDword(99);
      const reader = new PacketReader(w.build());
      handler.handleGuildClass(mockSocket() as never, reader);
      assert.equal(reader.offset, 9);
      assert.equal(reader.remaining, 0);
    });
  });

  describe('anti-forgery on the self-id field', () => {
    it('handleGuildNickname rejects a mismatched idSelf', () => {
      handler.handleGuildNickname(mockSocket() as never, body((w) => {
        w.writeDword(999); w.writeDword(5); w.writeString('Scout');
      }));
      assert.equal(harness.calls.length, 0);
      handler.handleGuildNickname(mockSocket() as never, body((w) => {
        w.writeDword(PLAYER_ID); w.writeDword(5); w.writeString('Scout');
      }));
      assert.deepEqual(harness.calls[0].args, [p, 5, 'Scout']);
    });

    it('handleChgMaster rejects a mismatched idSelf', () => {
      handler.handleChgMaster(mockSocket() as never, body((w) => {
        w.writeDword(999); w.writeDword(5);
      }));
      assert.equal(harness.calls.length, 0);
      handler.handleChgMaster(mockSocket() as never, body((w) => {
        w.writeDword(PLAYER_ID); w.writeDword(5);
      }));
      assert.deepEqual(harness.calls[0].args, [p, 5]);
    });

    it('handleGuildSetName rejects a mismatched idSelf', () => {
      handler.handleGuildSetName(mockSocket() as never, body((w) => {
        w.writeDword(999); w.writeDword(1); w.writeString('Heroes');
      }));
      assert.equal(harness.calls.length, 0);
      handler.handleGuildSetName(mockSocket() as never, body((w) => {
        w.writeDword(PLAYER_ID); w.writeDword(1); w.writeString('Heroes');
      }));
      assert.deepEqual(harness.calls[0].args, [p, 'Heroes']);
    });

    it('handleGuildPenya rejects a mismatched idSelf', () => {
      handler.handleGuildPenya(mockSocket() as never, body((w) => {
        w.writeDword(999); w.writeDword(1); w.writeDword(2); w.writeDword(500);
      }));
      assert.equal(harness.calls.length, 0);
    });

    it('handleGuildAuthority rejects a mismatched idSelf', () => {
      handler.handleGuildAuthority(mockSocket() as never, body((w) => {
        w.writeDword(999); w.writeDword(1);
        for (let i = 0; i < MAX_GM_LEVEL; i++) w.writeDword(0xff);
      }));
      assert.equal(harness.calls.length, 0);
    });
  });

  describe('handleGuildAuthority', () => {
    it('passes the raw DWORD[5] through in order', () => {
      const mask = [0, PF_INVITATION, PF_MEMBERLEVEL, 0x10, 0xff];
      handler.handleGuildAuthority(mockSocket() as never, body((w) => {
        w.writeDword(PLAYER_ID); w.writeDword(77);
        for (const v of mask) w.writeDword(v);
      }));
      assert.equal(harness.calls[0].method, 'setAuthority');
      assert.deepEqual(harness.calls[0].args, [p, mask]);
    });

    it('consumes 8 + 20 bytes (no count prefix on the blob)', () => {
      const w = new PacketWriter();
      w.writeDword(PLAYER_ID); w.writeDword(77);
      for (let i = 0; i < MAX_GM_LEVEL; i++) w.writeDword(i);
      const reader = new PacketReader(w.build());
      handler.handleGuildAuthority(mockSocket() as never, reader);
      assert.equal(reader.offset, 28);
      assert.equal(reader.remaining, 0);
    });
  });

  describe('handleGuildPenya', () => {
    const penya = (idSelf: number, type: number, amount: number) => body((w) => {
      w.writeDword(idSelf); w.writeDword(1); w.writeDword(type); w.writeDword(amount);
    });

    it('delegates (rank, penya)', () => {
      handler.handleGuildPenya(mockSocket() as never, penya(PLAYER_ID, 4, 500));
      assert.equal(harness.calls[0].method, 'setRankPenya');
      assert.deepEqual(harness.calls[0].args, [p, 4, 500]);
    });

    it('rejects an out-of-range rank rather than indexing past the array', () => {
      handler.handleGuildPenya(mockSocket() as never, penya(PLAYER_ID, MAX_GM_LEVEL, 500));
      handler.handleGuildPenya(mockSocket() as never, penya(PLAYER_ID, 0xffffffff, 500));
      assert.equal(harness.calls.length, 0);
    });
  });

  describe('logo / notice / contribution', () => {
    it('handleGuildLogo delegates the logo id', () => {
      handler.handleGuildLogo(mockSocket() as never, body((w) => w.writeDword(12)));
      assert.equal(harness.calls[0].method, 'setLogo');
      assert.deepEqual(harness.calls[0].args, [p, 12]);
    });

    it('handleGuildNotice delegates the string', () => {
      handler.handleGuildNotice(mockSocket() as never, body((w) => w.writeString('raid at 9')));
      assert.equal(harness.calls[0].method, 'setNotice');
      assert.deepEqual(harness.calls[0].args, [p, 'raid at 9']);
    });

    it('handleGuildContribution consumes BYTE|int|BYTE and delegates nothing (phase 2)', () => {
      const w = new PacketWriter();
      w.writeByte(3); w.writeDword(5000); w.writeByte(1);
      const reader = new PacketReader(w.build());
      handler.handleGuildContribution(mockSocket() as never, reader);
      assert.equal(harness.calls.length, 0, 'not ported yet');
      assert.equal(reader.offset, 6, 'body fully consumed at the right widths');
    });
  });

  describe('truncated packets', () => {
    it('warn-and-drop instead of throwing (GUILD_CLASS body cut short)', () => {
      const sock = mockSocket();
      // Only the BYTE arrived -- the first readDword must not escape.
      assert.doesNotThrow(() => {
        handler.handleGuildClass(sock as never, body((w) => w.writeByte(1)));
      });
      assert.equal(harness.calls.length, 0);
      assert.equal(sock._destroyed, false, 'a malformed packet does not kill the socket');
    });

    it('warn-and-drop on a short GUILD_AUTHORITY blob', () => {
      assert.doesNotThrow(() => {
        handler.handleGuildAuthority(mockSocket() as never, body((w) => {
          w.writeDword(PLAYER_ID); w.writeDword(1); w.writeDword(0xff);
        }));
      });
      assert.equal(harness.calls.length, 0);
    });

    it('warn-and-drop on a missing string', () => {
      assert.doesNotThrow(() => {
        handler.handleGuildNickname(mockSocket() as never, body((w) => {
          w.writeDword(PLAYER_ID); w.writeDword(5);
        }));
      });
      assert.equal(harness.calls.length, 0);
    });
  });
});
