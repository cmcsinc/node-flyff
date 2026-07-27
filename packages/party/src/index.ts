/**
 * @flyff/party -- solo-party domain. In-memory registry (PartyManager),
 * invite/accept/decline/leave/kick/leader-change/chat state machine
 * (PartyService), shared EXP split (PartyService.distributeExp), and the C->S
 * opcode handler (PartyHandler). Party serializers live in `@flyff/world-core`
 * (consumed by both party + world-server). Loot share is a seam on
 * `@flyff/inventory` (sameParty closure); exp share is a seam on
 * `@flyff/combat` (partyExp closure).
 *
 * Depends on `@flyff/{core,entities,world-core,database}`. The shared
 * `grantExpAmount` applier is injected as a structural closure (compose wires
 * it to `CombatService.grantExpAmount`) so this package never imports
 * `@flyff/combat` directly -- both combat and inventory stay free of any
 * `@flyff/party` import.
 *
 * @module @flyff/party
 */

export {
  PartyManager,
  PARTY_INVITE_TIMEOUT_MS, MAX_PARTY_MEMBERS,
  PARTY_EXP_MODE_LEVEL, PARTY_ITEM_MODE_FFA, PARTY_ITEM_MODE_ROUND_ROBIN,
} from './managers/party.manager';
export type { Party, PendingPartyInvite } from './managers/party.manager';
export { PartyService } from './services/party.service';
export type { PartyServiceDeps } from './services/party.service';
export { PartyHandler } from './handlers/party.handler';
export type { PartyHandlerDeps } from './handlers/party.handler';
