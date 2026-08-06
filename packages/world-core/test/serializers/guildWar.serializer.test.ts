/**
 * Guild war byte-layout tests -- appended to the guild serializer suite.
 * `CGuildWar::Serialize` is 50 flat bytes with two RAW 20-byte blobs, a
 * single-byte char flag, and a 32-bit time_t; every one of those is a width
 * trap that desyncs the JOIN stream if widened.
 * @module serializers/guildWar.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '../../src/snapshot-constants';
import {
  writeCGuildWar, buildSetWar, buildMyGuildWar,
  buildDeclWar, buildAcptWar, buildSurrender, buildQueryTruce,
  buildWarEnd, buildWarDead,
  WF_WARTIME, WF_END, WR_DECL_GN, WR_ACPT_GN, WR_TRUCE, WR_DRAW,
  GUILD_WAR_DURATION_MS, GUILD_WAR_MIN_LEVEL, GUILD_WAR_MIN_TARGET_MEMBERS,
  GUILD_WAR_SURRENDER_PERCENT,
  type GuildWarSnapshot, type WarEntry,
} from '../../src/serializers/guild.serializer';

/** Common 16-byte snapshot header. */
function assertSnapPrefix(buf: Buffer, recordObjid: number, subtype: number): void {
  assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
  assert.equal(buf.readUInt32LE(4), NULL_ID);
  assert.equal(buf.readUInt16LE(8), 1);
  assert.equal(buf.readUInt32LE(10), recordObjid);
  assert.equal(buf.readUInt16LE(14), subtype);
}

function makeEntry(over: Partial<WarEntry> = {}): WarEntry {
  return { guildId: 0x1111, size: 12, surrender: 0, dead: 0, absent: 0, ...over };
}

function makeWar(over: Partial<GuildWarSnapshot> = {}): GuildWarSnapshot {
  return {
    id: 0x77, decl: makeEntry(), acpt: makeEntry({ guildId: 0x2222, size: 15 }),
    flag: WF_WARTIME, startedAtSec: 0x60000000,
    ...over,
  };
}

describe('WF_* / WR_* constants', () => {
  it('WF_* are ASCII CHARACTER codes, not small integers', () => {
    // `#define WF_WARTIME  0-char` (guildwar.h:16) -- the field is a C `char`
    // holding the DIGIT character. A naive 0 would read as an unknown flag.
    assert.equal(WF_WARTIME, 0x30, 'WF_WARTIME is the character zero = 48');
    assert.equal(WF_END, 0x39, 'WF_END is the character nine = 57');
  });

  it('WR_DECL_GN is 0 and WR_ACPT_GN is 1 -- OnWarDead passes (int)bDecl as the type', () => {
    // `Result( pWar, pDecl, pAcpt, (int)bDecl )` (DPCoreSrvr.cpp:1647) only maps
    // onto the correct winner because of these two ordinals.
    assert.equal(WR_DECL_GN, 0);
    assert.equal(WR_ACPT_GN, 1);
  });

  it('TRUCE and DRAW sort ABOVE every win type -- Result gates on nType < WR_TRUCE', () => {
    assert.equal(WR_TRUCE, 8);
    assert.equal(WR_DRAW, 9);
    for (const win of [WR_DECL_GN, WR_ACPT_GN]) assert.ok(win < WR_TRUCE);
  });

  it('duration is the retail 2 hours, not the dead __INTERNALSERVER 10 minutes', () => {
    assert.equal(GUILD_WAR_DURATION_MS, 7_200_000);
  });

  it('declare gates match the live #ifndef __INTERNALSERVER arms', () => {
    assert.equal(GUILD_WAR_MIN_LEVEL, 6);
    assert.equal(GUILD_WAR_MIN_TARGET_MEMBERS, 10);
    assert.equal(GUILD_WAR_SURRENDER_PERCENT, 70);
  });
});

describe('writeCGuildWar', () => {
  it('is exactly 49 bytes: DWORD | 20B raw | 20B raw | BYTE | DWORD', () => {
    // 4 + 20 + 20 + 1 + 4. The odd total is the point: m_nFlag is a single byte
    // between two 4-aligned fields and CAr does NOT pad, so the trailing time_t
    // lands on an UNALIGNED offset (45). ar.h:253 casts through UNALIGNED for
    // exactly this reason.
    const w = new PacketWriter();
    writeCGuildWar(w, makeWar());
    assert.equal(w.build().length, 49);
  });

  it('m_nFlag occupies ONE byte -- char never widens', () => {
    const w = new PacketWriter();
    writeCGuildWar(w, makeWar({ flag: WF_END }));
    const buf = w.build();
    assert.equal(buf.readUInt8(44), WF_END, 'flag byte sits at 4+20+20');
    assert.equal(buf.length, 49, 'a DWORD flag would make this 52');
  });

  it('start time is 4 bytes -- _USE_32BIT_TIME_T in every server StdAfx.h', () => {
    const w = new PacketWriter();
    writeCGuildWar(w, makeWar({ startedAtSec: 0x7fffffff }));
    const buf = w.build();
    assert.equal(buf.readUInt32LE(45), 0x7fffffff);
    assert.equal(buf.length, 49, 'an 8-byte time_t would make this 53');
  });

  it('WAR_ENTRY field order is guildId, size, surrender, dead, absent', () => {
    const w = new PacketWriter();
    writeCGuildWar(w, makeWar({
      decl: { guildId: 0xa1, size: 0xa2, surrender: 0xa3, dead: 0xa4, absent: 0xa5 },
    }));
    const buf = w.build();
    assert.equal(buf.readUInt32LE(4), 0xa1, 'idGuild');
    assert.equal(buf.readUInt32LE(8), 0xa2, 'nSize');
    assert.equal(buf.readUInt32LE(12), 0xa3, 'nSurrender');
    assert.equal(buf.readUInt32LE(16), 0xa4, 'nDead');
    assert.equal(buf.readUInt32LE(20), 0xa5, 'nAbsent');
  });

  it('decl precedes acpt', () => {
    const w = new PacketWriter();
    writeCGuildWar(w, makeWar({
      decl: makeEntry({ guildId: 0xdec1 }), acpt: makeEntry({ guildId: 0xacc7 }),
    }));
    const buf = w.build();
    assert.equal(buf.readUInt32LE(4), 0xdec1);
    assert.equal(buf.readUInt32LE(24), 0xacc7);
  });
});

describe('buildSetWar (SNAPSHOTTYPE_SET_WAR)', () => {
  it('objid is the AFFECTED mover, body is a single idWar', () => {
    const buf = buildSetWar(0xabc, 0x77);
    assertSnapPrefix(buf, 0xabc, SNAPSHOTTYPE.SET_WAR);
    const r = new PacketReader(buf.subarray(16));
    assert.equal(r.readDword(), 0x77);
    assert.equal(r.remaining, 0);
  });

  it('idWar 0 is the war-over signal', () => {
    assert.equal(buildSetWar(0xabc, 0).readUInt32LE(16), 0);
  });
});

describe('buildMyGuildWar (SNAPSHOTTYPE_WAR)', () => {
  it('writes idWar TWICE -- bare DWORD then Serialize repeats it', () => {
    // User.cpp:1942 writes pWar->m_idWar, then :1943 calls Serialize whose first
    // field is m_idWar again; DPClientGuildWar.cpp:193-226 reads it twice.
    // Collapsing the duplicate desyncs every field after it.
    const buf = buildMyGuildWar(makeWar({ id: 0x5151 }));
    assertSnapPrefix(buf, NULL_ID, SNAPSHOTTYPE.WAR);
    assert.equal(buf.readUInt32LE(16), 0x5151, 'the bare leading idWar');
    assert.equal(buf.readUInt32LE(20), 0x5151, 'and again as Serialize field 1');
  });

  it('total length is header + 4 duplicate + 49 serialized', () => {
    assert.equal(buildMyGuildWar(makeWar()).length, 16 + 4 + 49);
  });
});

describe('war packet builders', () => {
  it('buildDeclWar: idDecl then master NAME (not the target guild name)', () => {
    const buf = buildDeclWar(0x99, 'Alice');
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.DECL_GUILD_WAR);
    const r = new PacketReader(buf.subarray(4));
    assert.equal(r.readDword(), 0x99);
    assert.equal(r.readString(), 'Alice');
    assert.equal(r.remaining, 0);
  });

  it('buildAcptWar: idWar, idDecl, idAcpt', () => {
    const buf = buildAcptWar(1, 2, 3);
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.ACPT_GUILD_WAR);
    const r = new PacketReader(buf.subarray(4));
    assert.deepEqual([r.readDword(), r.readDword(), r.readDword()], [1, 2, 3]);
    assert.equal(r.remaining, 0);
  });

  it('buildSurrender: bDecl is a 4-byte BOOL, not a byte', () => {
    const buf = buildSurrender(0x11, 0x22, 'Bob', true);
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.SURRENDER);
    const r = new PacketReader(buf.subarray(4));
    assert.equal(r.readDword(), 0x11, 'idWar');
    assert.equal(r.readDword(), 0x22, 'idPlayer');
    assert.equal(r.readString(), 'Bob');
    assert.equal(r.readDword(), 1, 'BOOL bDecl -- sizeof(BOOL) is 4');
    assert.equal(r.remaining, 0);
  });

  it('buildQueryTruce has an EMPTY body', () => {
    const buf = buildQueryTruce();
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.QUERY_TRUCE);
    assert.equal(buf.length, 4, 'opcode only -- SendQueryTruce writes nothing');
  });

  it('buildWarEnd: idWar, both win points, then the WR_* type', () => {
    const buf = buildWarEnd(0x77, 120, 80, WR_ACPT_GN);
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.WAR_END);
    const r = new PacketReader(buf.subarray(4));
    assert.equal(r.readDword(), 0x77);
    assert.equal(r.readDword(), 120, 'nWptDecl');
    assert.equal(r.readDword(), 80, 'nWptAcpt');
    assert.equal(r.readDword(), WR_ACPT_GN);
    assert.equal(r.remaining, 0);
  });

  it('carries TRUCE/DRAW as themselves even though they change no record', () => {
    assert.equal(buildWarEnd(1, 0, 0, WR_TRUCE).readUInt32LE(16), WR_TRUCE);
    assert.equal(buildWarEnd(1, 0, 0, WR_DRAW).readUInt32LE(16), WR_DRAW);
  });

  it('buildWarDead: idWar, player name, 4-byte BOOL bDecl', () => {
    const buf = buildWarDead(0x77, 'Carol', false);
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.WAR_DEAD);
    const r = new PacketReader(buf.subarray(4));
    assert.equal(r.readDword(), 0x77);
    assert.equal(r.readString(), 'Carol');
    assert.equal(r.readDword(), 0);
    assert.equal(r.remaining, 0);
  });
});
