/**
 * CMover::Serialize (METHOD_NONE self-spawn, __VER 15) + empty container
 * sub-serializers. Field order is byte-exact vs `_Common/ObjSerializeOpt.cpp:97`.
 *
 * Fresh-spawn model: a newly created character with no items, bank, quests,
 * buffs, pet, pocket, guild, or party. Every such field writes its zero/empty
 * framing. Tracked character fields (name, stats, pos, appearance, hp, mp,
 * level, job) come from `CPlayer`; the rest default to 0.
 *
 * OBJID "none" init values locked vs C++ (_Common/Mover.cpp): m_idGuildCloak=0
 * (:381), m_idMurderer=NULL_ID (:342). m_idMarkingWorld is the one outstanding
 * gap — C++ overwrites it with the numeric world ID on entry (Mover.cpp:969,
 * `m_idMarkingWorld = GetWorld()->GetID()`); this slice has no numeric world IDs
 * yet, so it stays NULL_ID here until world-id mapping lands. m_dwMute is
 * written (0) under __JEFF_9_20 (defined in WORLDSERVER/VersionCommon.h:112).
 *
 * @module net/snapshot/mover.serializer
 */

import type { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import type { CPlayer } from '../../entities/player.js';
import {
  MAX_HUMAN_PARTS, MAX_JOB, MAX_SKILL_JOB, SKILL_SIZE, SM_MAX,
  MAX_HONOR_TITLE, INVENTORY_SLOTS, BANK_SLOTS, MAX_BANK_TABS, MAX_POCKET_TABS,
} from './constants.js';
import { writeQuestStruct } from './quest.serializer.js';

const NULL_ID = 0xffffffff;

/**
 * Empty CItemContainer<CItemElem> — `slots`-wide. `slots` MUST match the
 * client's `m_dwItemMax`: inventory = `INVENTORY_SLOTS` (73), bank tab =
 * `BANK_SLOTS` (42). See `constants.ts` for why these differ from the bare
 * `MAX_INVENTORY` / `MAX_BANK` defines.
 */
export function writeEmptyItemContainer(w: PacketWriter, slots: number): void {
  for (let i = 0; i < slots; i++) w.writeDword(NULL_ID); // m_apIndex[]
  w.writeByte(0);                                        // chSize
  for (let i = 0; i < slots; i++) w.writeDword(NULL_ID); // adwObjIndex[]
}

/** Empty CPocketController — 3 absent pocket tabs. */
function writeEmptyPocketController(w: PacketWriter): void {
  for (let i = 0; i < MAX_POCKET_TABS; i++) w.writeByte(0); // availability flag
}

/** Empty CBuffMgr — zero buffs (__BUFF_1107 active). Shared with NPC branch. */
export function writeEmptyBuffs(w: PacketWriter): void {
  w.writeDword(0); // size_t count
}

/**
 * CMover::Serialize — full METHOD_NONE self-spawn field list.
 * Prefix fields (1–43) then METHOD_NONE branch (45–87) then buffs.
 */
export function writeMoverSerialize(w: PacketWriter, p: CPlayer): void {
  // --- prefix ---
  w.writeWord(0);              // m_dwMotion
  w.writeByte(1);              // m_bPlayer
  w.writeDword(p.m_nHp);       // m_nHitPoint
  w.writeDword(0);             // GetState()
  w.writeDword(0);             // GetStateFlag()
  w.writeByte(0);              // m_dwBelligerence
  w.writeDword(0);             // m_dwMoverSfxId (__VER>=15)
  w.writeString(p.m_szName);   // m_szName
  w.writeByte(p.m_nSex);       // GetSex()
  w.writeByte(p.m_dwSkin);     // m_dwSkinSet
  w.writeByte(p.m_nHairMesh);  // m_dwHairMesh
  w.writeDword(p.m_dwHairColor); // m_dwHairColor
  w.writeByte(p.m_nHeadMesh);  // m_dwHeadMesh
  w.writeDword(p.m_idPlayer);  // m_idPlayer
  w.writeByte(p.m_nJob);       // m_nJob
  w.writeWord(p.m_nStr);       // m_nStr
  w.writeWord(p.m_nSta);       // m_nSta
  w.writeWord(p.m_nDex);       // m_nDex
  w.writeWord(p.m_nInt);       // m_nInt
  w.writeWord(p.m_nLevel);     // m_nLevel
  w.writeDword(0);             // m_nFuel
  w.writeDword(0);             // m_tmAccFuel
  w.writeByte(0);              // guild flag (no guild → skip idGuild/idWar)
  w.writeDword(0);             // m_idGuildCloak (Mover.cpp:381 inits to 0)
  w.writeByte(0);              // party flag (no party → skip idparty/idDuelParty)
  w.writeByte(0);              // m_dwAuthorization
  w.writeDword(0);             // m_dwMode
  w.writeDword(0);             // m_dwStateMode
  w.writeDword(0);             // dwUseItemId (0 = none)
  w.writeDword(0);             // m_dwPKTime (__VER>=8)
  w.writeDword(0);             // m_nPKValue
  w.writeDword(p.m_dwPKPropensity); // m_dwPKPropensity (IsChaotic when >0)
  w.writeDword(0);             // m_dwPKExp
  w.writeDword(0);             // m_nFame
  w.writeByte(0);              // m_nDuel
  w.writeDword(0);             // m_nHonor (__VER>=13)
  for (let i = 0; i < MAX_HUMAN_PARTS; i++) w.writeDword(0); // equipInfo[].nOption ×31
  w.writeDword(0);             // m_nGuildCombatState
  for (let j = 0; j < SM_MAX; j++) w.writeDword(0);          // m_dwSMTime ×26

  // --- METHOD_NONE branch ---
  w.writeWord(p.m_nMp);        // m_nManaPoint
  w.writeWord(0);              // m_nFatiguePoint
  w.writeDword(0);             // m_nTutorialState (__VER>=12)
  w.writeDword(0);             // m_nFxp
  w.writeDword(0);             // dwGold
  w.writeQword(0);             // m_nExp1 (EXPINTEGER __int64, 8 bytes)
  w.writeDword(0);             // m_nSkillLevel
  w.writeDword(0);             // m_nSkillPoint
  w.writeQword(0);             // m_nDeathExp (EXPINTEGER __int64, 8 bytes)
  w.writeDword(0);             // m_nDeathLevel
  for (let i = 0; i < MAX_JOB; i++) w.writeDword(0);         // dwJobLv ×32 (always 0)
  w.writeDword(NULL_ID);       // m_idMarkingWorld (gap — C++ writes numeric world ID, Mover.cpp:969)
  w.writeFloat(0); w.writeFloat(0); w.writeFloat(0);         // m_vMarkingPos
  // --- Per-player quest arrays (inline after the size bytes — ObjSerializeOpt.cpp:201-207) ---
  w.writeByte(p.m_aQuest.length);                       // m_nQuestSize (BYTE)
  for (const q of p.m_aQuest) writeQuestStruct(w, q);   // m_aQuest × size (12B each)
  w.writeByte(p.m_aCompleteQuest.length);               // m_nCompleteQuestSize (BYTE)
  for (const id of p.m_aCompleteQuest) w.writeWord(id); // m_aCompleteQuest × size (WORD each)
  w.writeByte(p.m_aCheckedQuest.length);                // m_nCheckedQuestSize (BYTE)
  for (const id of p.m_aCheckedQuest) w.writeWord(id);  // m_aCheckedQuest × size (WORD each)
  w.writeDword(NULL_ID);       // m_idMurderer
  w.writeWord(0);              // m_nRemainGP
  w.writeWord(0);              // padding (literal 0)
  for (let i = 0; i < MAX_HUMAN_PARTS; i++) w.writeDword(0); // equipInfo[].dwId ×31
  for (let i = 0; i < MAX_SKILL_JOB * SKILL_SIZE; i++) w.writeByte(0); // m_aJobSkill raw
  w.writeByte(0);              // m_nCheerPoint
  w.writeDword(0);             // m_dwTickCheer - GetTickCount()
  w.writeByte(0);              // m_nSlot
  for (let k = 0; k < 3; k++) w.writeDword(0);               // m_dwGoldBank ×3
  for (let k = 0; k < 3; k++) w.writeDword(0);               // m_idPlayerBank ×3
  w.writeDword(0);             // m_nPlusMaxHitPoint (LONG)
  w.writeByte(0);              // m_nAttackResistLeft (BYTE — Mover.h:618)
  w.writeByte(0);              // m_nAttackResistRight (BYTE — Mover.h:619)
  w.writeByte(0);              // m_nDefenseResist (BYTE — Mover.h:620)
  w.writeQword(0);             // m_nAngelExp (EXPINTEGER __int64, 8 bytes; __VER>=8)
  w.writeDword(0);             // m_nAngelLevel

  // --- containers ---
  writeEmptyItemContainer(w, INVENTORY_SLOTS);              // m_Inventory (73 = MAX_INVENTORY + MAX_HUMAN_PARTS)
  for (let k = 0; k < MAX_BANK_TABS; k++) writeEmptyItemContainer(w, BANK_SLOTS); // m_Bank ×3 (42 each)
  w.writeDword(0);             // GetPetId (__VER>=9)
  writeEmptyPocketController(w);                       // m_Pocket (__VER>=11)
  w.writeDword(0);             // m_dwMute (#ifdef __JEFF_9_20 — defined in VersionCommon.h:112)
  for (let i = 0; i < MAX_HONOR_TITLE; i++) w.writeDword(0); // m_aHonorTitle ×150 (__VER>=13)
  w.writeDword(0);             // m_idCampus (__VER>=15)
  w.writeDword(0);             // m_nCampusPoint (__VER>=15)

  // --- buffs (always active, __BUFF_1107) ---
  writeEmptyBuffs(w);
}
