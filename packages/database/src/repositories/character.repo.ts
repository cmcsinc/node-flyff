import type { Knex } from '../types';

/**
 * Database row interface for characters table.
 */
export interface CharacterRow {
  id: number;
  account_id: number;
  name: string;
  slot: number;
  class: number;
  gender: number;
  hair_style: number;
  hair_color: number;
  face_style: number;
  skin_color: number;
  level: number;
  exp: bigint;
  hp: number;
  mp: number;
  max_hp: number;
  max_mp: number;
  strength: number;
  stamina: number;
  dexterity: number;
  intelligence: number;
  /**
   * Unspent stat points (C++ `m_nRemainGP`, "growth points"). Added by
   * migration 010. Granted on level-up from `EXPCHARACTER.dwLPPoint`, spent
   * 1:1 into STR/STA/DEX/INT via `PACKETTYPE_MODIFY_STATUS`.
   */
  remain_gp: number;
  x: number;
  y: number;
  z: number;
  /**
   * Facing angle (C++ `m_fAngle`, y-axis rotation). Added by migration 007.
   * Optional in the type so test fakes/legacy rows omit it safely; CPlayer
   * falls back to 0. Always present on real DB rows (column default 0).
   */
  angle?: number;
  world_id: string;
  zone_id: number;
  /**
   * Unspent skill points (C++ `m_nSkillPoint`). Added by migration 005.
   * Earned on level-up, spent by `DOUSESKILLPOINT`.
   */
  skill_point: number;
  /**
   * Total skill points earned (C++ `m_nSkillLevel`). Added by migration 005.
   * Lifetime counter -- never decremented.
   */
  skill_level: number;
  /**
   * Taskbar hotkey grid (C++ `m_aSlotItem`), JSON of non-empty slots. Added by
   * migration 009. Nullable: a fresh character has no bindings (null -> empty
   * grid on JOIN). See `taskbar.service.encodeTaskBar` for the shape.
   */
  taskbar?: string | null;
  /**
   * Active timed buffs (C++ `SkillInfluence`), JSON of `{ type, skillId,
   * level, totalMs }` entries. Added by migration 014. Nullable: a fresh
   * character has no active buffs (null -> none restored on JOIN). `totalMs`
   * is the originally-applied TOTAL duration -- the timer resets to full on
   * relog (matches C++ `SaveSkillInfluence` / `GetSKillInfluence`).
   */
  buffs?: string | null;
  /**
   * PK propensity / chaotic state (C++ `m_dwPKPropensity`). > 0 = chaotic.
   * Added by migration 013.
   */
  pk_propensity: number;
  /**
   * PK value / slaughter count (C++ `m_nSlaughter`). Incremented on player-kill.
   * Added by migration 013.
   */
  pk_value: number;
  /**
   * Wall-clock ms of last PK action (C++ `m_dwPKTime`). Drives PK decay.
   * Added by migration 013.
   */
  pk_time: number;
  /**
   * PK experience (C++ `m_dwPKExp`). Counter-decay accumulator.
   * Added by migration 013.
   */
  pk_exp: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Character creation data (excludes auto-generated fields).
 * `skill_point`/`skill_level` default to 0 at the DB layer (migration 005),
 * so callers omit them for a fresh character.
 */
export type CharacterCreateData = Omit<
  CharacterRow,
  'id' | 'created_at' | 'updated_at' | 'skill_point' | 'skill_level' | 'remain_gp'
> & { skill_point?: number; skill_level?: number; remain_gp?: number };

/**
 * Character update data (all fields optional).
 */
export type CharacterUpdateData = Partial<Omit<
  CharacterRow,
  'id' | 'account_id' | 'created_at'
>>;

/**
 * Repository for character-related database operations.
 *
 * All methods use Knex query builder (no raw SQL).
 * Methods return typed promises or null if not found.
 */
export class CharacterRepository {
  constructor(private db: Knex) {}

  /**
   * Coerces raw DB row to match CharacterRow typing.
   * `exp` is a bigInteger column -- better-sqlite3 may return it as Number;
   * normalize to string so comparisons are stable across drivers.
   */
  private mapRow(row: CharacterRow | undefined): CharacterRow | null {
    if (!row) return null;
    return { ...row, exp: String(row.exp) as unknown as bigint };
  }

  private mapRows(rows: CharacterRow[]): CharacterRow[] {
    return rows.map((r) => ({ ...r, exp: String(r.exp) as unknown as bigint }));
  }

  /**
   * Find character by ID.
   *
   * @param id - Character ID
   * @returns Character row or null if not found
   */
  async findById(id: number): Promise<CharacterRow | null> {
    const rows = await this.db('characters')
      .where({ id })
      .limit(1);

    return this.mapRow(rows[0]);
  }

  /**
   * Find all characters for an account.
   *
   * @param accountId - Account ID
   * @returns Array of character rows
   */
  async findByAccountId(accountId: number): Promise<CharacterRow[]> {
    const rows = await this.db('characters')
      .where({ account_id: accountId })
      .orderBy('slot', 'asc');
    return this.mapRows(rows);
  }

  /**
   * Find character by account and slot.
   *
   * Used for character select screen.
   *
   * @param accountId - Account ID
   * @param slot - Slot number (0-2 typically)
   * @returns Character row or null if not found
   */
  async findByAccountAndSlot(
    accountId: number,
    slot: number
  ): Promise<CharacterRow | null> {
    const rows = await this.db('characters')
      .where({ account_id: accountId, slot })
      .limit(1);

    return this.mapRow(rows[0]);
  }

  /**
   * Find character by name.
   *
   * @param name - Character name
   * @returns Character row or null if not found
   */
  async findByName(name: string): Promise<CharacterRow | null> {
    const rows = await this.db('characters')
      .where({ name })
      .limit(1);

    return this.mapRow(rows[0]);
  }

  /**
   * Create a new character.
   *
   * @param data - Character data (excluding id, timestamps)
   * @returns New character ID
   */
  async create(data: CharacterCreateData): Promise<number> {
    const [row] = await this.db('characters')
      .insert({
        ...data,
        exp: data.exp.toString(),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id');

    return row.id;
  }

  /**
   * Update character fields.
   *
   * @param id - Character ID
   * @param data - Fields to update
   */
  async update(id: number, data: CharacterUpdateData): Promise<void> {
    await this.db('characters')
      .where({ id })
      .update({
        ...data,
        updated_at: new Date(),
      });
  }

  /**
   * Update character position.
   *
   * @param id - Character ID
   * @param x - X coordinate
   * @param y - Y coordinate (vertical)
   * @param z - Z coordinate
   */
  async updatePosition(
    id: number,
    x: number,
    y: number,
    z: number
  ): Promise<void> {
    await this.db('characters')
      .where({ id })
      .update({
        x,
        y,
        z,
        updated_at: new Date(),
      });
  }

  /**
   * Update character level and experience.
   *
   * @param id - Character ID
   * @param level - New level
   * @param exp - New experience points
   */
  async updateLevelAndExp(
    id: number,
    level: number,
    exp: bigint
  ): Promise<void> {
    await this.db('characters')
      .where({ id })
      .update({
        level,
        exp: exp.toString(),
        updated_at: new Date(),
      });
  }

  /**
   * Update character stats (HP, MP, attributes, unspent stat points).
   *
   * @param id - Character ID
   * @param stats - Stats to update
   */
  async updateStats(
    id: number,
    stats: Partial<{
      hp: number;
      mp: number;
      max_hp: number;
      max_mp: number;
      strength: number;
      stamina: number;
      dexterity: number;
      intelligence: number;
      remain_gp: number;
    }>
  ): Promise<void> {
    await this.db('characters')
      .where({ id })
      .update({
        ...stats,
        updated_at: new Date(),
      });
  }

  /**
   * Update character skill points (C++ `m_nSkillPoint`/`m_nSkillLevel`).
   * Fire-and-forget at call sites -- WAL `CHAR_SKILL_POINT` is the crash-recovery
   * backup (event type to be wired when skill learning ships).
   *
   * @param id - Character ID
   * @param skillPoint - New unspent SP (C++ `m_nSkillPoint`)
   * @param skillLevel - New total SP earned (C++ `m_nSkillLevel`)
   */
  async updateSkillPoints(
    id: number,
    skillPoint: number,
    skillLevel: number,
  ): Promise<void> {
    await this.db('characters')
      .where({ id })
      .update({
        skill_point: skillPoint,
        skill_level: skillLevel,
        updated_at: new Date(),
      });
  }

  /**
   * Update character PK state (C++ `m_dwPKPropensity`/`m_nSlaughter`/
   * `m_dwPKTime`/`m_dwPKExp`). Fire-and-forget at call sites -- WAL `PK_KILL`
   * is the crash-recovery backup for the propensity/value/time write.
   *
   * @param id - Character ID
   * @param pkPropensity - New PK propensity (IsChaotic when > 0)
   * @param pkValue - New PK value / slaughter count
   * @param pkTime - New wall-clock ms of last PK action (decay base)
   * @param pkExp - Optional new PK exp (defaults to unchanged)
   */
  async updatePKState(
    id: number,
    pkPropensity: number,
    pkValue: number,
    pkTime: number,
    pkExp?: number,
  ): Promise<void> {
    const update: Record<string, number | Date> = {
      pk_propensity: pkPropensity,
      pk_value: pkValue,
      pk_time: pkTime,
      updated_at: new Date(),
    };
    if (pkExp !== undefined) update['pk_exp'] = pkExp;
    await this.db('characters')
      .where({ id })
      .update(update);
  }

  /**
   * Delete a character.
   *
   * This will cascade to delete inventory, skills, etc.
   *
   * @param id - Character ID
   */
  async delete(id: number): Promise<void> {
    await this.db('characters')
      .where({ id })
      .del();
  }

  /**
   * Count characters for an account.
   *
   * Used to check max slots limit.
   *
   * @param accountId - Account ID
   * @returns Number of characters
   */
  async countByAccountId(accountId: number): Promise<number> {
    const result = await this.db('characters')
      .where({ account_id: accountId })
      .count('id as count')
      .first();

    return (result?.count as number) || 0;
  }

  /**
   * Check if character name exists.
   *
   * @param name - Character name to check
   * @returns True if name exists
   */
  async nameExists(name: string): Promise<boolean> {
    const result = await this.db('characters')
      .where({ name })
      .count('id as count')
      .first();

    return (result?.count as number) > 0;
  }

  /**
   * Check if slot is occupied for an account.
   *
   * @param accountId - Account ID
   * @param slot - Slot number
   * @returns True if slot is occupied
   */
  async slotOccupied(accountId: number, slot: number): Promise<boolean> {
    const result = await this.db('characters')
      .where({ account_id: accountId, slot })
      .count('id as count')
      .first();

    return (result?.count as number) > 0;
  }

  /**
   * Find all characters in a world/zone.
   *
   * Used for world server zone management.
   *
   * @param worldId - World ID
   * @param zoneId - Zone ID
   * @returns Array of character rows
   */
  async findByWorldAndZone(
    worldId: string,
    zoneId: number
  ): Promise<CharacterRow[]> {
    const rows = await this.db('characters')
      .where({ world_id: worldId, zone_id: zoneId });
    return this.mapRows(rows);
  }
}
