/**
 * Character create/delete service — vertical-slice lifecycle mutations.
 *
 * Mirrors the C++ `CDbManager::CreatePlayer` / `RemovePlayer` guards
 * (`game/source/_Database/DbManager.cpp:133-394`) at the service layer:
 * name charset + length, slot range, duplicate name, duplicate slot, and
 * (for delete) account ownership. On success the C++ server re-sends a fresh
 * PLAYER_LIST; that reply is the handler's job, not this service's.
 *
 * Slice simplifications (documented):
 *  - Delete 2nd-factor "delete key" (`CHARACTER_STR 'D1'`) is omitted; account
 *    ownership is verified instead. Add when the DB procedure is ported.
 *  - Starting job/skills/starter items are DB-defaulted (level 1, job 0).
 *
 * @module services/charCreate.service
 */

import type { AccountRepository, CharacterRepository } from '@flyff/database';
import { Validate } from '@flyff/core/utils/validate.js';
import { PacketError } from '@flyff/core/errors.js';

// Error codes from `game/source/_Network/MsgHdr.h:1315-1326` (+ best-effort).
const ERR_DUPLICATE_SLOT = 105;
const ERR_SLOT_OUTOFRANGE = 106;
const ERR_INVALID_NAME_CHARACTER = 111;
const ERR_USER_EXISTS = 113; // referenced by client; not in MsgHdr.h — best-effort.

/** New-character defaults (sourced from `ClusterServerConfig.character`). */
export interface CharDefaults {
  maxPerAccount: number;
  startMap: string;
  startX: number;
  startY: number;
  startZ: number;
  startLevel: number;
}

/** Input parsed from a CREATE_PLAYER packet (account-relative fields). */
export interface CreateInput {
  account: string;
  slot: number;
  name: string;
  skinSet: number;
  hairMesh: number;
  hairColor: number;
  headMesh: number;
  sex: number;
  job: number;
}

export type CreateOutcome = { ok: true; charId: number } | { ok: false; errorCode: number };
export type DeleteOutcome = { ok: true } | { ok: false; errorCode: number };

export class CharCreateService {
  constructor(
    private accountRepo: AccountRepository,
    private charRepo: CharacterRepository,
    private defaults: CharDefaults,
  ) {}

  /**
   * Create a character. Validation order matches the C++ guards so the first
   * failing rule produces the correct client-visible error code.
   */
  async create(input: CreateInput): Promise<CreateOutcome> {
    // 1. Name charset + length.
    try {
      Validate.name(input.name, { minLength: 1, maxLength: 16 });
    } catch {
      return { ok: false, errorCode: ERR_INVALID_NAME_CHARACTER };
    }

    // 2. Account must exist (connection should have validated handoff already).
    const account = await this.accountRepo.findByUsername(input.account);
    if (!account) return { ok: false, errorCode: ERR_USER_EXISTS };

    // 3. Slot range.
    if (!Number.isInteger(input.slot) || input.slot < 0 || input.slot >= this.defaults.maxPerAccount) {
      return { ok: false, errorCode: ERR_SLOT_OUTOFRANGE };
    }

    // 4. Duplicate name.
    if (await this.charRepo.nameExists(input.name)) {
      return { ok: false, errorCode: ERR_USER_EXISTS };
    }

    // 5. Slot occupied for this account.
    if (await this.charRepo.slotOccupied(account.id, input.slot)) {
      return { ok: false, errorCode: ERR_DUPLICATE_SLOT };
    }

    const charId = await this.charRepo.create({
      account_id: account.id,
      name: input.name,
      slot: input.slot,
      class: input.job,
      gender: input.sex,
      hair_style: input.hairMesh,
      hair_color: input.hairColor,
      face_style: input.headMesh,
      skin_color: input.skinSet,
      level: this.defaults.startLevel,
      exp: BigInt(0),
      hp: 100,
      mp: 50,
      max_hp: 100,
      max_mp: 50,
      strength: 15,
      stamina: 15,
      dexterity: 15,
      intelligence: 15,
      x: this.defaults.startX,
      y: this.defaults.startY,
      z: this.defaults.startZ,
      world_id: this.defaults.startMap,
      zone_id: 1,
    });

    return { ok: true, charId };
  }

  /**
   * Delete a character owned by `accountName`. Verifies ownership before
   * deletion (anti-cheat: never trust the client's claimed idPlayer alone).
   */
  async delete(accountName: string, idPlayer: number): Promise<DeleteOutcome> {
    const account = await this.accountRepo.findByUsername(accountName);
    if (!account) return { ok: false, errorCode: ERR_USER_EXISTS };

    const character = await this.charRepo.findById(idPlayer);
    if (!character || character.account_id !== account.id) {
      return { ok: false, errorCode: ERR_USER_EXISTS };
    }

    await this.charRepo.delete(idPlayer);
    return { ok: true };
  }
}

// Re-export so handlers can throw PacketError without a second import.
export { PacketError };
