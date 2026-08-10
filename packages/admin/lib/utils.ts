import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format large numbers with commas. */
export function formatNumber(n: number | bigint | string): string {
  return BigInt(n).toLocaleString();
}

/** Format a timestamp (Unix epoch ms number, ISO string, or Date) to a readable date. */
export function formatDate(ts: string | number | Date | null | undefined): string {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts) : typeof ts === 'string' ? new Date(ts) : ts;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Flyff job ID to class name. */
export const JOB_NAMES: Record<number, string> = {
  0: 'Vagrant',
  1: 'Mercenary',
  2: 'Acrobat',
  3: 'Assist',
  4: 'Magician',
  5: 'Knight',
  6: 'Blade',
  7: 'Jester',
  8: 'Ranger',
  9: 'Ringmaster',
  10: 'Billposter',
  11: 'Psykeeper',
  12: 'Elementor',
  13: 'Knight (Master)',
  14: 'Blade (Master)',
  15: 'Jester (Master)',
  16: 'Ranger (Master)',
  17: 'Ringmaster (Master)',
  18: 'Billposter (Master)',
  19: 'Psykeeper (Master)',
  20: 'Elementor (Master)',
  21: 'Lord',
  22: 'Stormblade',
  32: 'Slayer',
  33: 'Templar',
};

export function jobName(classId: number): string {
  return JOB_NAMES[classId] ?? `Class ${String(classId)}`;
}

/**
 * Flyff world (`WI_WORLD_*` / numeric worldId) → human-readable name.
 *
 * The DB stores `world_id` as an opaque string (a `WI_WORLD_*` define symbol,
 * a lowercase zone alias, or a numeric id). Mirrors the canonical mapping in
 * `packages/resources/raw/defineWorld.h`, plus the cluster-config `startMap`
 * shorthands (`WI_WORLD_FLARIS`, `WI_WORLD_SAINT_MORNING`) used in
 * `config/cluster-server.json`. Zone YAML files use lowercase aliases
 * (e.g. `world_id: madrigal`); those are normalized before lookup.
 */
const WORLD_NAMES: Record<string, string> = {
  NONE: 'None',
  MADRIGAL: 'Madrigal',
  FLARIS: 'Flaris',
  SAINTMORNING: 'Saint Morning',
  SAINT_MORNING: 'Saint Morning',
  SAINTHALLOWEEN: 'Saint Halloween',
  DARKON: 'Darkon',
  KEBARAS: 'Kebaras',
  CISLAND: 'Coral Island',
  RARTESIA: 'Rartesia',
  DARKRARTESIA: 'Dark Rartesia',
  // Instances / dungeons
  OMINOUS: 'Ominous',
  DREADFULCAVE: 'Dreadful Cave',
  RUSTIA: 'Rustia',
  BEHAMAH: 'Behamah',
  KALGAS: 'Kalgas',
  UPRESIA: 'Upresia',
  HERNEOS: 'Herneos',
  SANPRES: 'Sanpres',
  // Event / arena / guild
  EVENT01: 'Event',
  GUILDWAR: 'Guild War',
  ARENA: 'Arena',
  MINIROOM: 'Mini Room',
  QUIZ: 'Quiz',
  COLOSSEUM: 'Colosseum',
  FWC: 'FWC',
  MARKET: 'Market',
  RICHCASTLE: 'Richis Castle',
  // Misc
  HEAVEN01: 'Heaven 1',
  HEAVEN02: 'Heaven 2',
  HEAVEN03: 'Heaven 3',
  HEAVEN04: 'Heaven 4',
  HEAVEN05: 'Heaven 5',
  TEST: 'Test',
  LUX: 'Lux',
  LUX2: 'Lux 2',
  VOLCANE: 'Volcane',
  VOLCANERED: 'Volcane Red',
  VOLCANEYELLOW: 'Volcane Yellow',
  MUSCLE: 'Muscle',
  KRRR: 'Krrr',
  BEAR: 'Bear',
  // numeric ids (defineWorld.h) -> shared name above via WORLD_IDS
};

/** Numeric `worldId` (defineWorld.h) → canonical symbol, for string/number input. */
const WORLD_IDS: Record<number, string> = {
  0: 'NONE',
  1: 'MADRIGAL',
  2: 'KEBARAS',
  3: 'CISLAND',
  4: 'RARTESIA',
  5: 'DARKRARTESIA',
  21: 'HEAVEN01',
  22: 'HEAVEN02',
  23: 'HEAVEN03',
  24: 'HEAVEN04',
  25: 'HEAVEN05',
  100: '0425',
  101: 'TEST',
  102: 'LUX',
  103: 'LUX2',
  120: 'EVENT01',
  202: 'GUILDWAR',
  203: 'VOLCANE',
  208: 'ARENA',
  209: 'MINIROOM',
  211: 'QUIZ',
  231: 'COLOSSEUM',
  232: 'ARENA',
  233: 'FWC',
  234: 'MARKET',
  235: 'RICHCASTLE',
};

function resolveWorldKey(worldId: string | number | null | undefined): string | null {
  if (worldId === null || worldId === undefined) return null;
  const raw = String(worldId).trim();
  if (raw === '') return null;

  // Pure numeric -> defineWorld.h id
  if (/^\d+$/.test(raw)) {
    return WORLD_IDS[Number(raw)] ?? null;
  }

  // Strip WI_WORLD_ / WI_ / WI_INSTANCE_ / WI_DUNGEON_ prefixes and separators.
  const stripped = raw
    .replace(/^WI_(WORLD|INSTANCE|DUNGEON|GUILDHOUSE)_/, '')
    .replace(/^WI_/, '')
    .toUpperCase();

  // Direct symbol hit (MADRIGAL, FLARIS, VOLCANE, ...)
  if (WORLD_NAMES[stripped]) return stripped;
  // Try the raw uppercased value (handles lowercase aliases like "madrigal")
  if (WORLD_NAMES[raw.toUpperCase()]) return raw.toUpperCase();

  return null;
}

/** Flyff worldId string/number → readable name, falling back to the raw value. */
export function worldName(worldId: string | number | null | undefined): string {
  const key = resolveWorldKey(worldId);
  if (key && WORLD_NAMES[key]) return WORLD_NAMES[key];
  const raw = worldId === null || worldId === undefined ? '' : String(worldId).trim();
  // Last resort: show something readable rather than an opaque symbol.
  if (!raw) return 'Unknown';
  return raw
    .replace(/^WI_(WORLD|INSTANCE|DUNGEON|GUILDHOUSE)_/, '')
    .replace(/^WI_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
