/**
 * Character select (PRE_JOIN) service.
 *
 * The C++ `PACKETTYPE_SEL_PLAYER` (0xf7) is dead code in `game/source/`; the
 * real "select char and enter world" packet is `PACKETTYPE_PRE_JOIN (0xff05)`.
 * On a valid select, the cluster issues a single-use world handoff token and
 * publishes `player:handoff` over IPC so the world server accepts the
 * incoming connection (rule 07 -- HMAC-signed at the bus layer).
 *
 * @module services/charSelect.service
 */

import type { AccountRepository, CharacterRepository } from '@flyff/database';

/** Publishes a signed player:handoff envelope to the world server. */
export interface HandoffPublisher {
  publish(charId: number, token: string, worldId: string): Promise<void>;
}

/** Issues single-use cluster->world handoff tokens. */
export interface WorldTokenService {
  generateWorldHandoffToken(charId: number): Promise<string>;
}

export interface CharSelectDeps {
  accountRepo: AccountRepository;
  charRepo: CharacterRepository;
  tokenService: WorldTokenService;
  handoffPublisher: HandoffPublisher;
}

export type PreJoinOutcome =
  | { ok: true; charId: number; token: string }
  | { ok: false };

export class CharSelectService {
  constructor(private deps: CharSelectDeps) {}

  /**
   * Validate a PRE_JOIN (select char to enter world) request and, on success,
   * issue a world handoff token + publish the IPC handoff.
   *
   * @param account - Account name.
   * @param idPlayer - Character id claimed by the client.
   * @param name - Character name claimed by the client (must match DB).
   */
  async prejoin(account: string, idPlayer: number, name: string): Promise<PreJoinOutcome> {
    const acct = await this.deps.accountRepo.findByUsername(account);
    if (!acct) return { ok: false };

    const character = await this.deps.charRepo.findById(idPlayer);
    if (!character || character.account_id !== acct.id || character.name !== name) {
      return { ok: false };
    }

    const token = await this.deps.tokenService.generateWorldHandoffToken(idPlayer);
    // Target world = the world the character actually lives in (DB row), not the
    // cluster's own server id. World server validates row.world_id === handoff.worldId.
    await this.deps.handoffPublisher.publish(idPlayer, token, character.world_id);
    return { ok: true, charId: idPlayer, token };
  }
}
