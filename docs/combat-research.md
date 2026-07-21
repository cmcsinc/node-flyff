# v15 Combat — Research Findings (C++ → TS port)

Source root: `H:\flyff\v15\Source\Source\`. Generated 2026-07-21 by 4 parallel researcher dives.
This is the canonical formula reference for porting the combat system. Do not re-research — cite this.

---

## A. Stats (MoverParam.cpp, MoverAttack.cpp, propJob.inc)

### Stat getters (base + buff layer)
- `GetStr/Sta/Dex/Int` = `m_nX + GetParam(DST_X, 0)` (MoverParam.cpp:3163/3226/3184/3205)
- `GetParam(dst, default)`: if buff present return buff value else `default`. Implement as a buff map lookup.

### Melee weapon ATK by weapon type — `GetWeaponATK` (MoverAttack.cpp:371)
| Weapon | Formula |
|---|---|
| WT_MELEE_SWD (1) | `(STR-12)*fMeleeSWD + LVL*1.1` |
| WT_MELEE_AXE (2) | `(STR-12)*fMeleeAXE + LVL*1.2` |
| WT_MELEE_STICK (3) | `(STR-10)*fMeleeSTICK + LVL*1.3` |
| WT_MELEE_KNUCKLE (4) | `(STR-10)*fMeleeKNUCKLE + LVL*1.2` |
| WT_MELEE_STAFF (5) | `(STR-10)*fMeleeSTAFF + LVL*1.1` |
| WT_MAGIC_WAND (6) | `(INT-10)*fMagicWAND + LVL*1.2` |
| WT_MELEE_YOYO (20) | `(STR-12)*fMeleeYOYO + LVL*1.1` |
| WT_RANGE_BOW (21) | `((DEX-14)*4.0 + LVL*1.3 + STR*0.2) * 0.7` |

Then `+= GetPlusWeaponATK(weaponType)` (skill/buff bonuses — stub 0 for v1).

### Final min/max — `GetHitMinMax` (MoverAttack.cpp:412)
Player branch:
```
nMin = pItemProp->dwAbilityMin * 2
nMax = pItemProp->dwAbilityMax * 2
nMin = GetParam(DST_ABILITY_MIN, nMin)   // buff override
nMax = GetParam(DST_ABILITY_MAX, nMax)
nPlus = GetWeaponATK(weaponType) + GetParam(DST_CHR_DMG, 0)
nMin += nPlus; nMax += nPlus
f = GetItemMultiplier(weapon)            // upgrade multi; =1.0 v1
nMin = int(nMin*f); nMax = int(nMax*f)
nOption = weapon.abilityOption
if (nOption>0) { v = int(pow(nOption,1.5)); nMin+=v; nMax+=v }
```
NPC branch: `nMin/nMax = propMover.dwAtkMin/dwAtkMax` (+ weapon override if dwAtk1 set).

### Hit Rate — `GetHR` (MoverAttack.cpp:233)
Player = `DEX`. NPC = `propMover.dwHR`.

### Hit-roll — `GetAttackResult` (MoverAttack.cpp:241)
```
NPC→Player: nHitRate = (HR*1.6/(HR+defender.Parrying))*1.5  * (LVL*1.2/(LVL+defLVL))   *100
Player→NPC: nHitRate = (HR*1.5/(HR+defender.Parrying))*2.0  * (LVL*0.5/(LVL+defLVL*0.3))*100
PvP:        nHitRate = (HR*1.6/(HR+defender.Parrying))*1.2  * (LVL*1.2/(LVL+defLVL))   *100
+ GetAdjHitRate(); clamp [MIN_HR=20, 96]; hit = xRandom(100) < nHitRate
```

### Parrying — `GetParrying` (MoverParam.cpp:506)
Player = `int(DEX*0.5 + GetParam(DST_PARRY, adjParry))`. NPC = `propMover.dwER`.

### Attack Speed — `GetAttackSpeed` (MoverAttack.cpp:156)
```
fItem = weapon.fAttackSpeed
A = int( jobProp.fAttackSpeed + (fItem * (4.0*DEX + LVL/8.0)) - 3.0 )
if (A >= 187.5) A = 187
fSpeed = (50.0/(200.0 - A))/2.0 + ATK_SPEED_PLUS_TABLE[A/10]
fSpeed += DST_ATTACKSPEED/1000.0
clamp [0.1, 2.0]
```
ATK_SPEED_PLUS_TABLE (MoverAttack.cpp:71, index = clamp(A/10,0,17)):
`[0.08,0.16,0.24,0.32,0.40,0.48,0.56,0.64,0.72,0.80,0.88,0.96,1.04,1.12,1.20,1.30,1.38,1.50]`
`__HACK_1023`: MELEE_ATTACK packet has trailing FLOAT = this fSpeed (anti-cheat echo).

### Crit prob — `GetCriticalProb` (MoverAttack.cpp:609)
`nProb = int((DEX/10) * jobProp.fCritical); nProb = GetParam(DST_CHR_CHANCECRITICAL, nProb)`.
`IsCriticalAttack`: `!skill && xRandom(100) < GetCriticalProb()`.

### Block factor — `GetBlockFactor` (MoverAttack.cpp:731)
Player defender (`r=xRandom(80)`): `r<=5→1.0; r>=75→0.1; else nBR=int(DEX/8*jobProp.fBlocking + fAdd); nBR>r→0.0 (full block) else 1.0`.
NPC defender (`r=xRandom(100)`): `r<=5→1.0; r>=95→0.1; nBR=max(0,(Parrying-LVL)*0.5); nBR>r→0.2 (80% red) else 1.0`.

### Max HP/MP/FP (MoverParam.cpp:2788/2808/2825)
```
HP player base: a = jobProp.fFactorMaxHP*LVL/2; b = a*((LVL+1)/4)*(1+STA/50) + STA*10; maxHP = b+80
MP player base: (LVL*2 + INT*8)*jobProp.fFactorMaxMP + 22 + INT*jobProp.fFactorMaxMP
FP player base: ((LVL*2) + STA*6)*jobProp.fFactorMaxFP + STA*jobProp.fFactorMaxFP
NPC HP: dwAddHp * monsterHitpointRate(1.0) * hitPointRate(1.0)
```

### Job table — propJob.inc (17 floats/row, 32 rows)
Col order: `fAttackSpeed, fFactorMaxHP, fFactorMaxMP, fFactorMaxFP, fFactorDef, fFactorHPRec, fFactorMPRec, fFactorFPRec, fMeleeSWD, fMeleeAXE, fMeleeSTAFF, fMeleeSTICK, fMeleeKNUCKLE, fMagicWAND, fBlocking, fMeleeYOYO, fCritical`
- JOB_VAGRANT(0):  75, 0.9, 0.3, 0.3, 1.0, 1.2, 0.5, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.2, 4.2, 1.0
- JOB_MERCENARY(1):80, 1.5, 0.5, 0.7, 1.35,1.6, 0.5, 1.0, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.8, 4.2, 1.0
- Full 32 rows at `H:\flyff\v15\Server\Resource\propJob.inc:3-34`. Master/Hero rows dup base.
- NPC `GetJobProp()` always returns VAGRANT (job 0).
- Job ids: `resource/defineJob.h:41-85` (JOB_VAGRANT=0 … JOB_ELEMENTOR_HERO=31, MAX_JOB=32).

### propMover.txt columns (ProjectCmn.cpp:152, 1-based after name token)
| # | Field | Used by |
|---|---|---|
| 6 | dwHR | GetHR NPC |
| 7 | dwER | GetParrying NPC |
| 11 | dwLevel | every LVL formula |
| 14 | dwClass | RANK_GUARD/SUPER/MIDBOSS gates |
| 19 | dwAtkMin | GetHitMinMax NPC |
| 20 | dwAtkMax | GetHitMinMax NPC |
| 32 | dwReAttackDelay | NPC swing pace |
| 33 | dwAddHp | GetMaxOriginHitPoint NPC |
| 35 | dwNaturalArmor | CalcDefenseNPC melee |
| 39 | eElementType | element factor |
| 48 | dwResisMgic | CalcDefenseNPC magic |

---

## B. Damage Pipeline (AttackArbiter.cpp, MoverAttack.cpp)

### Entry: OnMeleeAttack (DPSrvr.cpp:4131) → SendActMsg → enqueue m_qMeleeAtkMsg → tick `CAction::OnEndAttackState` (Action.cpp:101) → `ProcessAtkMsg` → `CMeleeAtkMsgq::Process` (ActionMover.cpp:32) → `_ProcessMsgDmg` (ActionMoverDmg.cpp:41) → `CAttackArbiter::OnDamageMsgW` (AttackArbiter.cpp:125).

Server processes damage on the **tick** when the attack-animation state ends, NOT inline on packet. For TS v1 we may process inline (no animation-state machine yet).

### AF_* flags (ActionMover.h:27) — packed in dwAtkFlags, sent in DAMAGE snapshot
`AF_GENERIC=0x01, AF_MISS=0x02, AF_MAGIC=0x08, AF_MELEESKILL=0x10, AF_MAGICSKILL=0x20, AF_CRITICAL1=0x40 (2.3x), AF_CRITICAL2=0x80 (2.6x ATK4), AF_CRITICAL=0xC0 (mask), AF_PUSH=0x100, AF_PARRY=0x200, AF_RESIST=0x400, AF_STUN=0x800, AF_BLOCKING=0x1000, AF_FORCE=0x2000, AF_RANGE=0x4000, AF_FLYING=0x10000000 (knock-up, appends pos+angle to DAMAGE)`.

### OnDamageMsgW orchestration (AttackArbiter.cpp:125)
```
for each hand (right/left per GetHandFlag):
    n = CalcDamage(&info)
    if n>0: ProcessAbnormal(n); StealHP(n); nDamage += n
// PvP reductions
nDamage = max(nDamage, 1)
nHP = defender.MinusHP(&nDamage)
defender.OnAttacked(attacker, nDamage)
if nHP>0 OnDamaged else OnDied
```

### CalcDamage (AttackArbiter.cpp:352)
`if ONEKILL_MODE return defender.HP; nDamage = PostCalcDamage(CalcATK(&info), &info); dwAtkFlags = info.dwAtkFlags; return nDamage`

### CalcATK (AttackArbiter.cpp:304)
```
switch atkType:
  ATK_GENERIC:   nATK = attacker.GetHitPower(&info)      // normal melee
  ATK_MELEESKILL:nATK = attacker.GetMeleeSkillPower(&info)
  ATK_MAGICSKILL:nATK = attacker.GetMagicSkillPower(&info)
  ATK_MAGIC:     nATK = attacker.GetMagicHitPower(chargeLv)
  ATK_FORCE:     nATK = m_nParam                          // reflect
nATK = int(nATK * attacker.GetATKMultiplier(defender, flags))
if (linkCount>0) nATK = int(nATK * 0.1)   // each extra link hit = 10%
nATK += attacker.GetParam(DST_ATKPOWER, 0)
if (attacker.IsPlayer()) nATK += eventLua.GetAttackPower()   // 0 v1
if (nATK<0) nATK = 0
```

### GetHitPower (MoverAttack.cpp:1349) — normal melee roll
```
GetDamagePropertyFactor(defender, &nATKFactor, &nDEFFactor, parts)   // element factor
nMin,nMax = GetHitMinMax(&info)
if IsCriticalAttack: dwAtkFlags |= AF_CRITICAL; nMin*=fMin*fCritBonus; nMax*=fMax*fCritBonus
  // fMin/fMax from crit table (1.1/1.4 base; 1.2/2.0 player>npc; 1.4/1.8 npc>player)
nATK = xRandom(nMin, nMax)              // [nMin, nMax)
nATK = MulDiv(nATK, nATKFactor, 10000)  // element factor (10000 = neutral)
if range: nATK = int(nATK * chargeMult[chargeLv])   // [1.0,1.2,1.5,1.8,2.2]
```

### PostCalcDamage (AttackArbiter.cpp:453)
```
if AF_FORCE return nATK                              // bypasses DEF
if attacker.NPC && defender.Player && !MAGICSPELL:
    delta = atkLVL - defLVL; if delta>0 nATK = int(nATK*(1+0.05*delta))
switch GetPostCalcType(flags):
  POSTCALC_DPC:      nDamage = defender.ApplyDPC(nATK, &info); nDamage += CalcPropDamage(defender, flags)
  POSTCALC_GENERIC:  nDamage = attacker.PostCalcGeneric(nATK, &info)   // melee normal uses THIS
if nDamage<=0 return 0
nDamage += CalcLinkAttackDamage(nDamage)            // party link — 0 v1
nDamage = int(nDamage * GetDamageMultiplier(&info))
return OnAfterDamage(&info, nDamage)
```

### PostCalcGeneric (MoverAttack.cpp:1420) — the melee path
```
nDEF = defender.CalcDefense(&info)
nDEF = MulDiv(nDEF, info.nDEFFactor, 10000)         // element factor
nDamage = nATK - nDEF
if nDamage>0:
    fBlock = defender.GetBlockFactor(attacker, &info)
    if fBlock<1.0: dwAtkFlags |= AF_BLOCKING; nDamage = int(nDamage*fBlock)
else nDamage = 0
if attacker.NPC && defender.Player: nDamage = max(nDamage, int(max(0,nATK*0.1)))  // 10% floor
nDamage += GetWeaponPlusDamage(nDamage)             // ult proc — 0 v1
if nDamage==0: dwAtkFlags &= ~(AF_CRITICAL|AF_FLYING)
```

### CalcDefense → CalcDefenseCore (MoverAttack.cpp:514/573)
```
core = CalcDefenseCore(...); nDefense = int(core * GetDEFMultiplier(&info)); if Player +eventDef
CalcDefenseCore:
  if AF_MAGICSKILL: return GetResistMagic()
  if generic && Player: (((LVL*2)+(STA/2))/2.8 - 4) + ((STA-14)*fFactorDef) + DefByItem/4 + DST_ADJDEF
  if NPC defender:
     if AF_MAGIC: dwResisMgic/7.0 + 1
     else:        dwNaturalArmor/7.0 + 1
  if Player defender (CalcDefensePlayer, melee):
     (DefByItem + DST_ADJDEF)*2.3 + (LVL+STA/2+DEX)/2.8 - 4 + LVL*2
GetDEFMultiplier: if NPC *= m_fDefence_Rate(1.0); *= (1 + DST_ADJDEF_RATE/100)
```

### GetATKMultiplier (MoverAttack.cpp:1132)
`f = 1 + DST_ATKPOWER_RATE/100; if Player (SM_ATTACK_UP) f*=1.2; if NPC f *= monsterHitRate(1.0) * attackPower_Rate(1.0)`

### GetDamageMultiplier (MoverAttack.cpp:828) — final multipliers
```
factor = 1.0
if skill: factor /= addSkillProp.nSkillCount
// per-skill cases (v1: skip)
if attacker.NPC: if berserkHP>0 && HP%<=berserkHP factor *= berserkDmgMul
else: if defender.Player factor *= 0.60  // PvP global
      if parts==PARTS_LWEAPON factor *= 0.75   // off-hand
// level-diff penalty
delta = defLVL - atkLVL
if delta>0 && (atk.NPC||def.NPC): delta=min(delta,15); factor *= cos(pi*delta/32)   // cosine falloff
```

### MinusHP (AttackArbiter.cpp:687)
`nHP = HP - damage; if nHP<=0 { if invuln nHP=1 else nHP=0; damage = oldHP - nHP }; return nHP`

### Element system (MoverAttack.cpp:1275) — ePropType: NO_PROP=0,FIRE=1,WATER=2,ELECTRICITY=3,WIND=4,EARTH=5
Match table[atk][def] (0=none,1=normal,2=def-strong,3=atk-strong):
```
FIRE:        {0,1,2,0,3,0}
WATER:       {0,3,1,2,0,0}
ELECTRICITY: {0,0,3,1,0,2}
WIND:        {0,2,0,0,1,3}
EARTH:       {0,0,0,3,2,1}
```

### RNG
`xRandom(n)` = `[0,n)` int. `xRandom(a,b)` = `[a,b)` int. Match exactly.

### Server-authoritative hit/miss
Client sends HIWORD(nParam3)=error; server reads LOWORD(=0), recomputes via GetAttackResult. Never trust client dwAtkFlags for damage.

---

## C. Combat Packet Wire Formats (User.cpp, DPClient.cpp, MsgHdr.h)

All snapshot sub-entries: `[DWORD objid][WORD subtype][body]` inside PACKETTYPE_SNAPSHOT frame.
**DEAD in v15** (do NOT implement): top-level PACKETTYPE_SETEXPERIENCE/MOVERDEATH/CREATEITEM/SETLEVEL, PACKETTYPE_ADDEXPERIENCE, SNAPSHOTTYPE_UPDATE_MOVER, SNAPSHOTTYPE_UPDATE_ITEM. Only snapshot sub-types are live.

### DAMAGE — SNAPSHOTTYPE_DAMAGE = 0x0013 (User.cpp:4435 AddDamage, DPClient.cpp:1724 OnDamage)
Vicinity broadcast (this IS the per-mover HP sync — client does `IncHitPoint(-dwHit)` locally).
```
[objid victim]                       // DWORD (snapshot entry header, = GETID(pMover))
[0x0013]                             // WORD
objidAttacker: DWORD
dwHit:        DWORD   damage amount
dwAtkFlags:   DWORD   AF_* flags (drives blood SFX + damage color)
if (dwAtkFlags & AF_FLYING):
   pos: 3×float (12B); angle: float
```

### MOVER_DEATH — SNAPSHOTTYPE_MOVERDEATH = 0x00c7 (User.cpp:4488 AddMoverDeath, DPClient.cpp:1902)
Vicinity broadcast. Client zeroes HP locally.
```
[objid who-died][0x00c7]
objidKiller: DWORD
dwMsg:       DWORD   death flags (OBJMSG_*/kill-type)
```

### SETEXPERIENCE — SNAPSHOTTYPE_SETEXPERIENCE = 0x0012 (User.cpp:1115, DPClient.cpp:3310)
**Self-only** (per-user m_Snapshot, NOT vicinity).
```
[objid player][0x0012]
nExp1:        __int64 (8B)  current exp
wLevel:       WORD           main level
nSkillLevel:  DWORD (int)    job/skill level
nSkillPoint:  DWORD (int)    skill points
nDeathExp:    __int64 (8B)   death-penalty exp
wDeathLevel:  WORD           death level
```

### SETLEVEL — SNAPSHOTTYPE_SETLEVEL = 0x0011 (User.cpp:4655, DPClient.cpp:3273)
Vicinity broadcast, **skips self** (self gets level via SETEXPERIENCE). Client plays level-up SFX + refills HP/MP.
```
[objid mover][0x0011]
wLevel: WORD
```

### CREATEITEM (inventory add, NOT ground drop) — SNAPSHOTTYPE_CREATEITEM = 0x0003
Self-only. Ground drops use standard ADD_OBJ of a CItem (CCtrl serialize + CItemElem serialize). Gold drop = ADD_OBJ of II_GOLD_SEED CItem (CMover::DropGold, MoverEquip.cpp:2419).

### MELEE_ATTACK — SNAPSHOTTYPE_MELEE_ATTACK = 0x00e0 (already implemented; motion-only, no damage here)

### HP sync model
No dedicated HP packet. Monster red bar updates purely via DAMAGE snapshots (all nearby clients decrement identically). Initial HP from ADD_OBJ spawn blob. Player self-HP: DAMAGE where victim==self, or sit-regen etc via AddDamage with attacker=self.

---

## D. Death / Exp / Drops

### Death — `DoDie` (Mover.cpp:5131), called from `CAttackArbiter::OnDied` (AttackArbiter.cpp:764)
OnDied order: SubPVP → AddKillRecovery → **NPC fast-path** (`if NPC && IsDie: Delete(); return` — monster just removed, NO DoDie) → boss SubAroundExp(50u) OR SubExperience(defender) → DropItemByDied(attacker) → DoDie → ClearDestObj.
- `g_UserMng.AddMoverDeath(this, attacker, dwMsg)` is the ONLY death broadcast (vicinity, SNAPSHOTTYPE_MOVERDEATH=0x00c7). Body: `idMover | 0x00c7 | idAttacker:DWORD | dwMsg:DWORD`.
- DoDie does NOT set m_nDead (that's the player-revive counter only). NPC combat death = mark Delete() + sweep on tick.
- Quest kill-counter: for each attacker quest, if `m_nEndCondKillNPCIdx[j] == GetIndex()` increment `m_nKillNPCNum[j]` (party-aware within 64u).
- Respawn: `CRespawner::Spawn` per world-tick (Respawn.cpp:373); live spawn decrements free-slot counter. Respawn info carries per-spawn-type.

### Death exp penalty (player death) — `SubDieDecExp` (Mover.cpp:7157)
NPC returns 0. Player: `GetDieDecExp(level, &fRate, &fDecExp, &bPxpClear, &bLvDown)` from DiePenalty.inc vectors; skip penalty if m_bLastPK/guildCombat/duelParty. Captures `m_nDeathExp=m_nExp1; m_nDeathLevel=m_nLevel`. DiePenalty.inc (loaded Project.cpp:4880):
- REVIVAL_PENALTY (HP fraction on revive): L1=0.80, L2=0.60, L3-5=0.50, L6-10=0.40, L11-200=0.30
- DECEXP_PENALTY (exp loss): L1-20=0%, L21-29=6%, L30-59=5%, L60-89=4%, L90-99=3%, L100-109=2%, L110-129=1.5%, L130-200=1%
- LEVEL_DOWN: L1-20=0, L21-200=1 (can lvl down). Floor L1.

### Exp gain (monster kill) — `SubExperience` (Mover.cpp:5992) → `AddExperienceKillMember` (6085)
- Base: `fExp = propMover.nExpValue * m_fExp_Rate` (propMover col 58 = dwExpValue; rate from propMoverEx.inc Transform block, default 1.0).
- Builds hit-share from `m_idEnemies {OBJID→HIT_INFO{nHit,dwTick}}`; `dwMaxEnemyHit = ΣnHit`. Per-person: `fExpPerson = fExp * (anHitPoint[j]/dwMaxEnemyHit)`. Party grouping (members within 64u of corpse) → AddExperienceParty else AddExperienceSolo.
- **AddExperienceSolo level-diff mult** (playerLevel − monsterLevel): ≤0=1.0, 1-2=0.7, 3-4=0.4, ≥5=0.1.
- Hard cap per source: `min(fExp, expTable[level].nLimitExp)`.
- **AddExperience** (MoverParam.cpp:1054): job-stage cap; `m_nExp1 += nExp`; if `m_nExp1 >= expTable[nextLevel].nExp1` → level up (recurse on overflow).
- Level up: `m_nRemainGP += expTable[nextLevel].dwLPPoint`; stat points = `((level-1)/20)+2`; HP/MP/FP refilled to max (derived, not rolled); auto-flight at L20.
- Level-up broadcast: `AddSetLevel` (vicinity, skips self) + `AddSetExperience` (self-only).

### Exp/level table — `Server/Resource/expTable.inc` (loaded Project.cpp:3251)
`prj.m_aExpCharacter[200]`, struct EXPCHARACTER { EXPINTEGER nExp1 (cumulative exp to reach LVL N); nExp2 (legacy PXP cap); DWORD dwLPPoint (skill points on leveling into N+1); EXPINTEGER nLimitExp (per-source cap) }. Row format: `EXP PXP GP LimEXP //level`, 1-based. **Single exp pool** (m_nExp1) — job is a stage predicate on the same level, not a second pool.

### Drops — `DropItemByDied` (Mover.cpp:7238) → `DropItem` (7260)
- Top-damage attacker = `GetMaxEnemyHitID()` (highest HIT_INFO.nHit); fallback to killing-blow attacker.
- Level-diff gate: `(atkLVL − monsterLVL) < 10` or no event drops.
- Drop probability/penya rate by level gap: d≤1:100/100, ≤2:80/100, ≤4:60/80, ≤7:30/65, else:10/50. Gate: `xRandom(100) < dropRate`.
- **Drop tables are in `propMoverEx.inc`, NOT propMover columns.** Per-monster `MI_*` blocks: `Maxitem=N; DropItem(II_xxx,prob,upgrade,count); DropKind(IK3_xxx,minUniq,maxUniq); DropGold(min,max); QuestItem(...)`. Parsed Project.cpp:2791-2866. Probability DWORD vs `xRandom(3000000000)` (3e9 scale; 3e8≈10%, 3e9≈100%).
- DROPTYPE_SEED (gold): `gold = [dwNumber,dwNumber2] * penyaRate/100 * goldDropRate * penya_Rate`; spawns II_GOLD_SEED1-4 CItem by amount tier (or auto-loot if flying).
- World spawn = `GetWorld()->ADDOBJ(pItem)` — standard ADD_OBJ vicinity snapshot (CItem::Serialize = CCtrl serialize + CItemElem serialize). NO dedicated drop packet.
- Loot ownership: `pItem->m_idOwn = attacker.GetId()` (unless RANK_SUPER / event bosses = free-for-all). Pickup gate (MoverActEvent.cpp:2202): owner, same-party, or after `SEC(7)` timeout anyone.
- propMover col 57 = dwCorrectionValue (drop-kind prob multiplier); col 15 = dwClass (RANK_LOW/NORMAL/CAPTAIN/BOSS/SUPER); col 46 = dwFlying.

### Resources-converter work needed
`@flyff/resources` must parse `propMoverEx.inc` MVI_MONSTER blocks → per-monster drop lists (DropItem/DropKind/DropGold/QuestItem). Also load `expTable.inc` (200 rows) + `propJob.inc` (32 rows) + `DiePenalty.inc`. Current item schema is lossy (single `attack` field) — needs raw `dwAbilityMin/Max`, `fAttackSpeed`, `dwWeaponType`, element per weapon; armor needs `dwAbilityMin/Max` (recovery).

---

## E. Implementation sequencing (architect input)

Pre-reqs (resources pkg): parse propJob.inc (32 job rows), expTable.inc (200 rows), propMoverEx.inc (drops); extend item.schema with raw weapon/armor columns; extend mover schema with dwHR/dwER/dwAtkMin/dwAtkMax/dwNaturalArmor/dwResisMgic/eElementType/dwReAttackDelay (some already present as attack/defense/attack_rate/dodge_rate — verify mapping).

Entity: CPlayer needs equipped-weapon state (load from inventory on JOIN, or stub fist); CMover needs per-instance m_idEnemies hit-share map + death state. Both need derived-stat cache (ATK/DEF/HR/ER/crit/block/atkSpeed) recomputed on equip/level change.

Systems to build (systems/):
1. `stats.system.ts` (or pure `stats.ts` util) — derive ATK min/max, DEF, HR, Parrying, critProb, blockFactor, atkSpeed, maxHP/MP/FP from base+job+equip (player) or propMover cols (NPC). Port tables: job (propJob.inc), atkSpeedPlus[18].
2. `combat.system.ts` — AttackArbiter port: CalcATK → PostCalcGeneric (melee path) → CalcDefense → GetBlockFactor → GetDamageMultiplier. AF_* flag negotiation, hit/miss via GetAttackResult, crit (2.3x/2.6x), element factor. Produces {damage, atkFlags, killer}.
3. `death.system.ts` — OnDied: exp (SubExperience → AddExperienceSolo, hit-share, level-diff mult, LimitExp cap, level up), drop roll (DropItemByDied → propMoverEx generators), DoDie broadcast (MOVERDEATH), remove mover, schedule respawn.
4. Tick integration: process queued melee hits (C++ does it on tick; we can do inline or queue). AI aggro/death-state on CMover.

Serializers: DAMAGE (0x0013, vicinity, AF_FLYING conditional), MOVERDEATH (0x00c7, vicinity), SETEXPERIENCE (0x0012, self-only, __int64 exp + WORD lvl + DWORD skillLv + DWORD skillPt + __int64 deathExp + WORD deathLvl), SETLEVEL (0x0011, vicinity skips-self). Gold/item drops = ADD_OBJ (reuse item serializer).

Handler rewrite: MELEE_ATTACK handler now resolves target via spawnManager, runs combat.system, applies damage (MinusHP), sends DAMAGE to vicinity, on death runs death.system. WAL-journal exp/gold/item mutations (rule 04 — exp + level + gold + items all journaled).
