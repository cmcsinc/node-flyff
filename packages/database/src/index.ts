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
  type BuffRow,
} from './repositories/buff.repo';

// WAL journal -- embedded SQLite crash-recovery log
export {
  Journal,
  type JournalEntry,
  type JournalRow,
  type JournalDeps,
} from './journal';
