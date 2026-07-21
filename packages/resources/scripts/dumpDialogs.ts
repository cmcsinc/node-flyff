#!/usr/bin/env tsx
/**
 * dumpDialogs — render every NPC dialog into one human-readable text file.
 *
 * Reads the structured dialog data produced by `convert:dialogs` and resolves
 * every `Say(n)` / `Speak(n)` against `_strings.yml`, so you can browse all
 * 271 NPCs / ~2845 states without a YAML parser. Advanced states that the
 * converter could not reduce to data are marked `[source-only C++]` — their
 * raw C++ body lives in each `<prefix>.yml` under `source:`.
 *
 * Output: `data/dialogues/_ALL.txt` (regenerable; not consumed at runtime).
 *
 * Usage: pnpm --filter @flyff/resources dump:dialogs
 *
 * @module scripts/dumpDialogs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** Subset of the dialog-state shape written by converters/dialogs.ts. */
interface DialogState {
  say?: number[];
  speak?: number[];
  keys?: Array<{ label: number; key?: number; param?: number }>;
  timer?: number;
  exit?: boolean;
  launch_quest?: boolean;
  source?: string;
}

interface DialogFile {
  _version: string;
  prefix: string;
  character_key?: string;
  states: Record<string, DialogState>;
}

interface NpcMap {
  _version: string;
  npcs: Record<string, { dialog_file: string; sz_npc: string }>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const DIALOG_DIR = resolve(PKG_ROOT, 'data', 'dialogues');
const OUT_FILE = resolve(DIALOG_DIR, '_ALL.txt');

/** Read + parse a YAML file from data/dialogues/. */
function loadYaml<T>(name: string): T {
  return parse(readFileSync(resolve(DIALOG_DIR, name), 'utf8')) as T;
}

/** strings[n] is the resolved text for Say(n)/Speak(n); guard out-of-range. */
function resolveText(strings: string[], n: number): string {
  return n >= 0 && n < strings.length ? strings[n] : `<missing string #${n}>`;
}

/** Render one NPC dialog file to text lines. */
function renderNpc(
  file: DialogFile,
  displayName: string,
  strings: string[],
): string[] {
  const stateKeys = Object.keys(file.states).sort((a, b) => +a - +b);
  const lines: string[] = [
    '',
    '# ============================================================',
    `# ${displayName}   [${file.prefix}]   ${stateKeys.length} states`,
    '# ============================================================',
  ];
  for (const k of stateKeys) {
    const st = file.states[k];
    const body: string[] = [];
    for (const i of st.say ?? []) body.push(`  Say(${i}): ${resolveText(strings, i)}`);
    for (const i of st.speak ?? []) body.push(`  Speak(${i}): ${resolveText(strings, i)}`);
    if (st.keys?.length) {
      const choices = st.keys.map((c) => resolveText(strings, c.label));
      body.push(`  choices: ${choices.join(' | ')}`);
    }
    if (st.launch_quest) body.push('  [launches quest]');
    if (st.exit) body.push('  [exit]');
    if (st.timer != null) body.push(`  [timer:${st.timer}]`);
    if (st.source) body.push('  [source-only C++]');
    if (body.length === 0) continue; // skip empty/placeholder states
    lines.push(`[${k}]`, ...body);
  }
  return lines;
}

function main(): void {
  const strings = loadYaml<{ strings: string[] }>('_strings.yml').strings;
  const npcMap = loadYaml<NpcMap>('_npc-map.yml').npcs;
  // sz_npc (prefix) → characterKey for readable headers (e.g. MaFl_Boboku).
  const prefixToName = new Map<string, string>();
  for (const [key, entry] of Object.entries(npcMap)) {
    prefixToName.set(entry.sz_npc, key);
  }

  const files = readdirSync(DIALOG_DIR)
    .filter((f) => f.endsWith('.yml') && !f.startsWith('_'))
    .sort();

  const out: string[] = [];
  let npcCount = 0;
  let stateCount = 0;
  let textCount = 0;
  let srcCount = 0;
  for (const f of files) {
    const file = loadYaml<DialogFile>(f);
    const displayName = prefixToName.get(file.prefix) ?? file.prefix;
    npcCount++;
    for (const st of Object.values(file.states)) {
      stateCount++;
      textCount += (st.say?.length ?? 0) + (st.speak?.length ?? 0);
      if (st.source) srcCount++;
    }
    out.push(...renderNpc(file, displayName, strings));
  }

  const header =
    `# All NPC Dialogs - Flyff\n` +
    `# ${npcCount} NPCs | ${stateCount} states | ${textCount} text lines | ${srcCount} source-only\n` +
    `# Regenerate: pnpm --filter @flyff/resources dump:dialogs\n`;
  writeFileSync(OUT_FILE, header + out.join('\n') + '\n');

  console.log(`✅ Wrote ${OUT_FILE}`);
  console.log(`   ${npcCount} NPCs | ${stateCount} states | ${textCount} text lines | ${srcCount} source-only`);
}

main();
