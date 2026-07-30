/**
 * Tests for the surgical `character.inc` writer.
 *
 * These matter more than most: the writer edits a 13k-line UTF-16LE file that the
 * game client ALSO parses. A regenerated block or a lost BOM corrupts game data
 * for every player, so the invariants asserted here are "byte-identical outside
 * the edit" rather than "the parsed result looks right".
 *
 * Fixtures are inline and reproduce the real file's hazards verbatim: CRLF, tab
 * indentation, `AddMenu( MMI_TRADE  );` double-space, multi-line
 * `SetName`/`SetImage`/`AddVendorSlot` forms, and interior comments.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyCharacterEdit,
  setTextEntry,
  writeCharacterEdit,
  nextTextToken,
  allocTextTokens,
  loadSymbols,
  type WriterSymbols,
} from '../../src/writers/characterInc.writer';
import { parseCharacterInc } from '../../src/loaders/characterInc.loader';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Symbol maps covering only what the fixtures reference. */
const SYMS: WriterSymbols = {
  mmiById: new Map([
    [1, 'MMI_DIALOG'],
    [2, 'MMI_TRADE'],
    [3, 'MMI_BANKING'],
  ]),
  iiById: new Map([
    [101, 'II_ARM_M_VAG_QUE_HELMET'],
    [102, 'II_ARM_M_VAG_QUE_SUIT'],
    [103, 'II_ARM_M_VAG_QUE_GAUNTLET'],
  ]),
  srtById: new Map([
    [7, 'SRT_MAGIC'],
    [8, 'SRT_GENERAL'],
  ]),
};

/**
 * Two blocks, CRLF, with every awkward form the real file uses. `MaFl_Other`
 * exists purely so tests can prove edits to `MaFl_Marche` leave it untouched.
 */
const INC = [
  '//  character.inc -- leading comment',
  '',
  'MaFl_Marche',
  '{',
  '\tsetting',
  '\t{',
  '\t\tAddMenu( MMI_DIALOG );',
  '\t\tAddMenu( MMI_TRADE  );',
  '\t\t// interior comment that must survive',
  '',
  '\t\tAddVendorItem( 0, IK3_WAND, 4, 15, 27, 100 );',
  '\t\tm_nStructure= SRT_MAGIC;',
  '\t\tSetFigure( MI_MAFL_MARCHE, 3, 0x00ff8040, 5 );',
  '\t\tSetEquip( II_ARM_M_VAG_QUE_HELMET, II_ARM_M_VAG_QUE_SUIT );',
  '\t\tSetImage',
  '\t\t(',
  '\t\tIDS_CHARACTER_INC_000050',
  '\t\t);',
  '\t\tm_szDialog= "MaFl_Marche.txt";',
  '\t}',
  '',
  '\tSetName',
  '\t(',
  '\tIDS_CHARACTER_INC_000051',
  '\t);',
  '',
  '\tAddVendorSlot( 0,',
  '\tIDS_CHARACTER_INC_000052',
  '\t);',
  '}',
  '',
  'MaFl_Other',
  '{',
  '\tsetting',
  '\t{',
  '\t\tAddMenu( MMI_DIALOG );',
  '\t\tSetFigure( MI_MAFL_OTHER, 1, 0x00112233, 2 );',
  '\t}',
  '',
  '\tSetName',
  '\t(',
  '\tIDS_CHARACTER_INC_000060',
  '\t);',
  '}',
  '',
].join('\r\n');

const TXT = [
  'IDS_CHARACTER_INC_000050\tmarche_portrait.tga',
  'IDS_CHARACTER_INC_000051\tMarche',
  'IDS_CHARACTER_INC_000052\tWeapons',
  'IDS_CHARACTER_INC_000060\tOther Guy',
  '',
].join('\r\n');

/**
 * Extract a block's raw text (header through closing brace) for comparison.
 * Mirrors the writer's own header form: the key may be followed by a trailing
 * `//` comment before the brace, and braces inside comments don't count.
 */
function blockText(text: string, key: string): string {
  const re = new RegExp(`^${key}[ \\t]*(?://[^\\r\\n]*)?\\s*\\{`, 'm');
  const m = re.exec(text);
  assert.ok(m, `fixture missing block ${key}`);
  const start = m.index;
  let depth = 1;
  let inComment = false;
  for (let i = start + m[0].length; i < text.length; i++) {
    const c = text[i];
    if (inComment) {
      if (c === '\n') inComment = false;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { inComment = true; i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  assert.fail(`unterminated block ${key}`);
}

/** Re-parse edited text through the real loader parser. */
function reparse(text: string) {
  const ii = new Map<string, number>();
  for (const [id, sym] of SYMS.iiById) ii.set(sym, id);
  const ik3 = new Map<string, number>([['IK3_WAND', 12], ['IK3_SWD', 1]]);
  const mmi = new Map<string, number>();
  for (const [id, sym] of SYMS.mmiById) mmi.set(sym, id);
  return parseCharacterInc(text, ii, ik3, mmi);
}

// ── applyCharacterEdit ────────────────────────────────────────────────────────

describe('applyCharacterEdit', () => {
  it('leaves the text byte-identical for an empty edit', () => {
    assert.equal(applyCharacterEdit(INC, 'MaFl_Marche', {}, SYMS), INC);
  });

  it('throws for an unknown block key', () => {
    assert.throws(
      () => applyCharacterEdit(INC, 'MaFl_Nope', { output: false }, SYMS),
      /block "MaFl_Nope" not found/,
    );
  });

  it('leaves neighbouring blocks byte-identical', () => {
    const before = blockText(INC, 'MaFl_Other');
    const out = applyCharacterEdit(INC, 'MaFl_Marche', { menus: [1] }, SYMS);
    assert.equal(blockText(out, 'MaFl_Other'), before);
  });

  it('preserves the leading comment and interior comment/blank lines', () => {
    const out = applyCharacterEdit(INC, 'MaFl_Marche', { menus: [1, 2, 3] }, SYMS);
    assert.ok(out.startsWith('//  character.inc -- leading comment'));
    assert.ok(out.includes('\t\t// interior comment that must survive'));
  });

  it('keeps the file CRLF-only (no LF-only or CRCRLF lines introduced)', () => {
    const out = applyCharacterEdit(
      INC,
      'MaFl_Marche',
      { menus: [1, 2], vendorTabs: [{ slot: 0, label: 'IDS_CHARACTER_INC_000052' }] },
      SYMS,
    );
    assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
    assert.equal(out.includes('\r\r'), false);
  });

  it('replaces all AddMenu lines and preserves original indentation', () => {
    const out = applyCharacterEdit(INC, 'MaFl_Marche', { menus: [1, 3] }, SYMS);
    const block = blockText(out, 'MaFl_Marche');
    assert.equal((block.match(/AddMenu\(/g) ?? []).length, 2);
    assert.ok(block.includes('\t\tAddMenu( MMI_DIALOG );'));
    assert.ok(block.includes('\t\tAddMenu( MMI_BANKING );'));
    assert.equal(block.includes('MMI_TRADE'), false);
  });

  it('round-trips menus through the loader parser', () => {
    const out = applyCharacterEdit(INC, 'MaFl_Marche', { menus: [1, 3] }, SYMS);
    const block = reparse(out).find((b) => b.key === 'MaFl_Marche');
    assert.deepEqual(block?.menus, [1, 3]);
  });

  it('removes structure when set to null and re-adds when set to a value', () => {
    const removed = applyCharacterEdit(INC, 'MaFl_Marche', { structure: null }, SYMS);
    assert.equal(blockText(removed, 'MaFl_Marche').includes('m_nStructure='), false);

    const readded = applyCharacterEdit(removed, 'MaFl_Marche', { structure: 8 }, SYMS);
    assert.ok(blockText(readded, 'MaFl_Marche').includes('m_nStructure= SRT_GENERAL;'));
    assert.equal(reparse(readded).find((b) => b.key === 'MaFl_Marche')?.structure, 8);
  });

  it('replaces the dialog filename without duplicating the statement', () => {
    const out = applyCharacterEdit(INC, 'MaFl_Marche', { dialogFile: 'NewFile.txt' }, SYMS);
    const block = blockText(out, 'MaFl_Marche');
    assert.equal((block.match(/m_szDialog=/g) ?? []).length, 1);
    assert.equal(reparse(out).find((b) => b.key === 'MaFl_Marche')?.dialogFile, 'NewFile.txt');
  });

  it('writes SetOutput and round-trips it as false', () => {
    const out = applyCharacterEdit(INC, 'MaFl_Marche', { output: false }, SYMS);
    assert.ok(blockText(out, 'MaFl_Marche').includes('SetOutput( FALSE );'));
    assert.equal(reparse(out).find((b) => b.key === 'MaFl_Marche')?.output, false);
  });

  it('replaces the multi-line AddVendorSlot form in place', () => {
    const out = applyCharacterEdit(
      INC,
      'MaFl_Marche',
      { vendorTabs: [{ slot: 0, label: 'IDS_A' }, { slot: 1, label: 'IDS_B' }] },
      SYMS,
    );
    const block = blockText(out, 'MaFl_Marche');
    assert.equal((block.match(/AddVendorSlot\(/g) ?? []).length, 2);
    assert.equal(block.includes('IDS_CHARACTER_INC_000052'), false);
    const tabs = reparse(out).find((b) => b.key === 'MaFl_Marche')?.vendorTabs;
    assert.deepEqual(tabs, [{ slot: 0, label: 'IDS_A' }, { slot: 1, label: 'IDS_B' }]);
  });

  it('replaces vendor items and round-trips the IK3 symbol', () => {
    const out = applyCharacterEdit(
      INC,
      'MaFl_Marche',
      {
        vendorItems: [
          { slot: 0, itemKind3: 1, itemKind3Symbol: 'IK3_SWD', itemJob: -1, uniqueMin: 0, uniqueMax: 10, totalNum: 5 },
        ],
      },
      SYMS,
    );
    assert.ok(blockText(out, 'MaFl_Marche').includes('AddVendorItem( 0, IK3_SWD, -1, 0, 10, 5 );'));
    const items = reparse(out).find((b) => b.key === 'MaFl_Marche')?.vendorItems;
    assert.equal(items?.length, 1);
    assert.equal(items?.[0]?.itemKind3Symbol, 'IK3_SWD');
    assert.equal(items?.[0]?.totalNum, 5);
  });

  it('writes AddVendorItem2 explicit ids', () => {
    const out = applyCharacterEdit(
      INC,
      'MaFl_Marche',
      { vendorItemIds: [{ slot: 1, itemId: 4242 }] },
      SYMS,
    );
    assert.ok(blockText(out, 'MaFl_Marche').includes('AddVendorItem2( 1, 4242 );'));
    assert.deepEqual(
      reparse(out).find((b) => b.key === 'MaFl_Marche')?.vendorItemIds,
      [{ slot: 1, itemId: 4242 }],
    );
  });
});

// ── Outfit ────────────────────────────────────────────────────────────────────

describe('applyCharacterEdit — outfit', () => {
  it('preserves the existing MI_* model token the loader discards', () => {
    const out = applyCharacterEdit(
      INC,
      'MaFl_Marche',
      { outfit: { hairMesh: 9, hairColor: 0x00abcdef, headMesh: 4, equip: [{ parts: 0, itemId: 101 }] } },
      SYMS,
    );
    assert.ok(blockText(out, 'MaFl_Marche').includes('SetFigure( MI_MAFL_MARCHE, 9, 0x00abcdef, 4 );'));
  });

  it('round-trips hair/head and positional equip through the loader', () => {
    const out = applyCharacterEdit(
      INC,
      'MaFl_Marche',
      {
        outfit: {
          hairMesh: 9,
          hairColor: 0x00abcdef,
          headMesh: 4,
          equip: [{ parts: 0, itemId: 101 }, { parts: 1, itemId: 102 }, { parts: 2, itemId: 103 }],
        },
      },
      SYMS,
    );
    const o = reparse(out).find((b) => b.key === 'MaFl_Marche')?.outfit;
    assert.equal(o?.hairMesh, 9);
    assert.equal(o?.hairColor, 0x00abcdef);
    assert.equal(o?.headMesh, 4);
    assert.deepEqual(o?.equip.map((e) => [e.parts, e.itemId]), [[0, 101], [1, 102], [2, 103]]);
  });

  it('rejects non-contiguous equip parts (positional misalignment)', () => {
    assert.throws(
      () =>
        applyCharacterEdit(
          INC,
          'MaFl_Marche',
          { outfit: { hairMesh: 1, hairColor: 0, headMesh: 1, equip: [{ parts: 0, itemId: 101 }, { parts: 2, itemId: 103 }] } },
          SYMS,
        ),
      /non-contiguous parts/,
    );
  });

  it('throws rather than synthesizing MI_* for a block with no SetFigure', () => {
    const noFig = INC.replace('\t\tSetFigure( MI_MAFL_MARCHE, 3, 0x00ff8040, 5 );\r\n', '');
    assert.throws(
      () =>
        applyCharacterEdit(
          noFig,
          'MaFl_Marche',
          { outfit: { hairMesh: 1, hairColor: 0, headMesh: 1, equip: [{ parts: 0, itemId: 101 }] } },
          SYMS,
        ),
      /no existing SetFigure/,
    );
  });

  it('removes both SetFigure and SetEquip when outfit is null', () => {
    const out = applyCharacterEdit(INC, 'MaFl_Marche', { outfit: null }, SYMS);
    const block = blockText(out, 'MaFl_Marche');
    assert.equal(block.includes('SetFigure('), false);
    assert.equal(block.includes('SetEquip('), false);
    assert.equal(reparse(out).find((b) => b.key === 'MaFl_Marche')?.outfit, undefined);
  });
});

// ── setTextEntry ──────────────────────────────────────────────────────────────

describe('setTextEntry', () => {
  it('replaces an existing token in place and disturbs no other line', () => {
    const out = setTextEntry(TXT, 'IDS_CHARACTER_INC_000051', 'Renamed');
    assert.ok(out.includes('IDS_CHARACTER_INC_000051\tRenamed'));
    assert.ok(out.includes('IDS_CHARACTER_INC_000050\tmarche_portrait.tga'));
    assert.ok(out.includes('IDS_CHARACTER_INC_000060\tOther Guy'));
    assert.equal(out.split('\r\n').length, TXT.split('\r\n').length);
  });

  it('appends an absent token without eating the trailing newline', () => {
    const out = setTextEntry(TXT, 'IDS_NEW_TOKEN', 'Fresh');
    assert.ok(out.includes('IDS_NEW_TOKEN\tFresh'));
    assert.ok(out.endsWith('\r\n'), 'trailing newline lost');
    assert.ok(out.startsWith(TXT.slice(0, TXT.length - 2)), 'existing lines disturbed');
  });

  it('preserves CRLF and introduces no bare LF', () => {
    const out = setTextEntry(TXT, 'IDS_CHARACTER_INC_000051', 'Renamed');
    assert.equal(out.replace(/\r\n/g, '').includes('\n'), false);
  });

  it('keeps tabs inside the text value', () => {
    const out = setTextEntry(TXT, 'IDS_CHARACTER_INC_000051', 'A\tB');
    assert.ok(out.includes('IDS_CHARACTER_INC_000051\tA\tB'));
  });
});

// ── writeCharacterEdit (I/O) ──────────────────────────────────────────────────

/** Encode as UTF-16LE + BOM, matching the raw files on disk. */
function enc(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

describe('writeCharacterEdit', () => {
  it('round-trips through disk preserving the UTF-16LE BOM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inc-writer-'));
    try {
      await writeFile(join(dir, 'character.inc'), enc(INC));
      await writeFile(join(dir, 'character.txt.txt'), enc(TXT));

      await writeCharacterEdit(dir, 'MaFl_Marche', { name: 'Renamed', output: false });

      const incBuf = await readFile(join(dir, 'character.inc'));
      const txtBuf = await readFile(join(dir, 'character.txt.txt'));
      assert.equal(incBuf[0], 0xff, 'inc BOM byte 0');
      assert.equal(incBuf[1], 0xfe, 'inc BOM byte 1');
      assert.equal(txtBuf[0], 0xff, 'txt BOM byte 0');
      assert.equal(txtBuf[1], 0xfe, 'txt BOM byte 1');

      const incText = incBuf.subarray(2).toString('utf16le');
      const txtText = txtBuf.subarray(2).toString('utf16le');
      assert.ok(incText.includes('SetOutput( FALSE );'));
      assert.ok(txtText.includes('IDS_CHARACTER_INC_000051\tRenamed'));
      // Untouched neighbour survives the disk round-trip byte-for-byte.
      assert.equal(blockText(incText, 'MaFl_Other'), blockText(INC, 'MaFl_Other'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is a byte-identical no-op for an empty edit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inc-writer-'));
    try {
      const original = enc(INC);
      await writeFile(join(dir, 'character.inc'), original);
      await writeFile(join(dir, 'character.txt.txt'), enc(TXT));

      await writeCharacterEdit(dir, 'MaFl_Marche', {});

      assert.deepEqual(await readFile(join(dir, 'character.inc')), original);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when naming a block that has no SetName token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inc-writer-'));
    try {
      const noName = ['NoName', '{', '\tsetting', '\t{', '\t}', '}', ''].join('\r\n');
      await writeFile(join(dir, 'character.inc'), enc(noName));
      await writeFile(join(dir, 'character.txt.txt'), enc(TXT));

      await assert.rejects(
        () => writeCharacterEdit(dir, 'NoName', { name: 'X' }),
        /no SetName/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves both files untouched when the edit throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inc-writer-'));
    try {
      const incBefore = enc(INC);
      const txtBefore = enc(TXT);
      await writeFile(join(dir, 'character.inc'), incBefore);
      await writeFile(join(dir, 'character.txt.txt'), txtBefore);

      await assert.rejects(() => writeCharacterEdit(dir, 'MaFl_Missing', { output: true }));

      assert.deepEqual(await readFile(join(dir, 'character.inc')), incBefore);
      assert.deepEqual(await readFile(join(dir, 'character.txt.txt')), txtBefore);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // A new shop tab needs BOTH halves: the `AddVendorSlot( n, IDS_* )` line in
  // the .inc and the `IDS_* <tab> label` row in the .txt.txt the client reads.
  // Writing only one half is the bug this pair of tests exists to catch.
  it('writes a new tab token to BOTH the inc and the string table', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inc-writer-'));
    try {
      await writeFile(join(dir, 'character.inc'), enc(INC));
      await writeFile(join(dir, 'character.txt.txt'), enc(TXT));

      const [token] = await allocTextTokens(dir, 1);
      assert.ok(token, 'allocated a token');
      await writeCharacterEdit(dir, 'MaFl_Marche', {
        vendorTabs: [
          { slot: 0, label: 'IDS_CHARACTER_INC_000052' },
          { slot: 1, label: token! },
        ],
        texts: { [token!]: 'Potions' },
      });

      const incText = (await readFile(join(dir, 'character.inc'))).subarray(2).toString('utf16le');
      const txtText = (await readFile(join(dir, 'character.txt.txt'))).subarray(2).toString('utf16le');

      assert.ok(incText.includes(`AddVendorSlot( 1,`), 'inc carries the new slot');
      assert.ok(incText.includes(token!), 'inc carries the new token');
      assert.ok(txtText.includes(`${token!}\tPotions`), 'string table carries its label');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves the string table trailing newline when appending a token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inc-writer-'));
    try {
      await writeFile(join(dir, 'character.inc'), enc(INC));
      await writeFile(join(dir, 'character.txt.txt'), enc(TXT));

      await writeCharacterEdit(dir, 'MaFl_Marche', {
        texts: { IDS_CHARACTER_INC_000999: 'Appended' },
      });

      const txtText = (await readFile(join(dir, 'character.txt.txt'))).subarray(2).toString('utf16le');
      assert.ok(txtText.includes('IDS_CHARACTER_INC_000999\tAppended'));
      assert.ok(txtText.endsWith('\r\n'), 'trailing CRLF survives');
      // Existing rows are untouched.
      assert.ok(txtText.includes('IDS_CHARACTER_INC_000051\tMarche'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('nextTextToken / allocTextTokens', () => {
  it('picks the lowest unused numeric suffix', () => {
    // TXT uses 50, 51, 52, 60 — so 0 is the lowest free id.
    assert.equal(nextTextToken(TXT), 'IDS_CHARACTER_INC_000000');
  });

  it('skips every id already claimed', () => {
    const dense = ['IDS_X_000000\ta', 'IDS_X_000001\tb', 'IDS_X_000003\tc', ''].join('\r\n');
    assert.equal(nextTextToken(dense, 'IDS_X_'), 'IDS_X_000002');
  });

  it('zero-pads to the six digits the real file uses', () => {
    assert.match(nextTextToken('', 'IDS_X_'), /^IDS_X_\d{6}$/);
  });

  it('never mints the same token twice in one batch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inc-token-'));
    try {
      await writeFile(join(dir, 'character.txt.txt'), enc(TXT));
      const tokens = await allocTextTokens(dir, 5);
      assert.equal(tokens.length, 5);
      assert.equal(new Set(tokens).size, 5, 'all distinct');
      for (const t of tokens) assert.ok(!TXT.includes(t), `${t} is not already used`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('loadSymbols', () => {
  it('inverts define files into id -> symbol maps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inc-syms-'));
    try {
      await writeFile(
        join(dir, 'defineNeuz.h'),
        enc(['#define MMI_DIALOG\t1', '#define MMI_TRADE\t2', ''].join('\r\n')),
      );
      await writeFile(
        join(dir, 'defineItem.h'),
        enc(['#define II_ARM_M_VAG_QUE_HELMET\t101', ''].join('\r\n')),
      );

      const syms = await loadSymbols(dir);
      assert.equal(syms.mmiById.get(2), 'MMI_TRADE');
      assert.equal(syms.iiById.get(101), 'II_ARM_M_VAG_QUE_HELMET');
      assert.equal(syms.srtById.get(7), 'SRT_MAGIC');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns empty id maps when the define files are absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'inc-syms-'));
    try {
      const syms = await loadSymbols(dir);
      assert.equal(syms.mmiById.size, 0);
      assert.equal(syms.iiById.size, 0);
      assert.ok(syms.srtById.size > 0, 'SRT map is a hardcoded fallback');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── The real file ─────────────────────────────────────────────────────────────
//
// Fixtures only prove the writer handles the hazards I thought to write down.
// These run against the actual 13k-line raw/character.inc, so a formatting
// variant nobody anticipated still fails the build. Read-only: every edit is
// applied to an in-memory copy, never written back to raw/.

const RAW_DIR = fileURLToPath(new URL('../../raw/', import.meta.url));

/** Read + decode the real character.inc, or `undefined` when it is absent. */
async function readRealInc(): Promise<string | undefined> {
  try {
    const buf = await readFile(join(RAW_DIR, 'character.inc'));
    assert.equal(buf[0], 0xff, 'real character.inc lost its UTF-16LE BOM');
    assert.equal(buf[1], 0xfe, 'real character.inc lost its UTF-16LE BOM');
    return buf.subarray(2).toString('utf16le');
  } catch {
    return undefined;
  }
}

describe('applyCharacterEdit — real raw/character.inc', () => {
  it('is a byte-identical no-op on every block in the real file', async () => {
    const inc = await readRealInc();
    if (!inc) return; // raw/ not present in this checkout
    const syms = await loadSymbols(RAW_DIR);

    // Headers may carry a trailing comment before the brace
    // (`Mada_Guildcombatshop // 길드대전 상인`), so the comment is matched too.
    const keys = [...inc.matchAll(/^([A-Z][A-Za-z0-9_]*)[ \t]*(?:\/\/[^\r\n]*)?\s*\{/gm)]
      .map((m) => m[1]!)
      .filter((k) => k !== 'setting');
    assert.ok(keys.length > 100, `expected many blocks, found ${keys.length}`);

    for (const key of keys) {
      assert.equal(applyCharacterEdit(inc, key, {}, syms), inc, `no-op changed text for ${key}`);
    }
  });

  it('changes only the edited block, for every block that has an outfit', async () => {
    const inc = await readRealInc();
    if (!inc) return;
    const syms = await loadSymbols(RAW_DIR);

    const ii = new Map<string, number>();
    for (const [id, sym] of syms.iiById) ii.set(sym, id);
    const blocks = parseCharacterInc(inc, ii, new Map(), new Map());
    const withOutfit = blocks.filter((b) => b.outfit !== undefined);
    // 32 blocks in the shipped file carry SetFigure/SetEquip. The floor only
    // guards against the loader silently returning nothing.
    assert.ok(withOutfit.length >= 30, `expected many outfits, found ${withOutfit.length}`);

    let checked = 0;
    for (const b of withOutfit) {
      const o = b.outfit!;
      const out = applyCharacterEdit(
        inc,
        b.key,
        {
          outfit: {
            hairMesh: o.hairMesh,
            hairColor: o.hairColor,
            headMesh: o.headMesh,
            equip: o.equip.map((e) => ({ parts: e.parts, itemId: e.itemId })),
          },
        },
        syms,
      );

      // Every other block must be untouched.
      const before = blockText(inc, b.key);
      const after = blockText(out, b.key);
      assert.equal(
        inc.replace(before, ''),
        out.replace(after, ''),
        `editing ${b.key} disturbed text outside its block`,
      );

      // Re-parsing must yield the same outfit it started with.
      const rt = parseCharacterInc(out, ii, new Map(), new Map()).find((x) => x.key === b.key);
      assert.equal(rt?.outfit?.hairMesh, o.hairMesh, `${b.key} hairMesh drifted`);
      assert.equal(rt?.outfit?.hairColor, o.hairColor, `${b.key} hairColor drifted`);
      assert.equal(rt?.outfit?.headMesh, o.headMesh, `${b.key} headMesh drifted`);
      assert.deepEqual(
        rt?.outfit?.equip.map((e) => [e.parts, e.itemId]),
        o.equip.map((e) => [e.parts, e.itemId]),
        `${b.key} equip drifted`,
      );
      checked++;
    }
    assert.ok(checked >= 30, `only round-tripped ${checked} outfits`);
  });

  it('round-trips menus and vendor stock unchanged for every shop block', async () => {
    const inc = await readRealInc();
    if (!inc) return;
    const syms = await loadSymbols(RAW_DIR);

    const ii = new Map<string, number>();
    for (const [id, sym] of syms.iiById) ii.set(sym, id);
    const mmi = new Map<string, number>();
    for (const [id, sym] of syms.mmiById) mmi.set(sym, id);

    const blocks = parseCharacterInc(inc, ii, new Map(), mmi);
    const shops = blocks.filter((b) => b.vendorItems.length > 0 || b.vendorTabs.length > 0);
    assert.ok(shops.length > 10, `expected shop blocks, found ${shops.length}`);

    for (const b of shops) {
      const out = applyCharacterEdit(
        inc,
        b.key,
        {
          menus: [...b.menus],
          vendorTabs: b.vendorTabs.map((t) => ({ slot: t.slot, label: t.label })),
          vendorItems: [...b.vendorItems],
        },
        syms,
      );
      const rt = parseCharacterInc(out, ii, new Map(), mmi).find((x) => x.key === b.key);
      assert.deepEqual(rt?.menus, b.menus, `${b.key} menus drifted`);
      assert.deepEqual(rt?.vendorTabs, b.vendorTabs, `${b.key} vendorTabs drifted`);
      assert.deepEqual(rt?.vendorItems, b.vendorItems, `${b.key} vendorItems drifted`);
    }
  });
});
