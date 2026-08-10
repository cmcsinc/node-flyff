import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ── Accounts ──────────────────────────────────────────────────────────────────
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username', { length: 32 }).notNull().unique(),
  passwordHash: text('password_hash', { length: 255 }).notNull(),
  email: text('email', { length: 255 }),
  authority: integer('authority').default(0x46).notNull(), // AUTH_* ASCII code
  banned: integer('banned', { mode: 'boolean' }).default(false).notNull(),
  bannedUntil: text('banned_until'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP').notNull(),
});

export const accountsRelations = relations(accounts, ({ many, one }) => ({
  characters: many(characters),
  bank: one(bank),
}));

// ── Characters ────────────────────────────────────────────────────────────────
export const characters = sqliteTable('characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name', { length: 16 }).notNull().unique(),
  slot: integer('slot').notNull(),
  class: integer('class').default(0).notNull(),
  gender: integer('gender').default(0).notNull(),
  hairStyle: integer('hair_style').default(1).notNull(),
  hairColor: integer('hair_color').default(1).notNull(),
  faceStyle: integer('face_style').default(1).notNull(),
  skinColor: integer('skin_color').default(1).notNull(),
  level: integer('level').default(1).notNull(),
  exp: text('exp').default('0').notNull(),
  hp: integer('hp').default(100).notNull(),
  mp: integer('mp').default(50).notNull(),
  maxHp: integer('max_hp').default(100).notNull(),
  maxMp: integer('max_mp').default(50).notNull(),
  strength: integer('strength').default(15).notNull(),
  stamina: integer('stamina').default(15).notNull(),
  dexterity: integer('dexterity').default(15).notNull(),
  intelligence: integer('intelligence').default(15).notNull(),
  remainGp: integer('remain_gp').default(0).notNull(),
  x: real('x').default(0).notNull(),
  y: real('y').default(0).notNull(),
  z: real('z').default(0).notNull(),
  angle: real('angle').default(0),
  worldId: text('world_id', { length: 32 }).default('world1').notNull(),
  zoneId: integer('zone_id').default(1).notNull(),
  skillPoint: integer('skill_point').default(0).notNull(),
  skillLevel: integer('skill_level').default(0).notNull(),
  taskbar: text('taskbar'),
  pkPropensity: integer('pk_propensity').default(0).notNull(),
  pkValue: integer('pk_value').default(0).notNull(),
  pkTime: integer('pk_time').default(0).notNull(),
  pkExp: integer('pk_exp').default(0).notNull(),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP').notNull(),
});

export const charactersRelations = relations(characters, ({ one, many }) => ({
  account: one(accounts, { fields: [characters.accountId], references: [accounts.id] }),
  inventory: one(inventory),
  inventoryItems: many(inventoryItems),
  skills: many(skills),
  buffs: many(characterBuffs),
  activeQuests: many(characterQuests),
  completedQuests: many(characterCompletedQuests),
}));

// ── Inventory Container (gold) ────────────────────────────────────────────────
export const inventory = sqliteTable('inventory', {
  characterId: integer('character_id')
    .primaryKey()
    .references(() => characters.id, { onDelete: 'cascade' }),
  gold: text('gold').default('0').notNull(),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP').notNull(),
});

// ── Inventory Items ───────────────────────────────────────────────────────────
export const inventoryItems = sqliteTable('inventory_item', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  slot: integer('slot').notNull(),
  itemId: integer('item_id').notNull(),
  quantity: integer('quantity').default(1).notNull(),
  flags: integer('flags').default(0).notNull(),
  durability: integer('durability').default(-1).notNull(),
  refine: integer('refine').default(0).notNull(),
  element: integer('element').default(0).notNull(),
  elementLevel: integer('element_level').default(0).notNull(),
  stats: text('stats'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP').notNull(),
});

// ── Bank Container (gold + password) ──────────────────────────────────────────
export const bank = sqliteTable('bank', {
  accountId: integer('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  gold: text('gold').default('0').notNull(),
  goldTab1: text('gold_tab1').default('0').notNull(),
  goldTab2: text('gold_tab2').default('0').notNull(),
  bankPass: text('bank_pass', { length: 10 }).default('0000').notNull(),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP').notNull(),
});

// ── Bank Items ────────────────────────────────────────────────────────────────
export const bankItems = sqliteTable('bank_item', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  tab: integer('tab').notNull(),
  slot: integer('slot').notNull(),
  itemId: integer('item_id').notNull(),
  quantity: integer('quantity').default(1).notNull(),
  flags: integer('flags').default(0).notNull(),
  durability: integer('durability').default(-1).notNull(),
  refine: integer('refine').default(0).notNull(),
  stats: text('stats'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP').notNull(),
});

// ── Skills ────────────────────────────────────────────────────────────────────
export const skills = sqliteTable('skills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  slot: integer('slot').notNull(),
  skillId: integer('skill_id').notNull(),
  level: integer('level').default(1).notNull(),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP').notNull(),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP').notNull(),
});

// ── Character Buffs (active timed skill buffs) ───────────────────────────────
export const characterBuffs = sqliteTable('character_buffs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  type: integer('type').notNull(), // BUFF_ITEM=0, BUFF_SKILL=1
  skillId: integer('skill_id').notNull(), // skill id or item id
  level: integer('level').notNull(), // skill level
  expiresAtMs: integer('expires_at_ms').notNull(), // absolute expiry (epoch ms)
});

export const characterBuffsRelations = relations(characterBuffs, ({ one }) => ({
  character: one(characters, { fields: [characterBuffs.characterId], references: [characters.id] }),
}));

// ── Character Quests (active) ─────────────────────────────────────────────────
export const characterQuests = sqliteTable('character_quests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  questId: integer('quest_id').notNull(),
  state: integer('state').default(0).notNull(),
  time: integer('time').default(0).notNull(),
  killNpcNum0: integer('kill_npc_num_0').default(0).notNull(),
  killNpcNum1: integer('kill_npc_num_1').default(0).notNull(),
  flags: integer('flags').default(0).notNull(),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP').notNull(),
});

// ── Character Completed Quests ────────────────────────────────────────────────
export const characterCompletedQuests = sqliteTable('character_completed_quests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  questId: integer('quest_id').notNull(),
  completedAt: text('completed_at').default('CURRENT_TIMESTAMP').notNull(),
});

// ── Character Checked Quests ──────────────────────────────────────────────────
export const characterCheckedQuests = sqliteTable('character_checked_quests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  questId: integer('quest_id').notNull(),
  slot: integer('slot').notNull(),
});

// ── Quest Log ─────────────────────────────────────────────────────────────────
export const questLog = sqliteTable('quest_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  questId: integer('quest_id').notNull(),
  action: integer('action').notNull(),
  ts: text('ts').default('CURRENT_TIMESTAMP').notNull(),
});

// ── Quick Slots ───────────────────────────────────────────────────────────────
export const quickSlots = sqliteTable('quick_slots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  slot: integer('slot').notNull(),
  type: integer('type').notNull(),
  targetId: integer('target_id').notNull(),
});

// ── Online Players (live-session presence, migration 017) ────────────────────
export const onlinePlayers = sqliteTable('online_players', {
  characterId: integer('character_id')
    .primaryKey()
    .references(() => characters.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').notNull(),
  worldId: text('world_id', { length: 32 }).notNull(),
  zoneId: integer('zone_id').notNull(),
  serverId: text('server_id', { length: 64 }).notNull(),
  lastSeenMs: integer('last_seen_ms').notNull(), // online iff > now - 60s
});

export const onlinePlayersRelations = relations(onlinePlayers, ({ one }) => ({
  character: one(characters, { fields: [onlinePlayers.characterId], references: [characters.id] }),
}));

// ── Mail (CMail, migration 017) ───────────────────────────────────────────────
export const mail = sqliteTable('mail', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  receiverId: integer('receiver_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  senderId: integer('sender_id').default(0).notNull(), // 0 renders as "FLYFF"
  senderName: text('sender_name', { length: 32 }).default('').notNull(),
  title: text('title', { length: 32 }).default('').notNull(), // <=31 chars on the wire
  text: text('text').default('').notNull(), // <=255 chars on the wire
  gold: text('gold').default('0').notNull(), // __int64 penya as string
  itemId: integer('item_id'), // NULL = no attachment
  itemCount: integer('item_count').default(0).notNull(),
  itemFlags: integer('item_flags').default(0).notNull(),
  itemRefine: integer('item_refine').default(0).notNull(),
  itemElement: integer('item_element').default(0).notNull(),
  itemElementLevel: integer('item_element_level').default(0).notNull(),
  itemDurability: integer('item_durability').default(-1).notNull(),
  read: integer('read', { mode: 'boolean' }).default(false).notNull(),
  takenItem: integer('taken_item', { mode: 'boolean' }).default(false).notNull(),
  takenGold: integer('taken_gold', { mode: 'boolean' }).default(false).notNull(),
  createdAtMs: integer('created_at_ms').notNull(), // absolute; wire field is an AGE
});

export const mailRelations = relations(mail, ({ one }) => ({
  receiver: one(characters, { fields: [mail.receiverId], references: [characters.id] }),
}));

// ── Admin Audit Log (new) ─────────────────────────────────────────────────────
export const adminAuditLog = sqliteTable('admin_audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull(),
  action: text('action', { length: 64 }).notNull(),
  targetType: text('target_type', { length: 32 }).notNull(),
  targetId: integer('target_id'),
  details: text('details'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP').notNull(),
});
