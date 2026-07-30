/**
 * Tests for the surgical `propQuest.inc` writer.
 *
 * These are stricter than the character.inc suite because the game CLIENT parses
 * propQuest.inc too (packed into `data.res` per `resource.txt:132-133`;
 * `Project.cpp:495` LoadPropQuest has no server guard). Malformed output is a
 * client crash, so the invariants asserted are "byte-identical outside the edit"
 * and "the converter's own parser sees the identical QuestDef", never "it looks
 * about right".
 *
 * Fixtures reproduce the real file's hazards verbatim: CRLF, tab indentation,
 * `setting` vs `Setting` casing, multi-line SetTitle/SetDesc forms, Korean `//`
 * annotations, `/* ... * /` commented-out blocks, and `QuestItem` inside a state.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyQuestEdit,
  writeQuestEdit,
  findQuestTitleToken,
  setQuestText,
  nextQuestTextToken,
  type QuestEdit,
} from '../../src/writers/propQuest.writer';
import { loadQuestSymbols, bucketByPrefix, type QuestWriterSymbols } from '../../src/writers/questSymbols';
import { scanChunks, maskComments, findGroup } from '../../src/writers/questStatements';
import { emitCommand, originalArgTokens } from '../../src/writers/questEmit';
import { tokenize, loadAllDefines } from '../../scripts/converters/questTokenize';
import type { QuestDef } from '../../src/schemas/quest.schema';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Symbol tables covering only what the fixtures reference. */
const SYM_NAMES = new Map<string, number>([
  ['JOB_VAGRANT', 0],
  ['JOB_MERCENARY', 1],
  ['II_SYS_SYS_QUE_BLADEBRAVERY', 4001],
  ['II_WEA_SWO_SWORDBRAVERY', 4002],
  ['MI_LAWOLF3', 200],
  ['MI_MUSHPANG', 201],
  ['II_SYS_SYS_QUE_VISIONSTONE', 4003],
  ['QUEST_CHANGEJOB1', 1],
  ['QSAY_BEGIN1', 0],
]);
const SYMS: QuestWriterSymbols = { byName: SYM_NAMES, byPrefix: bucketByPrefix(SYM_NAMES) };

/**
 * Three blocks: a stub (SetTitle + Setting/SetHeadQuest only), a full quest with
 * mixed argument types and several states, and a commented-out block that must
 * stay invisible to every lookup. `6001` exists so tests can prove editing
 * `QUEST_CHANGEJOB1` leaves it untouched.
 */
const INC = [
  '/*',
  'SetEndRewardItemWithAbilityOption',
  'header note that must survive',
  '*/',
  '',
  '//퀘스트 분류',
  '6001',
  '{',
  '\tSetTitle',
  '\t(',
  '\t\tIDS_PROPQUEST_INC_002613',
  '\t);',
  '\t',
  '}',
  '',
  '6004',
  '{',
  '\tSetTitle',
  '\t(',
  '\t\tIDS_PROPQUEST_INC_002608',
  '\t);',
  '\tSetting',
  '\t{',
  '\t\tSetHeadQuest( 6003);',
  '\t}',
  '}',
  '',
  'QUEST_CHANGEJOB1',
  '{',
  '\tSetTitle',
  '\t(',
  '\t\tIDS_PROPQUEST_INC_000005',
  '\t);',
  '',
  '\tsetting',
  '\t{',
  '\t\tSetCharacter( "" );',
  '\t\tSetBeginCondLevel( 15, 15 );',
  '\t\tSetBeginCondJob( JOB_VAGRANT );',
  '\t\tSetEndCondItem( -1, 0, -1, II_SYS_SYS_QUE_BLADEBRAVERY, 1 );',
  '\t\tSetEndCondCharacter( "MaFl_Valin" );',
  '\t\tSetEndRewardItem( -1, 0, -1, II_WEA_SWO_SWORDBRAVERY, 1 );',
  '\t\tSetHeadQuest( 6004 );',
  '\t}',
  '',
  '\tstate 0',
  '\t{',
  '',
  '\t\tSetDesc',
  '\t\t(',
  '\t\t\tIDS_PROPQUEST_INC_000006',
  '\t\t);',
  '\t\tSetCond',
  '\t\t(',
  '\t\t\tIDS_PROPQUEST_INC_000007',
  '\t\t);',
  '\t}',
  '',
  '\tstate 4',
  '\t{',
  '\t\t//라울프',
  '\t\tQuestItem(MI_LAWOLF3, II_SYS_SYS_QUE_VISIONSTONE, 1500000000, 1);',
  '',
  '\t\tSetDesc',
  '\t\t(',
  '\t\t\tIDS_PROPQUEST_INC_000018',
  '\t\t);',
  '\t}',
  '',
  '\tstate 14',
  '\t{',
  '\t\tSetDesc',
  '\t\t(',
  '\t\t\tIDS_PROPQUEST_INC_000024',
  '\t\t);',
  '\t}',
  '}',
  '',
  '/*',
  'QUEST_COMMENTED_OUT',
  '{',
  '\tSetTitle',
  '\t(',
  '\t\tIDS_PROPQUEST_INC_009999',
  '\t);',
  '}',
  '*/',
  '',
].join('\r\n');

const TXT = [
  'IDS_PROPQUEST_INC_000005\tPromote Mercenary',
  'IDS_PROPQUEST_INC_000006\tJulia sent me to find Valin.',
  'IDS_PROPQUEST_INC_002608\tStub Quest',
  'IDS_PROPQUEST_INC_002613\tOther Stub',
  '',
].join('\r\n');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** `[start, endExclusive)` offsets of a block, for index-based outside compares. */
function blockRange(text: string, key: string): [number, number] {
  const masked = maskComments(text);
  const re = new RegExp(`^${key}[ \\t]*\\r?\\n\\s*\\{`, 'm');
  const m = re.exec(masked);
  assert.ok(m, `missing block ${key}`);
  let depth = 1;
  for (let i = m.index + m[0].length; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return [m.index, i + 1];
    }
  }
  assert.fail(`unterminated block ${key}`);
}

/** Extract a block's raw text (header through closing brace). */
function blockText(text: string, key: string): string {
  const [start, end] = blockRange(text, key);
  return text.slice(start, end);
}

/**
 * Parse with the converter's OWN parser, via the `__parseForTest` seam in
 * `scripts/converters/quests.ts`. Re-implementing the walk here would let the
 * two drift apart and the round-trip assertion would stop meaning anything.
 */
async function parseAll(incText: string, defines: Map<string, number>): Promise<QuestDef[]> {
  const mod = await import('../../scripts/converters/quests');
  const parse = (mod as unknown as { __parseForTest?: unknown }).__parseForTest;
  assert.ok(typeof parse === 'function', 'quests.ts must export __parseForTest');
  return (parse as (t: ReturnType<typeof tokenize>, d: Map<string, number>) => QuestDef[])(
    tokenize(incText),
    defines,
  );
}

/** Find one quest by its `symbol` field. */
function bySymbol(defs: readonly QuestDef[], symbol: string): QuestDef {
  const d = defs.find((x) => x.symbol === symbol);
  assert.ok(d, `parser did not return ${symbol}`);
  return d;
}

/** Encode as UTF-16LE + BOM, matching the raw files on disk. */
function enc(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

// ── questStatements ───────────────────────────────────────────────────────────

describe('maskComments', () => {
  it('preserves length and newlines so offsets stay valid', () => {
    const src = 'a // comment\r\nb /* x */ c';
    const masked = maskComments(src);
    assert.equal(masked.length, src.length);
    assert.equal(masked.includes('comment'), false);
    assert.equal(masked.includes('/*'), false);
    assert.ok(masked.includes('\r\n'));
  });

  it('does not strip a // inside a string literal', () => {
    const masked = maskComments('SetCharacter( "a//b" );');
    assert.ok(masked.includes('a//b'), 'string body was masked');
  });

  it('hides braces inside a block comment from a depth scan', () => {
    const masked = maskComments('/*\n{\n}\n*/\n{');
    assert.equal((masked.match(/\{/g) ?? []).length, 1);
  });
});

describe('scanChunks', () => {
  it('attaches a preceding comment to the statement below it', () => {
    const chunks = scanChunks(['\t\t//라울프', '\t\tQuestItem(MI_LAWOLF3, 1, 2, 3);']);
    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0]?.trivia, ['\t\t//라울프']);
    assert.equal(chunks[0]?.cmd, 'QuestItem');
  });

  it('captures a multi-line call as one chunk', () => {
    const chunks = scanChunks(['\tSetTitle', '\t(', '\t\tIDS_X', '\t);']);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.lines.length, 4);
  });

  it('keeps a trailing trivia tail as its own chunk', () => {
    const chunks = scanChunks(['\t\tSetHeadQuest( 1 );', '', '\t\t']);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[1]?.cmd, undefined);
    assert.deepEqual(chunks[1]?.trivia, ['', '\t\t']);
  });

  it('does not let a comment-only line start a statement', () => {
    const chunks = scanChunks(['\t\t// SetHeadQuest( 1 );']);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.cmd, undefined);
  });
});

describe('findGroup', () => {
  const lines = ['\tSetting', '\t{', '\t\tSetHeadQuest( 1 );', '\t}', '\tstate 3', '\t{', '\t\tX();', '\t}'];

  it('finds a Setting group with the brace on the next line, preserving casing', () => {
    const g = findGroup(lines, /^\s*([sS]etting)\b/);
    assert.equal(g?.keyword, 'Setting');
    assert.equal(g?.bodyStart, 2);
    assert.equal(g?.bodyEnd, 3);
  });

  it('finds a state group with the brace on the next line', () => {
    const g = findGroup(lines, /^\s*(state)[ \t]+3(?![\d])/);
    assert.equal(g?.bodyStart, 6);
    assert.equal(g?.bodyEnd, 7);
  });

  it('does not match state 1 when asked for state 14', () => {
    const g = findGroup(['\tstate 1', '\t{', '\t}'], /^\s*(state)[ \t]+14(?![\d])/);
    assert.equal(g, undefined);
  });
});

// ── questEmit ─────────────────────────────────────────────────────────────────

describe('originalArgTokens', () => {
  it('splits a single-line arg list, keeping quotes and symbols verbatim', () => {
    assert.deepEqual(
      originalArgTokens('SetEndCondItem( -1, 0, -1, II_SYS_SYS_QUE_BLADEBRAVERY, 1 );'),
      ['-1', '0', '-1', 'II_SYS_SYS_QUE_BLADEBRAVERY', '1'],
    );
  });

  it('splits a multi-line arg list', () => {
    assert.deepEqual(originalArgTokens('SetDialog\n(\t\n\t0,\t\n\tIDS_X\n);'), ['0', 'IDS_X']);
  });

  it('returns an empty list for a parenless or empty call', () => {
    assert.deepEqual(originalArgTokens('SetEndRewardPetLevelup();'), []);
    assert.deepEqual(originalArgTokens('m_x= 1;'), []);
  });

  it('ignores a comment between the name and the paren', () => {
    assert.deepEqual(originalArgTokens('SetDialog // note\n(\n0,\nIDS_X\n);'), ['0', 'IDS_X']);
  });
});

describe('emitCommand — symbol preservation', () => {
  it('reuses the original token when the value is unchanged', () => {
    const out = emitCommand(
      { cmd: 'SetEndCondItem', args: [
        { type: 'num', value: -1 }, { type: 'num', value: 0 }, { type: 'num', value: -1 },
        { type: 'sym', value: 4001 }, { type: 'num', value: 1 },
      ] },
      ['-1', '0', '-1', 'II_SYS_SYS_QUE_BLADEBRAVERY', '1'],
      SYMS,
    );
    assert.equal(out, 'SetEndCondItem( -1, 0, -1, II_SYS_SYS_QUE_BLADEBRAVERY, 1 );');
  });

  it('reverse-looks-up a CHANGED value inside the original token prefix bucket', () => {
    const out = emitCommand(
      { cmd: 'SetEndCondItem', args: [
        { type: 'num', value: -1 }, { type: 'num', value: 0 }, { type: 'num', value: -1 },
        { type: 'sym', value: 4002 }, { type: 'num', value: 1 },
      ] },
      ['-1', '0', '-1', 'II_SYS_SYS_QUE_BLADEBRAVERY', '1'],
      SYMS,
    );
    assert.ok(out.includes('II_WEA_SWO_SWORDBRAVERY'), out);
  });

  it('uses the per-command prefix hint when there is no original token', () => {
    const out = emitCommand(
      { cmd: 'SetEndRewardItem', args: [
        { type: 'num', value: -1 }, { type: 'num', value: 0 }, { type: 'num', value: -1 },
        { type: 'sym', value: 4002 }, { type: 'num', value: 1 },
      ] },
      [],
      SYMS,
    );
    assert.ok(out.includes('II_WEA_SWO_SWORDBRAVERY'), out);
  });

  it('applies a CondJob hint to every argument position, not just the first', () => {
    const out = emitCommand(
      { cmd: 'SetBeginCondJob', args: [{ type: 'sym', value: 0 }, { type: 'sym', value: 1 }] },
      [],
      SYMS,
    );
    assert.equal(out, 'SetBeginCondJob( JOB_VAGRANT, JOB_MERCENARY );');
  });

  it('falls back to the literal when no bucket resolves the value', () => {
    const out = emitCommand(
      { cmd: 'SetHeadQuest', args: [{ type: 'num', value: 6004 }] }, [], SYMS,
    );
    assert.equal(out, 'SetHeadQuest( 6004 );');
  });

  it('quotes str args and writes bool args as TRUE/FALSE', () => {
    assert.equal(
      emitCommand({ cmd: 'SetEndCondCharacter', args: [{ type: 'str', value: 'MaFl_Valin' }] }, [], SYMS),
      'SetEndCondCharacter( "MaFl_Valin" );',
    );
    assert.equal(
      emitCommand({ cmd: 'SetRemove', args: [{ type: 'bool', value: 0 }] }, [], SYMS),
      'SetRemove( FALSE );',
    );
  });

  it('keeps an unresolved symbol string as written', () => {
    assert.equal(
      emitCommand({ cmd: 'SetX', args: [{ type: 'sym', value: 'UNKNOWN_SYM' }] }, [], SYMS),
      'SetX( UNKNOWN_SYM );',
    );
  });

  it('emits an empty arg list without a stray space', () => {
    assert.equal(
      emitCommand({ cmd: 'SetEndRewardPetLevelup', args: [] }, [], SYMS),
      'SetEndRewardPetLevelup();',
    );
  });
});

// ── applyQuestEdit ────────────────────────────────────────────────────────────

describe('applyQuestEdit', () => {
  it('leaves the text byte-identical for an empty edit', () => {
    assert.equal(applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {}, SYMS), INC);
    assert.equal(applyQuestEdit(INC, '6004', {}, SYMS), INC);
  });

  it('throws for an unknown block and says it never creates one', () => {
    assert.throws(
      () => applyQuestEdit(INC, 'QUEST_NOPE', { commands: [] }, SYMS),
      /block "QUEST_NOPE" not found[\s\S]*never creates/,
    );
  });

  it('refuses to see a commented-out block', () => {
    assert.throws(
      () => applyQuestEdit(INC, 'QUEST_COMMENTED_OUT', {}, SYMS),
      /not found/,
    );
  });

  it('accepts the numeric id form as a key', () => {
    const out = applyQuestEdit(INC, '6004', {
      commands: [{ cmd: 'SetHeadQuest', args: [{ type: 'num', value: 6002 }] }],
    }, SYMS);
    assert.ok(blockText(out, '6004').includes('SetHeadQuest( 6002 );'));
  });

  it('preserves the header block comment and the Korean annotations', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      states: { '4': { desc: 'IDS_PROPQUEST_INC_000018' } },
    }, SYMS);
    assert.ok(out.includes('header note that must survive'));
    assert.ok(out.includes('\t\t//라울프'), 'monster-name comment lost');
    assert.ok(out.includes('//퀘스트 분류'));
  });

  it('leaves every other block byte-identical', () => {
    const before6001 = blockText(INC, '6001');
    const before6004 = blockText(INC, '6004');
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      commands: [{ cmd: 'SetHeadQuest', args: [{ type: 'num', value: 6005 }] }],
    }, SYMS);
    assert.equal(blockText(out, '6001'), before6001);
    assert.equal(blockText(out, '6004'), before6004);
  });

  it('introduces no bare LF', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      commands: [
        { cmd: 'SetCharacter', args: [{ type: 'str', value: '' }] },
        { cmd: 'SetBeginCondLevel', args: [{ type: 'num', value: 20 }, { type: 'num', value: 20 }] },
      ],
      states: { '0': { desc: 'IDS_NEW_DESC', cond: 'IDS_PROPQUEST_INC_000007', status: 'IDS_NEW_STATUS' } },
    }, SYMS);
    assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
    assert.equal(out.includes('\r\r'), false);
  });

  it('keeps the block Setting casing it found', () => {
    const out = applyQuestEdit(INC, '6004', {
      commands: [{ cmd: 'SetHeadQuest', args: [{ type: 'num', value: 6002 }] }],
    }, SYMS);
    assert.ok(blockText(out, '6004').includes('\tSetting'));
    assert.equal(blockText(out, '6004').includes('\tsetting'), false);
  });

  it('throws when writing commands into a block with no setting group', () => {
    assert.throws(
      () => applyQuestEdit(INC, '6001', { commands: [] }, SYMS),
      /has no setting \{ \} group/,
    );
  });

  it('replaces the whole setting body and drops surplus statements', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      commands: [{ cmd: 'SetHeadQuest', args: [{ type: 'num', value: 6009 }] }],
    }, SYMS);
    const block = blockText(out, 'QUEST_CHANGEJOB1');
    assert.ok(block.includes('SetHeadQuest( 6009 );'));
    assert.equal(block.includes('SetBeginCondLevel'), false);
    // SetTitle is NOT part of `commands` and must survive.
    assert.ok(block.includes('IDS_PROPQUEST_INC_000005'));
  });

  it('appends a command the block does not have yet', () => {
    const out = applyQuestEdit(INC, '6004', {
      commands: [
        { cmd: 'SetHeadQuest', args: [{ type: 'num', value: 6003 }] },
        { cmd: 'SetRepeat', args: [{ type: 'num', value: 1 }] },
      ],
    }, SYMS);
    const block = blockText(out, '6004');
    assert.ok(block.includes('SetHeadQuest( 6003);'), 'unchanged statement was re-emitted');
    assert.ok(block.includes('SetRepeat( 1 );'));
  });

  it('leaves an unmentioned state byte-identical', () => {
    const before = INC.slice(INC.indexOf('\tstate 14'), INC.indexOf('\tstate 14') + 90);
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      states: { '0': { desc: 'IDS_CHANGED' } },
    }, SYMS);
    assert.ok(out.includes(before), 'state 14 changed');
  });

  it('rewrites a state desc in the multi-line authoring style', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      states: { '0': { desc: 'IDS_CHANGED', cond: 'IDS_PROPQUEST_INC_000007' } },
    }, SYMS);
    assert.ok(out.includes('\t\tSetDesc\r\n\t\t(\r\n\t\t\tIDS_CHANGED\r\n\t\t);'), out.slice(0, 400));
  });

  it('removes a state field when the edit omits it', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      states: { '0': { desc: 'IDS_PROPQUEST_INC_000006' } },
    }, SYMS);
    const state0 = out.slice(out.indexOf('\tstate 0'), out.indexOf('\tstate 4'));
    assert.equal(state0.includes('SetCond'), false);
    assert.ok(state0.includes('SetDesc'));
  });

  it('adds a status field the state did not have', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      states: { '14': { desc: 'IDS_PROPQUEST_INC_000024', status: 'IDS_NEW_STATUS' } },
    }, SYMS);
    const state14 = out.slice(out.indexOf('\tstate 14'));
    assert.ok(state14.includes('IDS_NEW_STATUS'));
  });

  it('leaves a state QuestItem alone when quest_items is not supplied', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      states: { '4': { desc: 'IDS_PROPQUEST_INC_000018' } },
    }, SYMS);
    assert.ok(out.includes('QuestItem(MI_LAWOLF3, II_SYS_SYS_QUE_VISIONSTONE, 1500000000, 1);'));
  });

  it('rewrites state QuestItems when quest_items IS supplied', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      states: {
        '4': {
          desc: 'IDS_PROPQUEST_INC_000018',
          quest_items: [{ mover: 201, item: 4003, prob: 1500000000, num: 2 }],
        },
      },
    }, SYMS);
    assert.ok(out.includes('QuestItem( MI_MUSHPANG, II_SYS_SYS_QUE_VISIONSTONE, 1500000000, 2 );'), out);
    assert.equal(out.includes('MI_LAWOLF3'), false);
  });

  it('clears state QuestItems for an empty quest_items array', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      states: { '4': { desc: 'IDS_PROPQUEST_INC_000018', quest_items: [] } },
    }, SYMS);
    assert.equal(out.includes('QuestItem('), false);
  });

  it('throws when an edit names a state the block does not have', () => {
    assert.throws(
      () => applyQuestEdit(INC, 'QUEST_CHANGEJOB1', { states: { '9': { desc: 'X' } } }, SYMS),
      /no "state 9" group/,
    );
  });

  it('removes a state only when explicitly opted in', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', { removeStates: ['14'] }, SYMS);
    assert.equal(out.includes('state 14'), false);
    assert.ok(out.includes('state 4'), 'removing 14 must not remove 4');
    assert.ok(out.includes('IDS_PROPQUEST_INC_000018'));
  });

  it('removes multiple states without corrupting the remaining ranges', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', { removeStates: ['0', '14'] }, SYMS);
    assert.equal(out.includes('state 0'), false);
    assert.equal(out.includes('state 14'), false);
    assert.ok(out.includes('state 4'));
    // Brace balance survives.
    const block = blockText(out, 'QUEST_CHANGEJOB1');
    const masked = maskComments(block);
    assert.equal((masked.match(/\{/g) ?? []).length, (masked.match(/\}/g) ?? []).length);
  });

  it('applies a state edit and a commands edit in one pass', () => {
    const out = applyQuestEdit(INC, 'QUEST_CHANGEJOB1', {
      commands: [{ cmd: 'SetHeadQuest', args: [{ type: 'num', value: 7000 }] }],
      states: { '0': { desc: 'IDS_BOTH' } },
    }, SYMS);
    assert.ok(out.includes('SetHeadQuest( 7000 );'));
    assert.ok(out.includes('IDS_BOTH'));
  });
});

// ── Text table ────────────────────────────────────────────────────────────────

describe('setQuestText / nextQuestTextToken / findQuestTitleToken', () => {
  it('replaces an existing row and disturbs no other line', () => {
    const out = setQuestText(TXT, 'IDS_PROPQUEST_INC_000005', 'Renamed');
    assert.ok(out.includes('IDS_PROPQUEST_INC_000005\tRenamed'));
    assert.ok(out.includes('IDS_PROPQUEST_INC_002608\tStub Quest'));
    assert.equal(out.split('\r\n').length, TXT.split('\r\n').length);
  });

  it('appends an absent token keeping the trailing CRLF', () => {
    const out = setQuestText(TXT, 'IDS_PROPQUEST_INC_009000', 'Fresh');
    assert.ok(out.includes('IDS_PROPQUEST_INC_009000\tFresh'));
    assert.ok(out.endsWith('\r\n'));
  });

  it('mints the lowest unused numeric suffix', () => {
    assert.equal(nextQuestTextToken(TXT), 'IDS_PROPQUEST_INC_000000');
  });

  it('reads the SetTitle token out of a block', () => {
    assert.equal(findQuestTitleToken(INC, 'QUEST_CHANGEJOB1'), 'IDS_PROPQUEST_INC_000005');
    assert.equal(findQuestTitleToken(INC, '6004'), 'IDS_PROPQUEST_INC_002608');
    assert.equal(findQuestTitleToken(INC, 'QUEST_NOPE'), undefined);
  });
});

// ── writeQuestEdit (I/O) ──────────────────────────────────────────────────────

describe('writeQuestEdit', () => {
  async function fixtureDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'quest-writer-'));
    await writeFile(join(dir, 'propQuest.inc'), enc(INC));
    await writeFile(join(dir, 'propQuest.txt.txt'), enc(TXT));
    return dir;
  }

  it('round-trips through disk preserving both BOMs', async () => {
    const dir = await fixtureDir();
    try {
      await writeQuestEdit(dir, 'QUEST_CHANGEJOB1', {
        title: 'Promote Mercenary!',
        states: { '0': { desc: 'IDS_PROPQUEST_INC_000006', cond: 'IDS_PROPQUEST_INC_000007' } },
      });
      const incBuf = await readFile(join(dir, 'propQuest.inc'));
      const txtBuf = await readFile(join(dir, 'propQuest.txt.txt'));
      assert.equal(incBuf[0], 0xff);
      assert.equal(incBuf[1], 0xfe);
      assert.equal(txtBuf[0], 0xff);
      assert.equal(txtBuf[1], 0xfe);
      assert.ok(
        txtBuf.subarray(2).toString('utf16le').includes('IDS_PROPQUEST_INC_000005\tPromote Mercenary!'),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is a byte-identical no-op for an empty edit', async () => {
    const dir = await fixtureDir();
    try {
      const before = await readFile(join(dir, 'propQuest.inc'));
      await writeQuestEdit(dir, 'QUEST_CHANGEJOB1', {});
      assert.deepEqual(await readFile(join(dir, 'propQuest.inc')), before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves both files untouched when the edit throws', async () => {
    const dir = await fixtureDir();
    try {
      const incBefore = await readFile(join(dir, 'propQuest.inc'));
      const txtBefore = await readFile(join(dir, 'propQuest.txt.txt'));
      await assert.rejects(() => writeQuestEdit(dir, 'QUEST_MISSING', { title: 'X' }));
      assert.deepEqual(await readFile(join(dir, 'propQuest.inc')), incBefore);
      assert.deepEqual(await readFile(join(dir, 'propQuest.txt.txt')), txtBefore);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a passthrough texts row alongside an inc edit', async () => {
    const dir = await fixtureDir();
    try {
      await writeQuestEdit(dir, 'QUEST_CHANGEJOB1', {
        states: { '14': { desc: 'IDS_PROPQUEST_INC_009100' } },
        texts: { IDS_PROPQUEST_INC_009100: 'Final step.' },
      });
      const inc = (await readFile(join(dir, 'propQuest.inc'))).subarray(2).toString('utf16le');
      const txt = (await readFile(join(dir, 'propQuest.txt.txt'))).subarray(2).toString('utf16le');
      assert.ok(inc.includes('IDS_PROPQUEST_INC_009100'), 'inc carries the token');
      assert.ok(txt.includes('IDS_PROPQUEST_INC_009100\tFinal step.'), 'table carries the text');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── The real file ─────────────────────────────────────────────────────────────
//
// Fixtures only cover the hazards I thought to write down. These run against the
// actual 1.6 MB raw/propQuest.inc, read-only: every edit is applied to an
// in-memory copy and NEVER written back to raw/.

const RAW_DIR = fileURLToPath(new URL('../../raw/', import.meta.url));

/** Read + decode the real propQuest.inc, or `undefined` when absent. */
async function readRealInc(): Promise<string | undefined> {
  try {
    const buf = await readFile(join(RAW_DIR, 'propQuest.inc'));
    assert.equal(buf[0], 0xff, 'real propQuest.inc lost its UTF-16LE BOM');
    assert.equal(buf[1], 0xfe, 'real propQuest.inc lost its UTF-16LE BOM');
    return buf.subarray(2).toString('utf16le');
  } catch {
    return undefined;
  }
}

/** Every block key in the real file, as its header writes it, comments excluded. */
function realKeys(inc: string): string[] {
  const masked = maskComments(inc);
  return [...masked.matchAll(/^([A-Za-z_]\w*|\d+)[ \t]*\r?\n\s*\{/gm)]
    .map((m) => m[1]!)
    .filter((k) => k !== 'setting' && k !== 'Setting' && k !== 'state');
}

describe('applyQuestEdit — real raw/propQuest.inc', () => {
  it('is a byte-identical no-op on every block in the real file', async () => {
    const inc = await readRealInc();
    if (!inc) return;
    const syms = await loadQuestSymbols(RAW_DIR);
    const keys = realKeys(inc);
    assert.ok(keys.length > 400, `expected ~474 blocks, found ${keys.length}`);
    for (const key of keys) {
      assert.equal(applyQuestEdit(inc, key, {}, syms), inc, `no-op changed text for ${key}`);
    }
  });

  it('round-trips every quest through parse -> emit -> parse identically', async () => {
    const inc = await readRealInc();
    if (!inc) return;
    const defines = await loadAllDefines(RAW_DIR);
    const syms = await loadQuestSymbols(RAW_DIR);
    const before = await parseAll(inc, defines);
    assert.ok(before.length > 400, `expected ~474 quests, found ${before.length}`);

    let checked = 0;
    for (const q of before) {
      // Feed the parsed state straight back in: commands + every state.
      const edit: QuestEdit = {
        commands: q.commands,
        ...(Object.keys(q.states).length > 0 ? { states: q.states } : {}),
      };
      const hasSetting = /^\s*[sS]etting\b/m.test(blockText(inc, q.symbol));
      if (!hasSetting) delete (edit as { commands?: unknown }).commands;

      const out = applyQuestEdit(inc, q.symbol, edit, syms);
      const after = await parseAll(out, defines);
      const rt = bySymbol(after, q.symbol);
      assert.deepEqual(rt, q, `${q.symbol} (${q.id}) drifted through the writer`);
      checked++;
    }
    assert.ok(checked > 400, `only round-tripped ${checked} quests`);
  });

  it('changes only the edited block, for every quest in the real file', async () => {
    const inc = await readRealInc();
    if (!inc) return;
    const defines = await loadAllDefines(RAW_DIR);
    const syms = await loadQuestSymbols(RAW_DIR);
    const defs = await parseAll(inc, defines);
    assert.ok(defs.length > 400, `expected ~474 quests, found ${defs.length}`);

    // Offset-based: everything before the block's header and everything after its
    // closing brace must be byte-identical. Comparing by offset (rather than
    // String.replace) also catches a block accidentally moving.
    for (const q of defs) {
      const out = applyQuestEdit(inc, q.symbol, { states: q.states }, syms);
      const [bStart, bEnd] = blockRange(inc, q.symbol);
      const [aStart, aEnd] = blockRange(out, q.symbol);
      assert.equal(aStart, bStart, `${q.symbol} moved`);
      assert.equal(inc.slice(0, bStart), out.slice(0, aStart), `text before ${q.symbol} changed`);
      assert.equal(inc.slice(bEnd), out.slice(aEnd), `text after ${q.symbol} changed`);
    }
  });

  it('sample quests round-trip with the expected shapes present', async () => {
    const inc = await readRealInc();
    if (!inc) return;
    const defines = await loadAllDefines(RAW_DIR);
    const defs = await parseAll(inc, defines);

    // Stub blocks: SetTitle only / SetTitle + Setting{SetHeadQuest}.
    assert.equal(bySymbol(defs, '6000').commands.length, 0);
    assert.equal(bySymbol(defs, '6077').commands[0]?.cmd, 'SetHeadQuest');
    // Full quest with many states, mixed arg types, a state QuestItem and
    // SetEndCondCharacter.
    const cj1 = bySymbol(defs, 'QUEST_CHANGEJOB1');
    assert.ok(Object.keys(cj1.states).length >= 6, 'QUEST_CHANGEJOB1 states');
    assert.ok(cj1.quest_items.length > 0, 'QUEST_CHANGEJOB1 QuestItem');
    assert.ok(cj1.commands.some((c) => c.cmd === 'SetEndCondCharacter'));
    assert.ok(cj1.commands.some((c) => c.cmd === 'SetBeginCondJob'));
  });

  it('keeps the sample quests CRLF-only with no bare LF', async () => {
    const inc = await readRealInc();
    if (!inc) return;
    const defines = await loadAllDefines(RAW_DIR);
    const syms = await loadQuestSymbols(RAW_DIR);
    const q = bySymbol(await parseAll(inc, defines), 'QUEST_CHANGEJOB1');
    const out = applyQuestEdit(inc, 'QUEST_CHANGEJOB1', { commands: q.commands, states: q.states }, syms);
    assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
    assert.equal(out.includes('\r\r'), false);
  });

  it('preserves II_/MI_/JOB_ symbol names rather than emitting bare numbers', async () => {
    const inc = await readRealInc();
    if (!inc) return;
    const defines = await loadAllDefines(RAW_DIR);
    const syms = await loadQuestSymbols(RAW_DIR);
    const q = bySymbol(await parseAll(inc, defines), 'QUEST_CHANGEJOB1');
    const out = applyQuestEdit(inc, 'QUEST_CHANGEJOB1', { commands: q.commands }, syms);
    const block = blockText(out, 'QUEST_CHANGEJOB1');
    assert.ok(block.includes('II_SYS_SYS_QUE_BLADEBRAVERY'), 'II_ symbol lost');
    assert.ok(block.includes('JOB_VAGRANT'), 'JOB_ symbol lost');
    assert.ok(block.includes('"MaFl_Valin"'), 'SetEndCondCharacter string lost');
  });

  it('resolves a CHANGED symbol argument back to a name from the real defines', async () => {
    const inc = await readRealInc();
    if (!inc) return;
    const defines = await loadAllDefines(RAW_DIR);
    const syms = await loadQuestSymbols(RAW_DIR);
    const q = bySymbol(await parseAll(inc, defines), 'QUEST_CHANGEJOB1');
    const target = defines.get('II_WEA_SWO_SWORDMULE');
    if (target === undefined) return; // symbol absent in this checkout
    const commands = q.commands.map((c) =>
      c.cmd === 'SetEndCondItem'
        ? { cmd: c.cmd, args: c.args.map((a, i) => (i === 3 ? { type: 'sym' as const, value: target } : a)) }
        : c,
    );
    const out = applyQuestEdit(inc, 'QUEST_CHANGEJOB1', { commands }, syms);
    assert.ok(blockText(out, 'QUEST_CHANGEJOB1').includes('II_WEA_SWO_SWORDMULE'));
  });
});
