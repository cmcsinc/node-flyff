import type { Knex } from 'knex';

import type { AccountRow } from './repositories/account.repo';
import type { BankItemRow } from './repositories/bank.repo';
import type { BuffRow } from './repositories/buff.repo';
import type { CampusMemberRow, CampusRow } from './repositories/campus.repo';
import type { CharacterRow } from './repositories/character.repo';
import type { FriendRow } from './repositories/friend.repo';
import type { GuildMemberRow, GuildRow } from './repositories/guild.repo';
import type { GuildBankItemRow } from './repositories/guildBank.repo';
import type { GuildQuestRow } from './repositories/guildQuest.repo';
import type { GuildWarRow } from './repositories/guildWar.repo';
import type { InventoryItemRow } from './repositories/inventory.repo';
import type { MailRow } from './repositories/mail.repo';
import type { PartyMemberRow, PartyRow } from './repositories/party.repo';
import type { PresenceRow } from './repositories/presence.repo';
import type { CharacterQuestRow, CompletedQuestRow } from './repositories/quest.repo';
import type { SkillRow } from './repositories/skill.repo';

/** `inventory` container row (migration 008) -- gold only; items live in `inventory_item`. */
export interface InventoryContainerRow {
  character_id: number;
  gold: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * `bank` container row (migration 008) -- gold + pin; items live in `bank_item`.
 * `gold` is tab 0; `gold_tab1`/`gold_tab2` are the per-tab pools (migration 011).
 */
export interface BankContainerRow {
  account_id: number;
  gold: number;
  gold_tab1: number;
  gold_tab2: number;
  bank_pass: string;
  created_at: Date;
  updated_at: Date;
}

/** `guild_bank` container row (migration 024) -- last-mutation cursor only. */
export interface GuildBankRow {
  guild_id: number;
  updated_at_ms: number;
}

/** `guild_cooldown` row (migration 023) -- C++ `CPlayer::m_tGuildMember`. */
export interface GuildCooldownRow {
  character_id: number;
  until_ms: number;
}

/** `quest_log` row (migration 002) -- QUEST_LOG_ACTION audit trail. */
export interface QuestLogRow {
  id: number;
  character_id: number;
  quest_id: number;
  action: number;
  ts: Date;
}

/** `character_checked_quests` row (migration 002) -- MAX_CHECKED_QUEST slots 0-4. */
export interface CheckedQuestRow {
  id: number;
  character_id: number;
  quest_id: number;
  slot: number;
}

// ponytail: insert/update are `Partial<Row>` rather than distinct shapes, so
// knex won't flag a missing not-null column or an insert that sets `id`. The
// repositories' own `*CreateData` types carry that precision at the call site.
// Upgrade path: give each table an explicit insert shape once every repo has a
// `*CreateData`.
type Table<T> = Knex.CompositeTableType<T, Partial<T>, Partial<T>>;

// `characters.exp` is a bigInteger column: the row type is `bigint`, but every
// write passes `exp.toString()` (knex/driver-portable) and every read is
// normalized back through `String()`. So writes accept the wire form too.
type CharacterWrite = Omit<Partial<CharacterRow>, 'exp'> & { exp?: bigint | string | number };

declare module 'knex/types/tables' {
  interface Tables {
    accounts: Table<AccountRow>;
    bank: Table<BankContainerRow>;
    bank_item: Table<BankItemRow>;
    campus: Table<CampusRow>;
    campus_member: Table<CampusMemberRow>;
    character_buffs: Table<BuffRow>;
    character_checked_quests: Table<CheckedQuestRow>;
    character_completed_quests: Table<CompletedQuestRow>;
    character_quests: Table<CharacterQuestRow>;
    characters: Knex.CompositeTableType<CharacterRow, CharacterWrite, CharacterWrite>;
    friends: Table<FriendRow>;
    guild: Table<GuildRow>;
    guild_bank: Table<GuildBankRow>;
    guild_bank_item: Table<GuildBankItemRow>;
    guild_cooldown: Table<GuildCooldownRow>;
    guild_member: Table<GuildMemberRow>;
    guild_quest: Table<GuildQuestRow>;
    guild_war: Table<GuildWarRow>;
    inventory: Table<InventoryContainerRow>;
    inventory_item: Table<InventoryItemRow>;
    mail: Table<MailRow>;
    online_players: Table<PresenceRow>;
    parties: Table<PartyRow>;
    party_member: Table<PartyMemberRow>;
    quest_log: Table<QuestLogRow>;
    skills: Table<SkillRow>;
  }
}
