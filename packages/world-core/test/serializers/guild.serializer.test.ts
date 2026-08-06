/**
 * guild.serializer byte-layout tests -- the width traps in `CGuild::Serialize`
 * and the CoreServer guild packet family. A wrong width here desyncs the whole
 * roster on the real v19 client, so the traps are asserted as RAW bytes.
 * @module serializers/guild.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '../../src/snapshot-constants';
import {
  writeCGuild, writeGuildMemberInfo,
  buildGuild, buildAllGuilds, buildSetGuild, buildCreateGuild, buildDestroyGuild,
  buildGuildContribution, buildAddGuildMember, buildChgMaster, buildGuildChat,
  buildGuildAuthority,
  buildGuildBankWindow, buildPutItemGuildBank, buildGetItemGuildBank,
  buildGetGoldGuildBank, buildRemoveGuildBankItem, buildSetGuildQuest,
  MAX_GUILDBANK, MAX_LEN_MOVER_MENU_SQ,
  GUILD_BANK_ECHO_SELF, GUILD_BANK_ECHO_PEER,
  GUILD_BANK_ECHO_PENYA_SELF, GUILD_BANK_ECHO_PENYA_PEER,
  GUILD_MEMBER_INFO_SIZE, GUILD_MULTI_NO_DEFAULT, MAX_GM_LEVEL,
  type GuildSnapshot, type GuildMemberSnapshot,
} from '../../src/serializers/guild.serializer';
import type { InventorySlot } from '@flyff/entities';

/** Common 16-byte snapshot header: [SNAPSHOT:4][NULL_ID:4][count=1:2][objid:4][subtype:2]. */
function assertSnapPrefix(buf: Buffer, recordObjid: number, subtype: number): void {
  assert.equal(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
  assert.equal(buf.readUInt32LE(4), NULL_ID);
  assert.equal(buf.readUInt16LE(8), 1);
  assert.equal(buf.readUInt32LE(10), recordObjid);
  assert.equal(buf.readUInt16LE(14), subtype);
}

const GUILD_NAME = 'Knights';   // 7
const GUILD_NOTICE = 'hello';   // 5

function makeMember(over: Partial<GuildMemberSnapshot> = {}): GuildMemberSnapshot {
  return {
    id: 0x0a0b0c0d, pay: 1, giveGold: 2, givePxp: 3,
    win: 0x1234, lose: 0x5678, memberLv: 4,
    selectedVoteId: 0, surrender: 0, cls: 0, alias: '',
    ...over,
  };
}

function makeGuild(over: Partial<GuildSnapshot> = {}): GuildSnapshot {
  return {
    id: 0x11, masterId: 0x22, level: 0x33, name: GUILD_NAME,
    logo: 3, gold: 1000, win: 5, lose: 6, surrender: 7,
    power: [0xff, 1, 2, 3, 4], penya: [10, 20, 30, 40, 50],
    notice: GUILD_NOTICE, contributionPxp: 999, enemyGuildId: 0,
    members: [],
    ...over,
  };
}

/** Byte length of the descriptor (bDesc=TRUE) form for a name of `n` chars. */
const descLen = (n: number): number => 12 + (4 + n) + 20;

describe('writeCGuild (bDesc = TRUE, descriptor form)', () => {
  it('stops after m_nSurrender -- no power/penya/roster trail', () => {
    const w = new PacketWriter();
    writeCGuild(w, makeGuild(), true);
    const buf = w.build();
    // id+master+level (12) | name (4+7) | logo+gold+win+lose+surrender (20)
    assert.equal(buf.length, descLen(GUILD_NAME.length));
    assert.equal(buf.length, 43);
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), 0x11);
    assert.equal(r.readDword(), 0x22);
    assert.equal(r.readDword(), 0x33);
    assert.equal(r.readString(), GUILD_NAME);
    assert.equal(r.readDword(), 3);    // logo
    assert.equal(r.readDword(), 1000); // gold
    assert.equal(r.readDword(), 5);    // win  -- int, 4 bytes on the guild
    assert.equal(r.readDword(), 6);    // lose -- int
    assert.equal(r.readDword(), 7);    // surrender
    assert.equal(r.remaining, 0, 'descriptor form has no tail');
  });

  it('roster is ignored entirely in descriptor form', () => {
    const w = new PacketWriter();
    writeCGuild(w, makeGuild({ members: [makeMember(), makeMember()] }), true);
    assert.equal(w.build().length, descLen(GUILD_NAME.length));
  });
});

describe('writeCGuild (bDesc = FALSE, full form)', () => {
  const N = GUILD_NAME.length;
  const M = GUILD_NOTICE.length;
  /** Offset of the header m_nLevel (guild.cpp:413). */
  const OFF_LEVEL_1 = 8;
  /** Offset of the SECOND m_nLevel, after the notice (guild.cpp:424). */
  const OFF_LEVEL_2 = 12 + (4 + N) + 20 + 20 + 20 + (4 + M) + 4;

  it('writes m_nLevel TWICE -- header and again after the notice', () => {
    const w = new PacketWriter();
    writeCGuild(w, makeGuild({ level: 0x2a }), false);
    const buf = w.build();
    assert.equal(buf.readUInt32LE(OFF_LEVEL_1), 0x2a, 'header m_nLevel (guild.cpp:413)');
    assert.equal(buf.readUInt32LE(OFF_LEVEL_2), 0x2a, 'second m_nLevel (guild.cpp:424)');
    // The client reads it twice (:445, :456). Dropping either shifts the roster.
    assert.equal(OFF_LEVEL_2, 84 + N + M);
    // m_idEnemyGuild sits immediately after the second level.
    assert.equal(buf.readUInt32LE(OFF_LEVEL_2 + 4), 0, 'm_idEnemyGuild');
  });

  it('power + penya are raw 20-byte blobs with NO count prefix', () => {
    const power = [0xff, 0x01, 0x02, 0x03, 0x04];
    const penya = [100, 200, 300, 400, 500];
    const w = new PacketWriter();
    writeCGuild(w, makeGuild({ power, penya }), false);
    const buf = w.build();
    const off = descLen(N); // first byte after the descriptor header
    for (let i = 0; i < MAX_GM_LEVEL; i++) {
      assert.equal(buf.readUInt32LE(off + i * 4), power[i], `m_adwPower[${i}]`);
      assert.equal(buf.readUInt32LE(off + 20 + i * 4), penya[i], `m_adwPenya[${i}]`);
    }
    // The notice string starts right after 40 raw bytes -- a count prefix on
    // either array would put a bogus length DWORD here.
    assert.equal(buf.readUInt32LE(off + 40), M, 'notice length DWORD follows the blobs');
  });

  it('short power/penya arrays still emit exactly 20 bytes each', () => {
    const w = new PacketWriter();
    writeCGuild(w, makeGuild({ power: [1], penya: [] }), false);
    const buf = w.build();
    const off = descLen(N);
    assert.equal(buf.readUInt32LE(off), 1);
    for (let i = 1; i < MAX_GM_LEVEL; i++) assert.equal(buf.readUInt32LE(off + i * 4), 0);
    for (let i = 0; i < MAX_GM_LEVEL; i++) assert.equal(buf.readUInt32LE(off + 20 + i * 4), 0);
    assert.equal(buf.readUInt32LE(off + 40), M);
  });

  it('empty full form total length is exact (member count WORD + vote WORD + quest BYTE)', () => {
    const w = new PacketWriter();
    writeCGuild(w, makeGuild(), false);
    // desc header | power 20 | penya 20 | notice 4+M | pxp 4 | level 4 |
    // enemy 4 | memberCount 2 | voteCount 2 | questSize 1
    assert.equal(w.build().length, descLen(N) + 20 + 20 + (4 + M) + 4 + 4 + 4 + 2 + 2 + 1);
  });

  describe('member entry widths (the roster desync trap)', () => {
    const OFF_MEMBERS = 84 + N + M + 4 /* level2 */ + 4 /* enemy */ + 2 /* count WORD */;

    it('win/lose are 2 bytes each and memberLv is 1 byte', () => {
      const w = new PacketWriter();
      writeCGuild(w, makeGuild({ members: [makeMember()] }), false);
      const buf = w.build();
      assert.equal(buf.readUInt16LE(OFF_MEMBERS - 2), 1, '(short)GetSize() member count');
      const m = OFF_MEMBERS;
      assert.equal(buf.readUInt32LE(m + 0), 0x0a0b0c0d, 'm_idPlayer');
      assert.equal(buf.readUInt32LE(m + 4), 1, 'm_nPay');
      assert.equal(buf.readUInt32LE(m + 8), 2, 'm_nGiveGold');
      assert.equal(buf.readUInt32LE(m + 12), 3, 'm_dwGivePxpCount');
      // RAW bytes: 34 12 = win (short), 78 56 = lose (short), 04 = memberLv (BYTE).
      assert.deepEqual(
        [...buf.subarray(m + 16, m + 21)],
        [0x34, 0x12, 0x78, 0x56, 0x04],
        'win:short lose:short memberLv:BYTE -- any widening shifts the rest',
      );
      assert.equal(buf.readUInt32LE(m + 21), 0, 'm_idSelectedVoteId');
      assert.equal(buf.readUInt32LE(m + 25), 0, 'm_nSurrender');
      assert.equal(buf.readUInt32LE(m + 29), 0, 'm_nClass');
      assert.equal(buf.readUInt32LE(m + 33), 0, 'm_szAlias length (empty)');
      // 33 fixed bytes + string. A DWORD win/lose/memberLv would make it 42.
      assert.equal(buf.length, OFF_MEMBERS + 33 + 4 + 2 + 1);
    });

    it('member entry is 33 bytes + alias string', () => {
      const w1 = new PacketWriter();
      writeCGuild(w1, makeGuild({ members: [makeMember({ alias: 'Bo' })] }), false);
      const w0 = new PacketWriter();
      writeCGuild(w0, makeGuild(), false);
      assert.equal(w1.build().length - w0.build().length, 33 + 4 + 2);
    });

    it('two members are laid out back to back with no padding', () => {
      const w = new PacketWriter();
      writeCGuild(w, makeGuild({
        members: [makeMember({ id: 1 }), makeMember({ id: 2, win: 0xabcd, lose: 0x0f0e, memberLv: 0 })],
      }), false);
      const buf = w.build();
      assert.equal(buf.readUInt16LE(OFF_MEMBERS - 2), 2);
      const second = OFF_MEMBERS + 37; // 33 + empty alias length DWORD
      assert.equal(buf.readUInt32LE(second), 2, 'second m_idPlayer');
      assert.deepEqual(
        [...buf.subarray(second + 16, second + 21)],
        [0xcd, 0xab, 0x0e, 0x0f, 0x00],
      );
    });
  });
});

describe('buildGuild (SNAPSHOTTYPE_GUILD)', () => {
  it('snapshot frame + leading idGuild before the serialize (id appears twice)', () => {
    const buf = buildGuild(makeGuild());
    assertSnapPrefix(buf, NULL_ID, SNAPSHOTTYPE.GUILD);
    assert.equal(buf.readUInt32LE(16), 0x11, 'leading DWORD idGuild');
    assert.equal(buf.readUInt32LE(20), 0x11, 'CGuild::Serialize starts with m_idGuild again');
    const w = new PacketWriter();
    writeCGuild(w, makeGuild(), false);
    assert.equal(buf.length, 16 + 4 + w.build().length);
  });
});

describe('buildAllGuilds (SNAPSHOTTYPE_ALL_GUILDS)', () => {
  it('header is idCounter then count, then N descriptor bodies', () => {
    const a = makeGuild({ id: 1, name: 'AA' });
    const b = makeGuild({ id: 2, name: 'BBB' });
    const buf = buildAllGuilds(0x77, [a, b]);
    assertSnapPrefix(buf, NULL_ID, SNAPSHOTTYPE.ALL_GUILDS);
    assert.equal(buf.readUInt32LE(16), 0x77, 'm_id (the id counter)');
    assert.equal(buf.readUInt32LE(20), 2, 'int count');
    assert.equal(buf.readUInt32LE(24), 1, 'first descriptor m_idGuild');
    const firstLen = descLen(2);
    assert.equal(buf.readUInt32LE(24 + firstLen), 2, 'second descriptor m_idGuild');
    assert.equal(buf.length, 24 + descLen(2) + descLen(3), 'descriptor bodies only, nothing trails');
  });

  it('empty shard writes counter + zero count only', () => {
    const buf = buildAllGuilds(0, []);
    assert.equal(buf.length, 24);
  });
});

describe('buildSetGuild (SNAPSHOTTYPE_SET_GUILD)', () => {
  it('the record objid is the AFFECTED mover, not NULL_ID', () => {
    const buf = buildSetGuild(0x1234, 9);
    assertSnapPrefix(buf, 0x1234, SNAPSHOTTYPE.SET_GUILD);
    assert.notEqual(buf.readUInt32LE(10), NULL_ID);
    assert.equal(buf.readUInt32LE(16), 9, 'idGuild');
    assert.equal(buf.length, 20);
  });
});

describe('CREATE_GUILD vs DESTROY_GUILD field order', () => {
  it('buildCreateGuild writes the ids FIRST, then both names', () => {
    const buf = buildCreateGuild(0xaa, 0xbb, 'Alice', 'Knights');
    assertSnapPrefix(buf, NULL_ID, SNAPSHOTTYPE.CREATE_GUILD);
    const r = new PacketReader(buf.subarray(16));
    assert.equal(r.readDword(), 0xaa, 'idPlayer');
    assert.equal(r.readDword(), 0xbb, 'idGuild');
    assert.equal(r.readString(), 'Alice');
    assert.equal(r.readString(), 'Knights');
    assert.equal(r.remaining, 0);
  });

  it('buildDestroyGuild writes the NAME first, then the id (reversed)', () => {
    const buf = buildDestroyGuild('Alice', 0xbb);
    assertSnapPrefix(buf, NULL_ID, SNAPSHOTTYPE.DESTROY_GUILD);
    assert.equal(buf.readUInt32LE(16), 'Alice'.length, 'a leading DWORD id would break this');
    const r = new PacketReader(buf.subarray(16));
    assert.equal(r.readString(), 'Alice');
    assert.equal(r.readDword(), 0xbb, 'idGuild comes LAST');
    assert.equal(r.remaining, 0);
    assert.equal(buf.length, 16 + 4 + 5 + 4);
  });
});

describe('buildGuildContribution (SNAPSHOTTYPE_GUILD_CONTRIBUTION)', () => {
  it('nGuildLevel is a WORD -- payload is 6 DWORDs + 2 bytes', () => {
    const buf = buildGuildContribution(1, 2, 3, 4, 5, 6, 0x1234);
    assertSnapPrefix(buf, NULL_ID, SNAPSHOTTYPE.GUILD_CONTRIBUTION);
    for (let i = 0; i < 6; i++) assert.equal(buf.readUInt32LE(16 + i * 4), i + 1);
    assert.deepEqual([...buf.subarray(40, 42)], [0x34, 0x12], 'WORD nGuildLevel');
    // 16 head + 24 + 2. A DWORD level would make this 44 and trail 2 junk bytes.
    assert.equal(buf.length, 42);
  });
});

describe('GUILD_MEMBER_INFO is 8 bytes (padded C struct)', () => {
  it('writeGuildMemberInfo emits 4 id + 1 multiNo + 3 tail padding', () => {
    const w = new PacketWriter();
    writeGuildMemberInfo(w, 0x04030201);
    const buf = w.build();
    assert.equal(buf.length, GUILD_MEMBER_INFO_SIZE);
    assert.equal(GUILD_MEMBER_INFO_SIZE, 8, 'sizeof(GUILD_MEMBER_INFO) with MSVC padding');
    assert.deepEqual([...buf], [0x01, 0x02, 0x03, 0x04, GUILD_MULTI_NO_DEFAULT, 0, 0, 0]);
  });

  it('multiNo is overridable and truncated to a BYTE', () => {
    const w = new PacketWriter();
    writeGuildMemberInfo(w, 1, 0x1ff);
    assert.equal(w.build().readUInt8(4), 0xff);
  });

  it('buildAddGuildMember lays the 8-byte struct before idGuild + name', () => {
    const buf = buildAddGuildMember(0x0d0c0b0a, 0x55, 'Bob');
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.ADD_GUILD_MEMBER, 'direct packet -- no snapshot frame');
    assert.equal(buf.readUInt32LE(4), 0x0d0c0b0a, 'idPlayer');
    assert.deepEqual([...buf.subarray(8, 12)], [GUILD_MULTI_NO_DEFAULT, 0, 0, 0], 'nMultiNo + padding');
    assert.equal(buf.readUInt32LE(12), 0x55, 'idGuild -- at +12, NOT +9');
    const r = new PacketReader(buf.subarray(16));
    assert.equal(r.readString(), 'Bob');
    // 4 opcode + 8 struct + 4 idGuild + 4 len + 3 name. A 5-byte struct = 20.
    assert.equal(buf.length, 23);
  });
});

describe('frame shapes', () => {
  it('snapshot builder: SNAPSHOT | NULL_ID | WORD 1 | objid | WORD subtype | body', () => {
    const buf = buildGuildAuthority([1, 2, 3, 4, 5]);
    assertSnapPrefix(buf, NULL_ID, SNAPSHOTTYPE.GUILD_AUTHORITY);
    // Raw DWORD[5], no count prefix.
    for (let i = 0; i < MAX_GM_LEVEL; i++) assert.equal(buf.readUInt32LE(16 + i * 4), i + 1);
    assert.equal(buf.length, 16 + 20);
  });

  it('direct builder: DWORD PACKETTYPE | body, with no snapshot header', () => {
    const buf = buildChgMaster(0x11, 0x22);
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.CHG_MASTER);
    assert.notEqual(buf.readUInt32LE(0), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(4), 0x11, 'idOldMaster');
    assert.equal(buf.readUInt32LE(8), 0x22, 'idNewMaster');
    assert.equal(buf.length, 12, 'no 16-byte snapshot prefix');
  });

  it('buildGuildChat is a direct packet: opcode | objid | name | chat', () => {
    const buf = buildGuildChat(0x99, 'Alice', 'hi');
    assert.equal(buf.readUInt32LE(0), PACKETTYPE.GUILD_CHAT);
    const r = new PacketReader(buf.subarray(4));
    assert.equal(r.readDword(), 0x99, 'speaker objid');
    assert.equal(r.readString(), 'Alice');
    assert.equal(r.readString(), 'hi');
    assert.equal(r.remaining, 0);
  });
});

// ── Guild bank ──────────────────────────────────────────────────────────────

/** A bank slot fixture -- every instance field concrete, as a bank row is. */
function bankItem(over: Partial<InventorySlot> = {}): InventorySlot {
  return {
    itemId: 0x1234, count: 3, objid: 0, refine: 0, element: 0,
    element_level: 0, flags: 0, durability: -1,
    ...over,
  };
}

/** An empty 42-slot bank. */
const emptyBank = (): (InventorySlot | null)[] =>
  new Array<InventorySlot | null>(MAX_GUILDBANK).fill(null);

describe('buildGuildBankWindow (SNAPSHOTTYPE_GUILD_BANK_WND)', () => {
  it('objid is SELF, not NULL_ID -- this is a per-user window', () => {
    const buf = buildGuildBankWindow(0x777, 0, 500, emptyBank());
    assertSnapPrefix(buf, 0x777, SNAPSHOTTYPE.GUILD_BANK_WND);
    assert.notEqual(buf.readUInt32LE(10), NULL_ID, 'unlike the guild-wide records');
    assert.equal(buf.readUInt32LE(16), 0, 'nMode -- 0 on open (DPSrvr.cpp:3290)');
    assert.equal(buf.readUInt32LE(20), 500, 'm_nGoldGuild');
  });

  it('the container writes 42 identity m_apIndex DWORDs, then chSize', () => {
    const buf = buildGuildBankWindow(1, 0, 0, emptyBank());
    const off = 16 + 4 + 4; // after mode + gold
    for (let i = 0; i < MAX_GUILDBANK; i++) {
      assert.equal(buf.readUInt32LE(off + i * 4), i, `m_apIndex[${i}] identity`);
    }
    assert.equal(buf.readUInt8(off + MAX_GUILDBANK * 4), 0, 'chSize -- empty bank');
    // 42 index DWORDs + chSize + 42 adwObjIndex DWORDs and nothing else.
    assert.equal(buf.length, off + MAX_GUILDBANK * 4 + 1 + MAX_GUILDBANK * 4);
    assert.equal(buf.length, 361);
  });

  it('a populated bank is longer, and the occupied entries carry slot + body', () => {
    const bank = emptyBank();
    bank[0] = bankItem({ itemId: 0xaaaa });
    bank[5] = bankItem({ itemId: 0xbbbb, count: 7 });
    const buf = buildGuildBankWindow(1, 0, 0, bank);
    const empty = buildGuildBankWindow(1, 0, 0, emptyBank());
    assert.ok(buf.length > empty.length, 'occupied entries add bytes');
    const off = 24;
    assert.equal(buf.readUInt8(off + MAX_GUILDBANK * 4), 2, 'chSize = 2 occupied');
    const first = off + MAX_GUILDBANK * 4 + 1;
    assert.equal(buf.readUInt8(first), 0, 'first occupied slot index');
    assert.equal(buf.readUInt32LE(first + 1), 0, 'm_dwObjId = slot');
    assert.equal(buf.readUInt32LE(first + 5), 0xaaaa, 'm_dwItemId');
    // Each occupied entry is 1 slot byte + one CItemElem body, uniform width.
    const entry = (buf.length - empty.length) / 2;
    const second = first + entry;
    assert.equal(buf.readUInt8(second), 5, 'second occupied slot index');
    assert.equal(buf.readUInt32LE(second + 5), 0xbbbb);
  });
});

describe('PUT/GET item guild bank echoes (leading recipient BYTE)', () => {
  const item = bankItem();

  it('buildPutItemGuildBank puts the recipient byte at +16, body at +17', () => {
    const self = buildPutItemGuildBank(0x42, GUILD_BANK_ECHO_SELF, 9, item);
    assertSnapPrefix(self, 0x42, SNAPSHOTTYPE.PUTITEMGUILDBANK);
    assert.equal(self.readUInt8(16), 1, 'GUILD_BANK_ECHO_SELF');
    assert.equal(self.readUInt32LE(17), 9, 'CItemBase m_dwObjId starts at +17');
    assert.equal(self.readUInt32LE(21), item.itemId, 'm_dwItemId');

    const peer = buildPutItemGuildBank(0x42, GUILD_BANK_ECHO_PEER, 9, item);
    assert.equal(peer.readUInt8(16), 3, 'GUILD_BANK_ECHO_PEER');
    assert.equal(peer.length, self.length, 'one byte discriminator, same body');
    // Only the discriminator byte differs.
    assert.deepEqual(peer.subarray(17), self.subarray(17));
  });

  it('buildGetItemGuildBank uses the same 1-byte prefix on subtype 0x00d4', () => {
    const self = buildGetItemGuildBank(0x42, GUILD_BANK_ECHO_SELF, 9, item);
    assertSnapPrefix(self, 0x42, SNAPSHOTTYPE.GETITEMGUILDBANK);
    assert.equal(SNAPSHOTTYPE.GETITEMGUILDBANK, 0x00d4);
    assert.equal(self.readUInt8(16), 1);
    assert.equal(self.readUInt32LE(17), 9, 'objId, NOT the slot index');
    const peer = buildGetItemGuildBank(0x42, GUILD_BANK_ECHO_PEER, 9, item);
    assert.equal(peer.readUInt8(16), 3);
    assert.equal(peer.length, self.length);
  });

  it('the recipient byte truncates and never widens the body offset', () => {
    const a = buildPutItemGuildBank(1, 0x101, 0, item);
    assert.equal(a.readUInt8(16), 0x01, 'masked to a BYTE');
    assert.equal(a.length, buildPutItemGuildBank(1, 1, 0, item).length);
  });
});

describe('buildGetGoldGuildBank (the 0x00d4 multiplex trap)', () => {
  it('shares the item subtype but has a completely different body', () => {
    const penya = buildGetGoldGuildBank(0x42, GUILD_BANK_ECHO_PENYA_SELF, 1234, 0x55);
    const asItem = buildGetItemGuildBank(0x42, GUILD_BANK_ECHO_SELF, 1234, bankItem());
    assert.equal(penya.readUInt16LE(14), asItem.readUInt16LE(14), 'same subtype 0x00d4');
    assert.notEqual(penya.length, asItem.length, 'but NOT the same body -- do not unify');
    // BYTE mode | DWORD gold | DWORD playerId | BYTE cbCloak
    assert.equal(penya.length, 16 + 1 + 4 + 4 + 1);
    assert.equal(penya.readUInt8(16), 0, 'mode 0 = PENYA_SELF');
    assert.equal(penya.readUInt32LE(17), 1234, 'gold');
    assert.equal(penya.readUInt32LE(21), 0x55, 'the WITHDRAWER id');
    assert.equal(penya.readUInt8(25), 0, 'cbCloak defaults to 0');
  });

  it('the mode byte is 0 (self) or 2 (peer) -- never the item 1/3', () => {
    for (const mode of [GUILD_BANK_ECHO_PENYA_SELF, GUILD_BANK_ECHO_PENYA_PEER]) {
      const buf = buildGetGoldGuildBank(1, mode, 1, 1);
      assert.equal(buf.readUInt8(16), mode);
      assert.equal(mode % 2, 0, 'penya modes are even; item modes 1/3 are odd');
      assert.notEqual(mode, GUILD_BANK_ECHO_SELF);
      assert.notEqual(mode, GUILD_BANK_ECHO_PEER);
    }
  });

  it('cloak is overridable and truncated to a BYTE', () => {
    const buf = buildGetGoldGuildBank(1, GUILD_BANK_ECHO_PENYA_PEER, 7, 8, 0x1ff);
    assert.equal(buf.readUInt8(25), 0xff);
    assert.equal(buf.length, 26, 'still 26 bytes');
  });
});

describe('buildRemoveGuildBankItem (SNAPSHOTTYPE_REMOVE_GUILD_BANK_ITEM)', () => {
  it('body is idGuild | objId | itemNum, in that order', () => {
    const buf = buildRemoveGuildBankItem(0x42, 0x11, 0x22, 0x33);
    assertSnapPrefix(buf, 0x42, SNAPSHOTTYPE.REMOVE_GUILD_BANK_ITEM);
    const r = new PacketReader(buf.subarray(16));
    assert.equal(r.readDword(), 0x11, 'idGuild');
    assert.equal(r.readDword(), 0x22, 'dwId (objId)');
    assert.equal(r.readDword(), 0x33, 'dwItemNum');
    assert.equal(r.remaining, 0);
    assert.equal(buf.length, 28);
  });
});

describe('guild bank constants', () => {
  it('MAX_GUILDBANK is 42 and the proximity gate is squared', () => {
    assert.equal(MAX_GUILDBANK, 42);
    assert.equal(MAX_LEN_MOVER_MENU_SQ, 1024, 'MAX_LEN_MOVER_MENU = 1024, already squared-space');
  });
});

/**
 * The quest ledger is the TAIL of `CGuild::Serialize` (`guild.cpp:433-434`):
 * a BYTE `m_nQuestSize` then a raw blit of 12-byte `GUILDQUEST` records. The
 * count byte is the trap -- `m_nQuestSize` is a `BYTE` (`guild.h:348`) against
 * `MAX_GUILD_QUEST == 256`, so the original's own count wraps.
 */
describe('quest ledger tail of writeCGuild', () => {
  it('writes a zero count byte when there are no entries', () => {
    const w = new PacketWriter();
    writeCGuild(w, makeGuild(), false);
    const buf = w.build();
    assert.equal(buf[buf.length - 1], 0, 'trailing m_nQuestSize == 0');
  });

  it('writes count then 12 bytes per entry, in nId/nState/idGuild order', () => {
    const w = new PacketWriter();
    writeCGuild(w, makeGuild({
      quests: [
        { nId: 1, nState: 14, idGuild: 0 },
        { nId: 2, nState: 0, idGuild: 0 },
      ],
    }), false);
    const buf = w.build();
    const tail = buf.subarray(buf.length - (1 + 24));
    assert.equal(tail[0], 2, 'm_nQuestSize');
    assert.equal(tail.readUInt32LE(1), 1);
    assert.equal(tail.readUInt32LE(5), 14);
    assert.equal(tail.readUInt32LE(9), 0, 'idGuild is 0 -- SetQuest never assigns it');
    assert.equal(tail.readUInt32LE(13), 2);
    assert.equal(tail.readUInt32LE(17), 0);
    assert.equal(tail.readUInt32LE(21), 0);
  });
});

describe('buildSetGuildQuest (SNAPSHOTTYPE_SETGUILDQUEST)', () => {
  it('body is nQuestId | nState on the recipient objid', () => {
    const buf = buildSetGuildQuest(0x42, 1, 14);
    assertSnapPrefix(buf, 0x42, SNAPSHOTTYPE.SETGUILDQUEST);
    const r = new PacketReader(buf.subarray(16));
    assert.equal(r.readDword(), 1, 'nQuestId');
    assert.equal(r.readDword(), 14, 'nState');
    assert.equal(r.remaining, 0);
    assert.equal(buf.length, 24);
  });

  it('the subtype is 0x00b5, distinct from REMOVEGUILDQUEST 0x00b6', () => {
    // 0x00b6 has a writer in C++ but no reachable caller -- `CGuild::RemoveQuest`
    // returns above its notify loop (`guild.cpp:952`) -- so a faithful port never
    // sends it. Pinning both numbers keeps a future edit from swapping them.
    assert.equal(SNAPSHOTTYPE.SETGUILDQUEST, 0x00b5);
    assert.equal(SNAPSHOTTYPE.REMOVEGUILDQUEST, 0x00b6);
  });
});
