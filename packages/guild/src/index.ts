/**
 * @flyff/guild -- guild domain. Live registry + rejoin cooldown
 * ({@link GuildManager}), the roster / rank / authority state machine
 * ({@link GuildService}), and the C->S opcode handler ({@link GuildHandler}).
 * Guild serializers live in `@flyff/world-core` (shared with world-server's
 * mover serializer, which writes the ADD_OBJ guild block).
 *
 * Real Flyff splits guild across CoreServer (authority) and world-server
 * (relay); this single-process emulator collapses both into GuildService.
 *
 * Depends on `@flyff/{core,entities,world-core,database}`. Guild chat has no
 * C->S opcode of its own -- the chat command router calls
 * `GuildService.chat` for `/g`.
 *
 * @module @flyff/guild
 */

export { GuildManager } from './managers/guild.manager';
export type {
  Guild, GuildMemberState, PendingGuildInvite, GuildPersistence,
} from './managers/guild.manager';
export { GuildWarManager } from './managers/guildWar.manager';
export type { War, GuildWarPersistence } from './managers/guildWar.manager';
export { GuildWarService, WAR_PROPOSAL_TIMEOUT_MS } from './services/guildWar.service';
export type {
  GuildWarServiceDeps, WarProposal, TruceRequest,
} from './services/guildWar.service';
export {
  GUILD_TABLE, MAX_GUILD_LEVEL, guildMaxMembers, guildMaxRankMembers,
  GUILD_REJOIN_COOLDOWN_MS,
  GUILD_INVITE_TIMEOUT_MS, GUILD_NICKNAME_MIN_LEVEL,
  GUILD_NICKNAME_MIN_LEN, GUILD_NICKNAME_MAX_LEN,
  GUILD_CLASS_MIN, GUILD_CLASS_MAX,
  CONTRIBUTION_OK, CONTRIBUTION_FAIL_MAXLEVEL,
  CONTRIBUTION_FAIL_GUILD_OVERFLOW_PXP, CONTRIBUTION_FAIL_GUILD_OVERFLOW_PENYA,
  CONTRIBUTION_FAIL_INVALID_CONDITION,
  CONTRIBUTION_FAIL_OVERFLOW_PXP, CONTRIBUTION_FAIL_OVERFLOW_PENYA,
  MAX_DWORD, MAX_INT32, gemContributionPxp,
} from './guildTable';
export type { ContributionResult } from './guildTable';
export { GuildService } from './services/guild.service';
export type { GuildServiceDeps } from './services/guild.service';
export {
  GuildContributionService, IK3_GEM, SALARY_PAY_HOUR, SALARY_RESET_HOUR,
} from './services/guildContribution.service';
export type {
  GuildContributionServiceDeps, GuildInventoryPort, GemStack,
} from './services/guildContribution.service';
export {
  GuildBankService, WITHDRAW_MODE_PENYA, WITHDRAW_MODE_ITEM,
} from './services/guildBank.service';
export type {
  GuildBankServiceDeps, GuildBankPersistence, GuildBankInventoryPort,
  GuildBankSlot,
} from './services/guildBank.service';
export { GuildHandler } from './handlers/guild.handler';
export type { GuildHandlerDeps } from './handlers/guild.handler';
