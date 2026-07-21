/**
 * character.inc loader tests.
 *
 * Guards the parser against regressions in block-boundary detection, MMI
 * extraction (especially MMI_DIALOG), outfit field mapping, and the II_*
 * resolution path. Uses `parseCharacterInc` directly (pure) so no file I/O.
 *
 * @module test/loaders/characterInc.loader.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseCharacterInc, blockForMover, MMI_DIALOG } from '../../src/loaders/characterInc.loader.js';
import type { CharacterIncIndex } from '../../src/loaders/characterInc.loader.js';

const II = new Map<string, number>([
  ['II_ARM_F_RIN_SUIT06', 1029],
  ['II_ARM_F_RIN_GAUNTLET06', 1030],
  ['II_ARM_F_RIN_BOOTS06', 1031],
  ['II_WEA_YOY_MISHEN', 413],
]);

const MMI = new Map<string, number>([
  ['MMI_DIALOG', 0],
  ['MMI_TRADE', 2],
  ['MMI_BANKING', 9],
]);

const FIXTURE = `
MaFl_Noier
{
	setting
	{
		AddMenu( MMI_DIALOG );
		m_szDialog= "MaFl_Noier.txt";
	}
}

MaDa_Lorein
{
	setting
	{
		AddMenu( MMI_DIALOG );
		AddMenu( MMI_TRADE );
		SetEquip( II_WEA_YOY_MISHEN, II_ARM_F_RIN_SUIT06, II_ARM_F_RIN_GAUNTLET06, II_ARM_F_RIN_BOOTS06 );
		SetFigure( MI_FEMALE, 1, 0xff0f000f, 1 );
		m_szDialog= "MaDa_Lorein.txt";
	}

	AddVendorSlot( 0, IDS_X );
	AddVendorSlot( 1, IDS_Y );
	AddVendorSlot( 2, IDS_Z );
}

MaFl_BankTeller
{
	setting
	{
		AddMenu( MMI_DIALOG );
		AddMenu( MMI_BANKING );
		m_szDialog= "MaFl_BankTeller.txt";
	}
}
`;

function index(): CharacterIncIndex {
  const blocks = parseCharacterInc(FIXTURE, II, MMI);
  const byKey = new Map(blocks.map((b) => [b.key, b]));
  const byStem = new Map(blocks.map((b) => [b.key.toLowerCase(), b]));
  return { byKey, byStem };
}

describe('parseCharacterInc', () => {
  it('parses each top-level <Key> { ... } block', () => {
    const idx = index();
    assert.ok(idx.byKey.has('MaFl_Noier'));
    assert.ok(idx.byKey.has('MaDa_Lorein'));
    assert.ok(idx.byKey.has('MaFl_BankTeller'));
    assert.equal(idx.byKey.size, 3);
  });

  it('extracts MMI_DIALOG for every dialog NPC', () => {
    const idx = index();
    for (const blk of idx.byKey.values()) {
      assert.equal(blk.hasDialog, true, `${blk.key} should have MMI_DIALOG`);
      assert.ok(blk.menus.includes(MMI_DIALOG), `${blk.key} menus include MMI_DIALOG (0)`);
    }
  });

  it('collects + dedupes additional MMI_* ids from AddMenu', () => {
    const idx = index();
    const lorein = idx.byKey.get('MaDa_Lorein')!;
    assert.deepEqual(lorein.menus, [MMI_DIALOG, MMI.get('MMI_TRADE')], 'Lorein has Dialog+Trade');
    const teller = idx.byKey.get('MaFl_BankTeller')!;
    assert.deepEqual(teller.menus, [MMI_DIALOG, MMI.get('MMI_BANKING')], 'BankTeller has Dialog+Banking');
  });

  it('extracts the outfit (SetFigure + SetEquip with II_* resolved)', () => {
    const idx = index();
    const lorein = idx.byKey.get('MaDa_Lorein')!;
    assert.ok(lorein.outfit, 'Lorein outfit parsed');
    assert.equal(lorein.outfit!.characterKey, 'MaDa_Lorein');
    assert.equal(lorein.outfit!.hairMesh, 1);
    assert.equal(lorein.outfit!.hairColor, 0xff0f000f);
    assert.equal(lorein.outfit!.headMesh, 1);
    assert.deepEqual(
      lorein.outfit!.equip.map((e) => [e.parts, e.itemId]),
      [[0, 413], [1, 1029], [2, 1030], [3, 1031]],
      'equip order preserved + II_* resolved to propItem ids',
    );
  });

  it('leaves outfit undefined when neither SetFigure nor SetEquip is present', () => {
    const idx = index();
    const noier = idx.byKey.get('MaFl_Noier')!;
    assert.equal(noier.outfit, undefined);
  });

  it('captures m_szDialog filename', () => {
    const idx = index();
    assert.equal(idx.byKey.get('MaFl_Noier')!.dialogFile, 'MaFl_Noier.txt');
    assert.equal(idx.byKey.get('MaDa_Lorein')!.dialogFile, 'MaDa_Lorein.txt');
  });

  it('counts AddVendorSlot entries', () => {
    const idx = index();
    assert.equal(idx.byKey.get('MaDa_Lorein')!.vendorSlotCount, 3);
    assert.equal(idx.byKey.get('MaFl_Noier')!.vendorSlotCount, 0);
  });

  it('handles AddMenuLang form (lang, sub, MMI_*) like AddMenu', () => {
    const src = `
MaFl_Langer
{
	setting
	{
		AddMenuLang( LANG_KOR, 0, MMI_DIALOG );
		AddMenuLang( LANG_USA, 0, MMI_TRADE );
	}
}
`;
    const blocks = parseCharacterInc(src, II, MMI);
    assert.equal(blocks[0]!.menus.includes(MMI_DIALOG), true);
    assert.equal(blocks[0]!.menus.includes(MMI.get('MMI_TRADE')!), true);
  });

  it('skips commented-out SetEquip / SetFigure lines', () => {
    const src = `
MaFl_Hidden
{
	setting
	{
		AddMenu( MMI_DIALOG );
//		SetEquip( II_WEA_YOY_MISHEN );
//		SetFigure( MI_FEMALE, 0, 0xffffaa88, 1 );
	}
}
`;
    const blocks = parseCharacterInc(src, II, MMI);
    assert.equal(blocks[0]!.outfit, undefined, 'commented outfit lines must not match');
  });
});

describe('blockForMover', () => {
  it('resolves a MI_* key to its character.inc block via stem lowercase', () => {
    const idx = index();
    const blk = blockForMover(idx, 'MI_MAFL_NOIER');
    assert.ok(blk);
    assert.equal(blk!.key, 'MaFl_Noier');
    assert.equal(blk!.hasDialog, true);
  });

  it('resolves a mixed-case MI_* key (MI_MADA_LOREIN)', () => {
    const idx = index();
    const blk = blockForMover(idx, 'MI_MADA_LOREIN');
    assert.ok(blk);
    assert.equal(blk!.key, 'MaDa_Lorein');
  });

  it('returns undefined for unmatched/monster MI_* keys', () => {
    const idx = index();
    assert.equal(blockForMover(idx, 'MI_AIBATT1'), undefined);
    assert.equal(blockForMover(idx, undefined), undefined);
    assert.equal(blockForMover(idx, ''), undefined);
  });
});
