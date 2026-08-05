# v19 Skill System — Research (C++ → TS port reference)

Aggregated from 4 parallel research passes over `H:\flyff\v19\Source\Source\` + `raw/propSkill*`. Canonical C++ cites preserved; this is the implementation reference for the skill system.

## 1. Resources

### propSkill.txt (static base skill) — 124 cols, UTF-16LE, tab-delimited
Row 1 = Korean labels (skip). Row 2 = `//ver //dwID szName …` (real header). Data rows: **first col = version int (6)** consumed before the row loop. Loaded by `ProjectCmn.cpp:300-541` (`LoadPropItem`, same struct/loader as propItem.txt). `=` token → `NULL_ID (0xFFFFFFFF)` (`scanner.cpp:878`).

Columns the engine needs (full 124-col table in researcher A; combat-relevant subset):
- `dwID` (SI_*), `szName` (IDS_PROPSKILL_TXT_*), `dwItemKind1` (JTYPE tier), `dwItemKind2` (JOB), `dwItemKind3` (DIS)
- `dwHanded` (HD_*), `dwWeaponType` (WT_*), `dwAttackRange` (AR_*)
- `dwReqDisLV` (min job-dispatch lvl), `dwReSkill1`/`dwReSkillLevel1`, `dwReSkill2`/`dwReSkillLevel2` (prereqs)
- `dwSkillReadyType` (SR_*), `dwSkillReady` (base cooldown ms — fallback for per-level `=`)
- `dwExeTarget` (EXT_* cast mechanic), `dwUseChance` (WUI_* targeting), `dwSpellRegion` (SRO_* AoE shape), `dwSpellType` (ST_* element), `dwSkillType` (KT_* — MP vs FP)
- `dwReferStat1/2` (DST_*), `dwReferTarget1/2` (RT_*), `dwReferValue1/2`
- `dwSubDefine` (SA_* per-level anchor), `dwExpertMax` (skill level cap)
- `dwSfxElemental` (XI_SKILL_* visual, NOT element), `dwUseMotion` (MTI_*), `dwCircleTime`, `dwSkillTime` (buff dur)

### propSkillAdd.csv (per-level) — 36 cols, UTF-8, comma-delimited
Row 1 = Korean (skip), row 2 = `//dwID,dwName,dwSkillLvl,…`. Loaded by `Project.cpp:2511-2600`. Read via `GetNumber(TRUE)` (comma-as-decimal mode).
- `dwID` (SA_*_L##), `dwName` (parent SI_*), `dwSkillLvl` (1..N)
- `dwAbilityMin`, `dwAtkAbilityMax`→`dwAbilityMax`, `dwAbilityMinPVP/MaxPVP`
- `dwAttackSpeed`, `dwDmgShift`, `nProbability`, `nProbabilityPVP`, `dwTaunt`
- `dwDestParam1/2`, `nAdjParamVal1/2`, `dwChgParamVal1/2`, `dwdestData1/2/3`
- `dwactiveskill`, `dwActiveSkillRate`, `dwActiveSkillRatePVP`
- `dwReqMp`→`nReqMp` (**signed int**), `dwRepFp`→`nReqFp` (**signed int**), `dwCooldown`, `dwCastingTime`, `dwSkillRange`, `dwCircleTime`, `dwPainTime`, `dwSkillTime`, `dwSkillCount`→`nSkillCount` (**signed int**), `dwSkillExp`, `dwExp`, `dwComboSkillTime`

### Merge / `=` rules (`Project.cpp:2571-2590`)
Only 5 fields inherit on `=`:
- `dwAbilityMinPVP` ← same-row `dwAbilityMin`
- `dwAbilityMaxPVP` ← same-row `dwAbilityMax`
- `nProbabilityPVP` ← same-row `nProbability`
- `dwActiveSkillRatePVP` ← same-row `dwActiveSkillRate`
- `dwCooldown` ← base skill `dwSkillReady`

Plus: if base `nVer < 9` AND `dwCastingTime ≠ =` → `/= 4`. All other `=` → `0xFFFFFFFF`.

### Join
`GetAddSkillProp(dwSubDefine, level)` = `m_aPropAddSkill[dwSubDefine + level - 1]` (`Project.cpp:868-885`). Per-level rows are contiguous ascending SA_* ids.

### Counts (verified)
190 base skills, 191 parent refs (1 orphan), 2310 per-level rows. Max-level dist: L20×67, L10×81, L5×29, L3×1, L1×13.

## 2. Enums (defineAttribute.h / defineJob.h / define.h / defineSkill.h)
- **JTYPE** (tier): BASE=0, EXPERT=1, PRO=2, COMMON=4, MASTER=5, HERO=6
- **KT** (resource): MAGIC=1 (MP), SKILL=2 (FP)
- **ST** (element): MAGIC=1, POISON=3, ELECTRICITY=4, FIRE=5, WIND=6, WATER=7, EARTH=8, DARK=9, LIGHT=10
- **SRO** (AoE): DIRECT=1, REGION=2, EXTENT=3, SURROUND=4, LINE=6, AROUND=7, TROUPE=8
- **RT** (apply): ATTACK=1, TIME=2, HEAL=3
- **EXT** (mechanic): SELFCHGPARAMET=1, OBJCHGPARAMET=2, MAGIC=7, MAGICATK=4, MAGICATKSHOT=14, MELEEATK=17, RANGEATK=18
- **WUI** (targeting): NOW=1, TARGETOBJ=2, TARGETINGOBJ=4 (most), TARGETMOVEOBJ=7, MENU=9
- **SR** (cooldown trigger): AFTER=1, BEFORE=2
- **DST**: STR=1, DEX=2, INT=3, STA=4, SPEED=11, HP_MAX=35, MP_MAX=36, FP_MAX=37, HP=38, MP=39, FP=40, CHRSTATE=64, RESIST_MAGIC_RATE (extended)
- **JOB**: VAGRANT=0, MERCENARY=1, ACROBAT=2, ASSIST=3, MAGICIAN=4, KNIGHT=6, BLADE=7, JESTER=8, RANGER=9, RINGMASTER=10, BILLPOSTER=11, PSYCHIKEEPER=12, ELEMENTOR=13 (MAX_JOB=32)

## 3. Wire format
### C→S
- **USESKILL 0x00ff0020** (`DPSrvrLux.cpp:32`): `WORD wType(=0) | WORD wId(slot 0..44) | DWORD objid(target) | int nUseType(SUT 0/1/2) | BOOL bControl(4B)`. `wId` = slot INDEX not skill id. Failure → `CLEAR_USESKILL 0x001a` header-only to caster.
- **MAGIC_ATTACK 0x00ff0011**: magic basic-auto only. `DWORD dwAtkMsg(=36) | DWORD objid | int nParam2 | int nParam3 | int nMagicPower(charge 0..3) | int idSfxHit`.
- **RANGE_ATTACK 0x00ff0012**: bow/yoyo basic-auto only. `DWORD dwAtkMsg(=35) | DWORD objid | DWORD dwItemID(ammo) | int idSfxHit`.
- **DOUSESKILLPOINT 0x000f0003** (learn): `45×(DWORD dwSkill, DWORD dwLevel)` no count prefix.

> USESKILL covers ALL skill casts. MAGIC/RANGE_ATTACK are the equipped-weapon basic-attack loop.

### S→C (snapshots)
- **USESKILL 0x0019** (`User.cpp:4501`): `objid|0x0019|DWORD dwSkill(id)|DWORD dwLevel|DWORD target|int nUseType|int nCastingTime(ms)` — vicinity incl caster.
- **CLEAR_USESKILL 0x001a**: header only.
- **SETPOINTPARAM 0x001e** (existing): `objid|0x001e|int dst|int value(absolute)`. DST_MP=39/DST_FP=40.
- **DOUSESKILLPOINT 0x007d** (learn confirm, self only): `objid|0x007d|45×(DWORD dwSkill,DWORD dwLevel)|int nSkillPoint`.
- **SETSKILLLEVEL 0x0026**: `objid|0x0026|DWORD dwSkill|DWORD dwLevel` vicinity excl caster (client stub).
- **MAGIC_ATTACK 0x00e1 / RANGE_ATTACK 0x00e2**: auto-attack broadcast excl caster.
- **DAMAGE 0x0013** (existing): reused for skill HP-sync with AF_* flags.
- Cooldown: NO S→C packet — server-implicit `m_tmReUseDelay[idx]`. Cast bar from `nCastingTime` in USESKILL snapshot.

## 4. Casting pipeline (`MoverSkill.cpp:288` DoUseSkill)
Gate order: IsDie/fly/NOATTACK → world-bans → NO_ATTACK_MODE → load SkillProp+AddSkillProp → target → PK gate → buff block → item reqs → hostility → **weapon link** (IK3_STAFF/WAND magic, IK3_BOW/YOYO yobo) → bullet → **req level + prereqs** → **cooldown** (`GetReuseDelay`) → **MP/FP afford** → animation (`SendActMsg`) → **MP/FP spend** (KT_SKILL up-front; KT_MAGIC per-hit) → (per tick) damage. Range NOT gated in DoUseSkill. Probability rolled per-target in `ApplySkill`.

Skill damage **reuses melee `CAttackArbiter::CalcDamage`** — not separate. Flag = `AF_MELEESKILL`/`AF_MAGICSKILL`; ATK source = `GetMeleeSkillPower`/`GetMagicSkillPower` (replaces `GetHitPower`). **No `AF_RANGESKILL`** — bows = `AF_GENERIC|AF_RANGE` via melee pipe.

### `GetMeleeSkillPower` (`MoverAttack.cpp:1460`, shared melee+magic base)
```
nReferStat = referStat1 + referStat2   (RT_ATTACK: (dwReferValue/10)*stat + skillLvl*(stat/50))
fPowerMin = ((weaponMin + (abilityMin + nAddSkillMin)*5 + nReferStat - 20) * (16+skillLvl)/13)
fPowerMax = ((weaponMax + (abilityMax + nAddSkillMax)*5 + nReferStat - 20) * (16+skillLvl)/13)
+ GetPlusWeaponATK + GetParam(DST_CHR_DMG)
return fPowerMin + xRandom(fPowerMax - fPowerMin + 1)
```
### `GetMagicSkillPower` (`MoverAttack.cpp:1025`)
`= GetMeleeSkillPower + GetParam(DST_ADDMAGIC) + nATK * (GetParam(DST_MASTRY_<elem>)/100)`
### `PostCalcMagicSkill` (`MoverAttack.cpp:1096`)
```
nDEF = defender.CalcDefense   (same as melee)
nATK -= nATK * GetParam(DST_RESIST_MAGIC_RATE)/100   (magic only, AF_MAGICSKILL)
a = (nATK - nDEF) * (1 - GetResist(skillElement))
return a * GetMagicSkillFactor(defender, skillElement)   (own 6×6: same=1.1, beats=0.9, else 1.0)
```
MagicSkillFactor cycle (1>2,2>3,3>5,5>4,4>1) — **separate** from the melee ELEMENT_MATCH table.

### Heal/buff (non-damage; `dwExeTarget` EXT_SELFCHGPARAMET/OBJCHGPARAMET → `ApplyParam`)
- Heal (RT_HEAL): `nIncHP = nAdjParamVal1 + (dwReferValue/10)*casterStat + skillLvl*(stat/50)` per slot → `SetDestParam(DST_HP, nIncHP, chgVal)`
- Buff: `SetDestParam(dwDestParam, nAdjParamVal, dwChgParamVal)` (DST_CHRSTATE → CHS_* status)

### AoE (`dwSpellRegion`, instant not per-tick)
DIRECT single | AROUND (target excl) | REGION (target incl) | LINE cone. Radius = `dwSkillRange` snapped 4/8/16/32.

> **`dwSkillRange` is the AoE radius only — never the cast reach.** It is
> per-level (propSkillAdd) and is read exclusively by `ApplySkillRegion` /
> `ApplySkillAround` / `ApplySkillLine` / `ApplySkillAroundTroupe`
> (`Ctrl.cpp:268,432,752,1675`). Cast reach is the BASE row's `dwAttackRange`
> `AR_*` enum via `GetAttackRange` (`MoverMsg.cpp:140-166`) — see §4.1. Confusing
> the two capped Heal at 6 m instead of AR_WAND's 15 m (fixed 2026-08-04).

### 4.1 Range: not server-gated in C++ (emulator divergence)
`DoUseSkill` never checks distance — see the "Range NOT gated" note in §4. The
only skill use of `GetAttackRange` is the **client-side** `CMD_SetUseSkill`
(`MoverMsg.cpp:206`; callers `WndManager.cpp:7337`, `WndTaskBar.cpp:2366`), where
`fArrivalRange` feeds `SetDestObj(idTarget, fArrivalRange, TRUE)` — the distance
the client walks to before casting, not a rejection.

`AR_*` → metres (`MoverMsg.cpp:140-166`, `defineAttribute.h:93-99`):
`SHORT(1)=2 · LONG(2)=3 · FAR(3)=4 · RANGE(4)=10 · WAND(5)=15 · HRANGE(6)=6 ·
HWAND(7)=18 · default=0`, then `*(DST_HAWKEYE_RATE+100)/100` (Ranger Hawkeye).

`CObj::IsRangeObj` (`Obj.cpp:805`) compares against
`0.8*GetRadius(this) + 0.8*GetRadius(other) + fRange` — the model bounds are part
of the reach, so any port without meshes needs a slack allowance standing in.

**This emulator diverges deliberately:** it rejects out-of-range casts server-side
(`skills/services/skill.service.ts`), since a server cannot trust the client.

### Multi-hit (`nSkillCount`)
Each hit = full damage roll + own DAMAGE snapshot, 4-frame spacing. Magic MP split per hit (`nReqMp/nSkillCount`).

## 5. Learning (`DPSrvr.cpp:3265` OnDoUseSkillPoint)
- In-mem: `SKILL m_aJobSkill[45]` flat array (8B each: DWORD dwSkill, DWORD dwLevel; NULL_ID=0xffffffff empty). `m_nSkillLevel` (total SP earned), `m_nSkillPoint` (unspent).
- Slots: 0-2 vagrant, 3-22 expert, 23-42 pro, 43 master, 44 hero.
- Level-up SP grant: `((level-1)/20)+2` (`MoverParam.cpp:1434`).
- Cost per raised level × tier: vagrant 1, expert 2, pro/master/hero 3 (`Project.cpp:5132`).
- Server validation: skip NULL_ID; reject decrease; reject > dwExpertMax; Σ cost; reject if SP < cost. **No job/prereq/level check server-side (client gates) — anti-cheat gap to close.**
- New Vagrant: 3 slots pre-seeded with SI_VAG_* ids at level 0. SP=0.

## 6. JOIN (existing blob — extend, don't restructure)
Skill block already emitted positionally in `mover.serializer.ts`:
- L134-135: `m_nSkillLevel`, `m_nSkillPoint` (hardcoded 0 → wire real values)
- L155: `m_aJobSkill` raw (`MAX_SKILL_JOB*SKILL_SIZE` zeros → wire real 45×8 blob)

C++ order confirmed `ObjSerializeOpt.cpp:237`: after `m_aEquipInfo[].dwId`, before `m_nCheerPoint`. 360 bytes, no count prefix.

## MVP scope (Phase 1)
Single-target damage skills only (EXT_MELEEATK + EXT_MAGICATKSHOT). Ship: real skill data + DB repo + CPlayer state + JOIN wire + level-up SP + learn handler + USESKILL handler + magic/melee skill damage + MP/FP/cooldown + tests.

**Defer (ponytail):** AoE shapes, multi-hit, heal/buff, DoT (tmContinuousPain), MAGIC_ATTACK/RANGE_ATTACK auto-attack handlers, quick-slot taskbar, projectile skills, element mastery (DST_MASTRY), PVP damage vars.
