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
import { parseCharacterInc, blockForMover, MMI_DIALOG, MMI_NPC_BUFF } from '../../src/loaders/characterInc.loader';
import type { CharacterIncIndex } from '../../src/loaders/characterInc.loader';

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
  ['MMI_NPC_BUFF', 74],
]);

const IK3 = new Map<string, number>([
  ['IK3_SWD', 2],
  ['IK3_AXE', 3],
  ['IK3_SUIT', 11],
  ['IK3_PET', 99],
]);

const SI = new Map<string, number>([
  ['SI_GEN_EVE_QUICKSTEP', 317],
  ['SI_GEN_EVE_HASTE', 318],
  ['SI_ASS_CHEER_QUICKSTEP', 114],
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

MaFl_Marche
{
	setting
	{
		AddMenu( MMI_DIALOG );
		AddMenu( MMI_TRADE );
		m_szDialog= "MaFl_Marche.txt";
		SetVenderType( 1 );
	}

	AddVendorSlot( 0, IDS_CHARACTER_INC_000022 );
	AddVendorSlot( 1,
		IDS_CHARACTER_INC_000023
	);
	AddVendorItem( 0, IK3_SWD, 1, 15, 27, 50 );
	AddVendorItem( 0, IK3_AXE, 1, 15, 27, 50 );
	AddVendorItem( 1, IK3_SUIT, 3, 15, 27, 25 );
	AddVendorItem2( 2, 1234 );
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

MaFl_Helper
{
	setting
	{
		AddMenu( MMI_DIALOG );
		AddMenu( MMI_NPC_BUFF );
		m_szDialog= "MaFl_Helper.txt";
	}

	SetBuffSkill( SI_GEN_EVE_QUICKSTEP, 2, 1, 30, 3600000 );
	SetBuffSkill( SI_GEN_EVE_HASTE, 2, 1, 30, 3600000 );
	SetBuffSkill( SI_ASS_CHEER_QUICKSTEP, 7, 1, 60, 3600000 );
	SetBuffSkill( 123, 4, 5, 99, 60000 );
}
`;

function index(): CharacterIncIndex {
  const blocks = parseCharacterInc(FIXTURE, II, IK3, MMI, SI);
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
    assert.ok(idx.byKey.has('MaFl_Marche'));
    assert.ok(idx.byKey.has('MaFl_Helper'));
    assert.equal(idx.byKey.size, 5);
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

  it('captures AddVendorSlot entries as tabs with slot + label token', () => {
    const idx = index();
    const lorein = idx.byKey.get('MaDa_Lorein')!;
    assert.equal(lorein.vendorSlotCount, 3);
    assert.deepEqual(
      lorein.vendorTabs.map((t) => [t.slot, t.label]),
      [[0, 'IDS_X'], [1, 'IDS_Y'], [2, 'IDS_Z']],
    );
    assert.equal(idx.byKey.get('MaFl_Noier')!.vendorSlotCount, 0);
  });

  it('parses AddVendorItem (IK3 resolved) + AddVendorItem2 + SetVenderType', () => {
    const idx = index();
    const m = idx.byKey.get('MaFl_Marche')!;
    assert.deepEqual(
      m.vendorTabs.map((t) => [t.slot, t.label]),
      [[0, 'IDS_CHARACTER_INC_000022'], [1, 'IDS_CHARACTER_INC_000023']],
      'multiline AddVendorSlot arg form captured',
    );
    assert.deepEqual(
      m.vendorItems.map((v) => [v.slot, v.itemKind3, v.itemJob, v.uniqueMin, v.uniqueMax, v.totalNum]),
      [
        [0, IK3.get('IK3_SWD')!, 1, 15, 27, 50],
        [0, IK3.get('IK3_AXE')!, 1, 15, 27, 50],
        [1, IK3.get('IK3_SUIT')!, 3, 15, 27, 25],
      ],
      'IK3_* resolved to defineItemkind.h numbers',
    );
    assert.deepEqual(
      m.vendorItems.map((v) => v.itemKind3Symbol),
      ['IK3_SWD', 'IK3_AXE', 'IK3_SUIT'],
      'original IK3_* symbol retained verbatim for the shop stock resolver',
    );
    assert.deepEqual(
      m.vendorItemIds.map((v) => [v.slot, v.itemId]),
      [[2, 1234]],
      'AddVendorItem2 captures concrete item id',
    );
    assert.equal(m.venderType, 1);
  });

  it('parses SetBuffSkill list for buff-pang NPCs (SI_* resolved, bare numeric ok)', () => {
    const idx = index();
    const helper = idx.byKey.get('MaFl_Helper')!;
    assert.ok(helper.menus.includes(MMI_NPC_BUFF), 'MMI_NPC_BUFF (74) in menus');
    assert.equal(helper.buffSkills.length, 4);
    // SI_* resolved via defineSkill.h
    const [s0, s1, s2, s3] = helper.buffSkills;
    assert.deepEqual(
      [s0.skillId, s0.level, s0.minPlayerLevel, s0.maxPlayerLevel, s0.durationMs],
      [SI.get('SI_GEN_EVE_QUICKSTEP'), 2, 1, 30, 3600000],
      'first SetBuffSkill fields',
    );
    assert.equal(s1.skillId, SI.get('SI_GEN_EVE_HASTE'));
    assert.equal(s2.skillId, SI.get('SI_ASS_CHEER_QUICKSTEP'));
    // Bare numeric skill id accepted
    assert.deepEqual(
      [s3.skillId, s3.level, s3.minPlayerLevel, s3.maxPlayerLevel, s3.durationMs],
      [123, 4, 5, 99, 60000],
      'bare numeric skill id',
    );
  });

  it('defaults buffSkills to [] for non-buff NPCs', () => {
    const idx = index();
    assert.deepEqual(idx.byKey.get('MaFl_Noier')!.buffSkills, []);
    assert.deepEqual(idx.byKey.get('MaFl_Marche')!.buffSkills, []);
  });

  it('resolves a character.inc block key even without outfit (AddMenu-only NPC)', () => {
    const idx = index();
    const noier = idx.byKey.get('MaFl_Noier')!;
    assert.equal(noier.outfit, undefined, 'no SetFigure/SetEquip');
    assert.equal(noier.key, 'MaFl_Noier', 'block key still present for m_szCharacterKey');
    assert.equal(noier.hasDialog, true);
    assert.equal(noier.vendorItems.length, 0);
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
    const blocks = parseCharacterInc(src, II, IK3, MMI);
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
    const blocks = parseCharacterInc(src, II, IK3, MMI);
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
