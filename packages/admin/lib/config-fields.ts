/**
 * Declarative form model for the server-manager config editor.
 *
 * Mirrors the Zod schemas in `packages/core/src/config/schemas/*.schema.ts` —
 * when a schema grows a field the operator should tune, add it here too.
 * Deliberately free of `node:` imports so client components can import it.
 *
 * ponytail: hand-maintained field list rather than schema introspection.
 * Upgrade path = walk the Zod schemas (`_def.shape()`) to derive kinds.
 */

export type ServerType = 'login' | 'cluster' | 'world';

type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export type FieldKind = 'number' | 'text' | 'boolean' | 'select' | 'csv' | 'multiselect';

export interface FieldSpec {
  /** Dotted config path, e.g. `registration.clusterInternalPort`. */
  path: string;
  label: string;
  kind: FieldKind;
  /** Allowed values when `kind === 'select'`. */
  options?: string[];
  /**
   * For `kind === 'multiselect'`: options come from the registered instances of
   * this type rather than a static list.
   */
  optionsFrom?: ServerType;
  hint?: string;
}

export interface FieldSection {
  title: string;
  fields: FieldSpec[];
}

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

const COMMON: FieldSection[] = [
  {
    title: 'Network',
    fields: [
      { path: 'server.host', label: 'Bind host', kind: 'text' },
      {
        path: 'server.publicHost',
        label: 'Public host',
        kind: 'text',
        hint: 'Advertised to clients — never 0.0.0.0',
      },
    ],
  },
  {
    title: 'Logging',
    fields: [
      { path: 'log.level', label: 'Level', kind: 'select', options: LOG_LEVELS },
      { path: 'log.pretty', label: 'Pretty output', kind: 'boolean' },
    ],
  },
  {
    title: 'Database & cache',
    fields: [
      {
        path: 'database.client',
        label: 'DB client',
        kind: 'select',
        options: ['better-sqlite3', 'pg', 'mysql2'],
      },
      { path: 'database.filename', label: 'SQLite file', kind: 'text' },
      {
        path: 'cache.adapter',
        label: 'Cache adapter',
        kind: 'select',
        options: ['memory', 'redis', 'cloudflare'],
      },
      { path: 'cache.redisUrl', label: 'Redis URL', kind: 'text' },
    ],
  },
];

/** Editable fields per server type, grouped into form sections. */
export const CONFIG_FIELDS: Record<ServerType, FieldSection[]> = {
  login: [
    ...COMMON,
    {
      title: 'Cluster registration (inbound)',
      fields: [
        {
          path: 'registration.internalPort',
          label: 'Internal port clusters dial',
          kind: 'number',
          hint: 'Must equal each cluster’s "Login internal port"',
        },
        { path: 'registration.allowedClusters', label: 'Allowed cluster ids', kind: 'csv' },
        { path: 'registration.heartbeatTimeoutMs', label: 'Heartbeat timeout (ms)', kind: 'number' },
      ],
    },
    {
      title: 'Auth',
      fields: [
        { path: 'auth.tokenTtlMs', label: 'Token TTL (ms)', kind: 'number' },
        { path: 'auth.maxLoginAttempts', label: 'Max login attempts', kind: 'number' },
        { path: 'auth.lockoutDurationMs', label: 'Lockout (ms)', kind: 'number' },
      ],
    },
  ],
  cluster: [
    ...COMMON,
    {
      title: 'Login server (outbound)',
      fields: [
        { path: 'registration.loginHost', label: 'Login host', kind: 'text' },
        {
          path: 'registration.loginInternalPort',
          label: 'Login internal port',
          kind: 'number',
          hint: 'Must equal the login server’s registration.internalPort',
        },
        { path: 'registration.reconnectIntervalMs', label: 'Reconnect interval (ms)', kind: 'number' },
        { path: 'registration.heartbeatIntervalMs', label: 'Heartbeat interval (ms)', kind: 'number' },
      ],
    },
    {
      title: 'World registration (inbound)',
      fields: [
        {
          path: 'registration.internalPort',
          label: 'Internal port worlds dial',
          kind: 'number',
          hint: 'Must equal each world’s "Cluster internal port"',
        },
        { path: 'registration.allowedWorlds', label: 'Allowed world ids', kind: 'multiselect', optionsFrom: 'world' },
        {
          path: 'registration.worldHeartbeatTimeoutMs',
          label: 'World heartbeat timeout (ms)',
          kind: 'number',
        },
      ],
    },
    {
      title: 'New characters',
      fields: [
        { path: 'character.maxPerAccount', label: 'Max per account', kind: 'number' },
        { path: 'character.startMap', label: 'Start map', kind: 'text' },
        { path: 'character.startX', label: 'Start X', kind: 'number' },
        { path: 'character.startY', label: 'Start Y', kind: 'number' },
        { path: 'character.startZ', label: 'Start Z', kind: 'number' },
        { path: 'character.startLevel', label: 'Start level', kind: 'number' },
        { path: 'character.startGold', label: 'Start penya', kind: 'number' },
        { path: 'character.startInventorySize', label: 'Inventory slots', kind: 'number' },
      ],
    },
  ],
  world: [
    ...COMMON,
    {
      title: 'Cluster server (outbound)',
      fields: [
        { path: 'registration.clusterHost', label: 'Cluster host', kind: 'text' },
        {
          path: 'registration.clusterInternalPort',
          label: 'Cluster internal port',
          kind: 'number',
          hint: 'Must equal the cluster’s registration.internalPort',
        },
        { path: 'registration.channelId', label: 'Channel id', kind: 'number' },
        { path: 'registration.channelName', label: 'Channel name', kind: 'text' },
        { path: 'registration.reconnectIntervalMs', label: 'Reconnect interval (ms)', kind: 'number' },
        { path: 'registration.heartbeatIntervalMs', label: 'Heartbeat interval (ms)', kind: 'number' },
      ],
    },
    {
      title: 'Simulation',
      fields: [
        { path: 'world.tickRateMs', label: 'Tick rate (ms)', kind: 'number' },
        { path: 'world.maxPlayers', label: 'Max players', kind: 'number' },
        { path: 'world.expRate', label: 'EXP rate', kind: 'number' },
        { path: 'world.dropRate', label: 'Drop rate', kind: 'number' },
        { path: 'world.goldRate', label: 'Penya rate', kind: 'number' },
        { path: 'world.spawnMultiplier', label: 'Spawn multiplier', kind: 'number' },
        {
          path: 'world.guildWarEnabled',
          label: 'Guild war',
          kind: 'boolean',
          hint: 'EVE_GUILDWAR. Vanilla v19 ships this OFF. On: warring guilds can attack each other regardless of PK mode, and wars expire after 2 hours.',
        },
        {
          path: 'world.guildQuestEnabled',
          label: 'Guild quest arena',
          kind: 'boolean',
          hint: 'EVE_WORMON. Vanilla v19 ships this OFF. On: a level-70 guild master can open the one defined boss arena (QUEST_WARMON_LV1, a single MI_CLOCKWORK1 in a Madrigal rect), held world-exclusively for 60 min plus a 20-min loot window. There are no quest rewards.',
        },
      ],
    },
    {
      title: 'Zone & persistence',
      fields: [
        { path: 'zone.broadcastRadius', label: 'Broadcast radius', kind: 'number' },
        { path: 'zone.persistIntervalMs', label: 'Persist interval (ms)', kind: 'number' },
        { path: 'wal.journalPath', label: 'WAL journal path', kind: 'text' },
        { path: 'wal.syncBatchSize', label: 'WAL batch size', kind: 'number' },
        { path: 'consumable.potionCooldownMs', label: 'Potion cooldown (ms)', kind: 'number' },
      ],
    },
  ],
};

/** Appends a token, trimmed and deduped. Returns the same array when it is a no-op. */
export function addToken(list: readonly string[], raw: string): string[] {
  const v = raw.trim();
  return v === '' || list.includes(v) ? [...list] : [...list, v];
}

/** Reads a dotted path. Returns `undefined` when any segment is missing. */
export function getAtPath(obj: Plain, path: string): unknown {
  let cursor: unknown = obj;
  for (const key of path.split('.')) {
    if (!isPlain(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

/** Immutably writes a dotted path; `undefined` deletes the leaf (and empty parents). */
export function setAtPath(obj: Plain, path: string, value: unknown): Plain {
  const [key, ...rest] = path.split('.');
  if (key === undefined) return obj;
  const out = { ...obj };
  if (rest.length === 0) {
    if (value === undefined) delete out[key];
    else out[key] = value;
    return out;
  }
  const child = setAtPath(isPlain(out[key]) ? out[key] : {}, rest.join('.'), value);
  if (Object.keys(child).length === 0) delete out[key];
  else out[key] = child;
  return out;
}
