// Database factory and migration runner
export { createDb, type DbConfig } from './db.js';
export {
  runMigrations,
  rollbackMigrations,
  getCurrentMigration,
} from './migrate.js';

// Repositories
export {
  AccountRepository,
  type AccountRow,
  type AccountCreateData,
  type AccountUpdateData,
} from './repositories/account.repo.js';

export {
  CharacterRepository,
  type CharacterRow,
  type CharacterCreateData,
  type CharacterUpdateData,
} from './repositories/character.repo.js';

export {
  InventoryRepository,
  type InventoryRow,
  type InventoryCreateData,
} from './repositories/inventory.repo.js';

export {
  BankRepository,
  type BankRow,
  type BankCreateData,
} from './repositories/bank.repo.js';

export {
  QuestRepository,
  type CharacterQuestRow,
  type CompletedQuestRow,
  type PlayerQuestState,
  type ActiveQuestPayload,
} from './repositories/quest.repo.js';

export {
  SkillRepository,
  type LearnedSkill,
  type SkillRow,
} from './repositories/skill.repo.js';

// WAL journal -- embedded SQLite crash-recovery log
export {
  Journal,
  type JournalEntry,
  type JournalRow,
  type JournalDeps,
} from './journal.js';
