---
name: flyff-game-systems
description: >
  Game systems implementation for the Flyff Node.js emulator: combat formulas, stat
  calculations, experience/leveling, skill system, drop system, spawn/respawn management,
  NPC AI state machines, buff/debuff system, party system, trade system, and shop system.
  Use this skill whenever implementing actual Flyff gameplay mechanics, translating C++
  combat or stat formulas to JavaScript, building the monster AI, implementing skills,
  or calculating any game value (damage, hit rate, exp, drop chance). Trigger on:
  "combat", "damage formula", "hit rate", "stat calculation", "experience", "level up",
  "skill", "buff", "drop", "spawn", "respawn", "AI", "aggro", "party", "trade",
  "shop", "NPC", "monster", "attack speed", "critical hit", "defense", "DEF", "ATK".
---

# Flyff Emulator — Game Systems

## Stat Calculation

Flyff stats depend on base stats (STR/STA/DEX/INT), equipment bonuses, and buffs.

```js
// systems/statCalc.js

/** Job attack multipliers (index = job id) */
const JOB_ATK_FACTOR = [1.0, 1.2, 1.4, 1.0, 1.1, 1.3, 1.5, 1.2];

export function computeStats(player) {
  const { m_nStr: str, m_nSta: sta, m_nDex: dex, m_nInt: int_, m_nLevel: lv } = player;
  const job = player.m_nJob;

  // Base HP formula (matches v15 source)
  const maxHp = Math.floor((sta * 4.5 + lv * 1.8) * getHpFactor(job));

  // Base MP
  const maxMp = Math.floor((int_ * 2.0 + lv * 0.8) * getMpFactor(job));

  // Physical attack (melee/ranged jobs)
  const minAtk = Math.floor(str * 1.0 + lv * 0.5 * JOB_ATK_FACTOR[job]);
  const maxAtk = Math.floor(str * 1.5 + lv * 0.8 * JOB_ATK_FACTOR[job]);

  // Magic attack (mage jobs)
  const minMAtk = Math.floor(int_ * 1.2 + lv * 0.5);
  const maxMAtk = Math.floor(int_ * 1.8 + lv * 0.8);

  // Defense
  const def    = Math.floor(sta * 0.5 + lv * 0.3);

  // Hit rate
  const hitRate = Math.floor(dex * 0.8 + lv * 0.5);

  // Evasion
  const evasion = Math.floor(dex * 0.3 + lv * 0.2);

  // Apply equipment bonuses
  const equip = getEquipmentStats(player);

  return {
    maxHp,  maxMp,
    minAtk: minAtk + equip.atkMin,
    maxAtk: maxAtk + equip.atkMax,
    minMAtk, maxMAtk,
    def:    def    + equip.def,
    hitRate, evasion,
    critRate:  dex * 0.1 + equip.crit,
    critBonus: 1.2 + equip.critBonus * 0.01,
    atkSpeed:  1000 - Math.floor(dex * 0.5), // ms between attacks
  };
}

function getHpFactor(job) {
  const factors = [1.0, 1.2, 1.5, 0.9, 1.0, 1.1, 0.8, 1.2];
  return factors[job] ?? 1.0;
}
```

---

## Combat System

```js
// systems/combat.system.js

/**
 * Resolve a single melee attack.
 * @param {CMover} attacker
 * @param {CMover} target
 * @returns {{ hit: boolean, damage: number, critical: boolean }}
 */
export function resolveMeleeAttack(attacker, target) {
  const atkStats = attacker._cachedStats;
  const defStats = target._cachedStats;

  // Hit check
  const hitRoll  = Math.random() * 100;
  const hitChance = clamp(atkStats.hitRate - defStats.evasion, 20, 95);
  if (hitRoll > hitChance) return { hit: false, damage: 0, critical: false };

  // Damage roll
  const rawDmg = randBetween(atkStats.minAtk, atkStats.maxAtk);

  // Defense reduction (additive model matching v15)
  const reduced = Math.max(1, rawDmg - defStats.def);

  // Critical hit
  const isCrit = Math.random() * 100 < atkStats.critRate;
  const damage = Math.floor(isCrit ? reduced * atkStats.critBonus : reduced);

  // Apply to target
  target.m_nHP = Math.max(0, target.m_nHP - damage);

  return { hit: true, damage, critical: isCrit };
}

export function resolveMagicAttack(attacker, target, skillProp) {
  const atkStats = attacker._cachedStats;
  const rawDmg   = randBetween(atkStats.minMAtk, atkStats.maxMAtk) * (skillProp.fDmgMul ?? 1.0);
  const reduced  = Math.max(1, rawDmg - target._cachedStats.mDef);
  const damage   = Math.floor(reduced);
  target.m_nHP   = Math.max(0, target.m_nHP - damage);
  return { hit: true, damage, critical: false };
}

// Helpers
const clamp        = (v, min, max) => Math.min(max, Math.max(min, v));
const randBetween  = (a, b) => a + Math.random() * (b - a) | 0;
```

---

## Experience & Level System

```js
// systems/exp.system.js

/** Pre-computed exp table. Index = level (1-120). */
const EXP_TABLE = buildExpTable();

function buildExpTable() {
  const t = [0, 0]; // level 0 and 1 need 0 exp
  for (let lv = 2; lv <= 120; lv++) {
    // Matches Flyff v15 formula
    t[lv] = Math.floor(Math.pow(lv, 3) * 18 + lv * 200);
  }
  return t;
}

import { appendJournal } from '../journal.js';

export function getExpRequired(level) {
  return EXP_TABLE[level] ?? Infinity;
}

export function addExp(player, amount) {
  if (player.m_nLevel >= 120) return false; // max level

  player.m_nExp += amount;
  player._dirty.add('exp');

  while (player.m_nExp >= getExpRequired(player.m_nLevel + 1)
         && player.m_nLevel < 120) {
    player.m_nExp -= getExpRequired(player.m_nLevel + 1);
    levelUp(player);
  }
}

function levelUp(player) {
  player.m_nLevel++;
  player.m_nStatPoints  += 2;
  player.m_nSkillPoints += 1;

  // Fully restore HP/MP on level up
  const stats = computeStats(player);
  player.m_nHP = stats.maxHp;
  player.m_nMP = stats.maxMp;
  player._cachedStats = stats;

  player._dirty.add('level');

  // Critical persistence: journal level ups to prevent rollback
  appendJournal(player.m_dwCharId, 'LEVEL_UP', {
    level: player.m_nLevel,
    exp: player.m_nExp,
    statPoints: player.m_nStatPoints,
    skillPoints: player.m_nSkillPoints
  });

  bus.emit(EV.PLAYER_LEVEL_UP, { player });
}
```

---

## Drop System

```js
// systems/drop.system.js
import { propItem } from '@flyff/resources';

/**
 * Rolls drops from a killed monster.
 * @param {CCtrl} monster
 * @param {CPlayer} killer
 * @returns {DroppedItem[]}
 */
export function rollDrops(monster, killer) {
  const prop    = propMover.get(monster.m_dwMoverID);
  if (!prop) return [];

  const drops = [];

  // Gold drop
  if (prop.dwGoldHigh > 0) {
    const gold = randBetween(prop.dwGoldLow, prop.dwGoldHigh);
    drops.push({ type: 'gold', amount: gold });
  }

  // Item drops from drop table
  const dropTable = getDropTable(monster.m_dwMoverID);
  for (const entry of dropTable) {
    const roll = Math.random() * 1_000_000; // 6 decimal precision
    if (roll <= entry.chance) {
      const count = randBetween(entry.minCount, entry.maxCount);
      drops.push({ type: 'item', itemId: entry.itemId, count });
    }
  }

  return drops;
}
```

---

## Buff / Debuff System

```js
// systems/buff.system.js

export class BuffManager {
  /** @type {Map<number, Buff[]>} charId / moverObjId → active buffs */
  #buffs = new Map();

  add(entityId, skillId, level, durationMs, statMods) {
    const list = this.#buffs.get(entityId) ?? [];
    // Remove existing buff of same skill (refresh)
    const idx = list.findIndex(b => b.skillId === skillId);
    if (idx >= 0) { clearTimeout(list[idx].timer); list.splice(idx, 1); }

    const buff = {
      skillId,
      level,
      statMods,
      timer: setTimeout(() => this.remove(entityId, skillId), durationMs),
    };
    list.push(buff);
    this.#buffs.set(entityId, list);
    return buff;
  }

  remove(entityId, skillId) {
    const list = this.#buffs.get(entityId);
    if (!list) return;
    const idx = list.findIndex(b => b.skillId === skillId);
    if (idx >= 0) {
      clearTimeout(list[idx].timer);
      list.splice(idx, 1);
    }
    bus.emit(EV.BUFF_EXPIRED, { entityId, skillId });
  }

  getStatBonus(entityId) {
    const list = this.#buffs.get(entityId) ?? [];
    return list.reduce((acc, b) => {
      for (const [k, v] of Object.entries(b.statMods)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {});
  }
}

export const buffManager = new BuffManager();
```

---

## Spawn & Respawn System

```js
// systems/spawn.system.js

export class SpawnSystem {
  /** @type {SpawnEntry[]} */
  #spawns = [];

  loadZoneSpawns(zone, spawnData) {
    for (const sp of spawnData) {
      this.#spawns.push({
        zoneId:     zone.id,
        moverId:    sp.moverId,
        count:      sp.count,
        respawnMs:  sp.respawnMs,
        pos:        { x: sp.x, y: sp.y, z: sp.z },
        radius:     sp.radius,
        active:     [], // currently alive CCtrl instances
        queue:      [], // { at: timestamp } pending respawns
      });
    }
  }

  tick(dt) {
    const now = Date.now();
    for (const sp of this.#spawns) {
      // Check queue for due respawns
      while (sp.queue.length && sp.queue[0].at <= now) {
        sp.queue.shift();
        this.#spawnOne(sp);
      }
      // Ensure count is maintained
      while (sp.active.length < sp.count) {
        this.#spawnOne(sp);
      }
    }
  }

  onDeath(mover) {
    const sp = this.#spawns.find(s => s.active.includes(mover));
    if (!sp) return;
    sp.active.splice(sp.active.indexOf(mover), 1);
    sp.queue.push({ at: Date.now() + sp.respawnMs });
    zoneManager.getZone(sp.zoneId).removeObject(mover);
  }

  #spawnOne(sp) {
    const prop = propMover.get(sp.moverId);
    if (!prop) return;
    const mover = new CCtrl(prop);
    mover.m_vPos = randomPositionAround(sp.pos, sp.radius);
    zoneManager.getZone(sp.zoneId).addObject(mover);
    sp.active.push(mover);
  }
}
```

---

## NPC AI State Machine

```js
// systems/ai.system.js

export const AIState = Object.freeze({
  IDLE:    0,
  PATROL:  1,
  CHASE:   2,
  ATTACK:  3,
  RETURN:  4,  // return to spawn point
  DEAD:    5,
});

export class AIController {
  constructor(mover) {
    this.mover      = mover;
    this.state      = AIState.IDLE;
    this.target     = null;
    this.spawnPos   = { ...mover.m_vPos };
    this.timer      = 0;
    this.attackCd   = 0;
  }

  tick(dt) {
    if (this.mover.m_nHP <= 0) { this.state = AIState.DEAD; return; }
    this.timer    += dt;
    this.attackCd -= dt;

    switch (this.state) {
      case AIState.IDLE:   this.#tickIdle(dt);   break;
      case AIState.CHASE:  this.#tickChase(dt);  break;
      case AIState.ATTACK: this.#tickAttack(dt); break;
      case AIState.RETURN: this.#tickReturn(dt); break;
    }
  }

  #tickIdle(dt) {
    if (this.timer < 2000) return;
    this.timer = 0;
    // Scan for players in aggro range
    const prop = propMover.get(this.mover.m_dwMoverID);
    const range = prop?.nAggro ?? 100;
    this.target = zoneManager
      .getZone(this.mover.m_nZoneId)
      .findPlayerInRange(this.mover.m_vPos, range);
    if (this.target) this.state = AIState.CHASE;
  }

  #tickChase(dt) {
    if (!this.target || this.target.m_nHP <= 0) {
      this.target = null;
      this.state  = AIState.RETURN;
      return;
    }
    const dist = distance3d(this.mover.m_vPos, this.target.m_vPos);
    const leashDist = 1500;
    if (distance3d(this.mover.m_vPos, this.spawnPos) > leashDist) {
      this.target = null;
      this.state  = AIState.RETURN;
      return;
    }
    if (dist <= 80) {
      this.state = AIState.ATTACK;
    } else {
      moveToward(this.mover, this.target.m_vPos, dt);
      broadcastMoverMove(this.mover);
    }
  }

  #tickAttack(dt) {
    if (!this.target || distance3d(this.mover.m_vPos, this.target.m_vPos) > 120) {
      this.state = AIState.CHASE;
      return;
    }
    if (this.attackCd <= 0) {
      const result = resolveMeleeAttack(this.mover, this.target);
      broadcastAttackResult(this.mover, this.target, result);
      if (this.target.m_nHP <= 0) {
        bus.emit(EV.MONSTER_KILLED, { monster: this.mover, killer: this.target });
        this.target = null;
        this.state  = AIState.IDLE;
      }
      this.attackCd = this.mover._cachedStats.atkSpeed;
    }
  }

  #tickReturn(dt) {
    const dist = distance3d(this.mover.m_vPos, this.spawnPos);
    if (dist < 10) {
      this.mover.m_nHP = this.mover._cachedStats.maxHp; // heal on return
      this.state = AIState.IDLE;
    } else {
      moveToward(this.mover, this.spawnPos, dt);
    }
  }
}
```

---

## Party System

```js
// managers/party.manager.js

export class PartyManager {
  #parties = new Map(); // partyId → Party

  create(leader) {
    const party = {
      id:      nextId(),
      leader:  leader.m_dwCharId,
      members: [leader],
      expShare:'proportional', // 'equal' | 'proportional'
    };
    this.#parties.set(party.id, party);
    leader.m_nPartyId = party.id;
    return party;
  }

  invite(inviter, target) {
    // Target must not already be in a party
    if (target.m_nPartyId) throw new GameError('Already in party');
    const party = this.getByMember(inviter.m_dwCharId);
    if (!party) throw new GameError('Not in party');
    if (party.members.length >= 4) throw new GameError('Party full');
    // Send invite packet to target
    bus.emit(EV.PARTY_INVITE, { party, inviter, target });
  }

  distributeExp(party, baseExp) {
    if (party.members.length === 1) return;
    const totalLv = party.members.reduce((s, m) => s + m.m_nLevel, 0);
    for (const m of party.members) {
      const share = Math.floor(baseExp * (m.m_nLevel / totalLv));
      addExp(m, share);
    }
  }
}
```

---

## Useful Math Utilities

```js
// utils/math.js

export const distance3d = (a, b) =>
  Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);

export const distance2d = (a, b) =>
  Math.sqrt((a.x-b.x)**2 + (a.z-b.z)**2); // ignore Y (height)

export function moveToward(mover, target, dt) {
  const speed = mover._cachedStats?.moveSpeed ?? 50; // units/s
  const dx = target.x - mover.m_vPos.x;
  const dz = target.z - mover.m_vPos.z;
  const dist = Math.sqrt(dx*dx + dz*dz);
  if (dist <= 0) return;
  const step = (speed * dt) / 1000;
  mover.m_vPos.x += (dx / dist) * Math.min(step, dist);
  mover.m_vPos.z += (dz / dist) * Math.min(step, dist);
  mover.m_fAngle  = Math.atan2(dx, dz) * (180 / Math.PI);
}

export function randomPositionAround(center, radius) {
  const angle = Math.random() * Math.PI * 2;
  const r     = Math.random() * radius;
  return {
    x: center.x + Math.cos(angle) * r,
    y: center.y,
    z: center.z + Math.sin(angle) * r,
  };
}
```
