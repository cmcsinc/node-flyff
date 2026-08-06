// Database factory and migration runner
export { createDb, type DbConfig } from './db';
export {
  runMigrations,
  rollbackMigrations,
  getCurrentMigration,
} from './migrate';

// Repositories
export {
  AccountRepository,
  type AccountRow,
  type AccountCreateData,
  type AccountUpdateData,
} from './repositories/account.repo';

export {
  CharacterRepository,
  type CharacterRow,
  type CharacterCreateData,
  type CharacterUpdateData,
} from './repositories/character.repo';

export {
  InventoryRepository,
  type InventoryItemRow,
  type InventoryCreateData,
} from './repositories/inventory.repo';

export {
  BankRepository,
  type BankItemRow,
  type BankCreateData,
} from './repositories/bank.repo';

export {
  QuestRepository,
  type CharacterQuestRow,
  type CompletedQuestRow,
  type PlayerQuestState,
  type ActiveQuestPayload,
} from './repositories/quest.repo';

export {
  SkillRepository,
  type LearnedSkill,
  type SkillRow,
} from './repositories/skill.repo';

export {
  BuffRepository,
  type PersistedBuff,
  type PersistableBuff,
  type BuffRow,
} from './repositories/buff.repo';

export {
  PresenceRepository,
  type PresenceRow,
  type PresenceUpsertData,
} from './repositories/presence.repo';

export {
  MailRepository,
  type MailRow,
  type MailCreateData,
} from './repositories/mail.repo';

export {
  FriendRepository,
  MAX_FRIEND,
  type FriendRow,
} from './repositories/friend.repo';

export {
  CampusRepository,
  MAX_PUPIL_NUM,
  type CampusRow,
  type CampusMemberRow,
  type CampusWithMembers,
} from './repositories/campus.repo';

export {
  PartyRepository,
  type PartyRow,
  type PartyMemberRow,
  type PartyWithMembers,
  type PartyUpdateData,
} from './repositories/party.repo';

export {
  GuildRepository,
  type GuildRow,
  type GuildMemberRow,
  type GuildMember,
  type GuildWithMembers,
  type GuildUpdateData,
  type GuildMemberUpdateData,
} from './repositories/guild.repo';

export {
  GuildBankRepository,
  type GuildBankItemRow,
  type GuildBankItem,
  type GuildBankItemData,
} from './repositories/guildBank.repo';

export {
  GuildWarRepository,
  type GuildWarRow,
  type GuildWarSide,
  type GuildWar,
  type GuildWarUpdateData,
} from './repositories/guildWar.repo';

export {
  GuildQuestRepository,
  type GuildQuestRow,
  type GuildQuestEntry,
} from './repositories/guildQuest.repo';


// WAL journal -- embedded SQLite crash-recovery log
export {
  Journal,
  type JournalEntry,
  type JournalRow,
  type JournalDeps,
} from './journal';
