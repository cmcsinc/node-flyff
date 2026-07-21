/**
 * WorldDialog.txt + character.inc + NpcScript.cpp → data/dialogues/*.yml converter.
 *
 * Three outputs:
 *  - `_strings.yml`  — WorldDialog.txt flat string table (`Say(n)`/`Speak(n)` resolve here).
 *  - `_npc-map.yml`  — character.inc `m_szDialog` → `szNpc` prefix lookup.
 *  - `<prefix>.yml`  — one file per NpcScript.cpp function group (`mafl_marche`, …).
 *
 * The simple call subset is parsed into structured fields; complex bodies are
 * kept verbatim in `source` so nothing is lost (ported later). See
 * `schemas/dialog.schema.ts`.
 *
 * @module scripts/converters/dialogs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { readSource } from './parse.js';

/** Read WorldDialog.txt → array where index N = file line (N+1). */
async function convertStrings(rawDir: string, outDir: string): Promise<number> {
  const content = await readSource(resolve(rawDir, 'WorldDialog.txt'));
  const strings = content.split(/\r?\n/);
  // Drop a trailing empty line from the final newline; keep internal blanks (real entries).
  if (strings.length > 0 && strings[strings.length - 1] === '') strings.pop();
  await writeFile(resolve(outDir, '_strings.yml'), stringify({ _version: '1.0', strings }));
  return strings.length;
}

/**
 * Parse character.inc blocks → { characterKey → { dialog_file, sz_npc } }.
 *
 * character.inc format: block header `<Key>\n{` (e.g. `MaFl_Marche`), no
 * `SetSkin`/`m_szDialog` field. The dialog prefix is the lowercased key.
 */
async function convertNpcMap(rawDir: string, outDir: string): Promise<number> {
  const content = await readSource(resolve(rawDir, 'character.inc'));
  const npcs: Record<string, { dialog_file: string; sz_npc: string }> = {};

  // `<Key>` on its own line immediately followed by `{`. Restrict to character
  // block prefixes (Ma/Mi/Md… + capital) to skip C++-style identifiers.
  const headerRe = /^([A-Z][A-Za-z0-9_]*)\s*\{\s*$/gm;
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(content)) !== null) {
    const key = hm[1];
    npcs[key] = { dialog_file: `${key}.txt`, sz_npc: key.toLowerCase() };
  }

  await writeFile(resolve(outDir, '_npc-map.yml'), stringify({ _version: '1.0', npcs }));
  return Object.keys(npcs).length;
}

const SAY_RE = /\bSay\s*\(\s*(\d+)\s*\)/g;
const SPEAK_RE = /\bSpeak\s*\(\s*NpcId\s*\(\s*\)\s*,\s*(\d+)\s*\)/g;
const ADDKEY_RE = /\bAddKey\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?(?:,\s*(\d+)\s*)?\)/g;
const TIMER_RE = /\bSetScriptTimer\s*\(\s*(\d+)\s*\)/;
const EXIT_RE = /\bExit\s*\(\s*\)/;
const LAUNCH_RE = /\bLaunchQuest\s*\(\s*\)/;

/**
 * Matches a body made entirely of the simple subset we parse:
 * `Say/Speak/AddKey/Exit/SetScriptTimer/LaunchQuest/NpcId(...)` calls plus
 * whitespace, digits, `(){};`. Falls through to the `source` escape-hatch.
 */
const SIMPLE_BODY = /^(?:\s*(?:Say|Speak|AddKey|Exit|SetScriptTimer|LaunchQuest|NpcId)\s*\([^)]*\)\s*;?|[\s();{}0-9])*$/;

/** Convert one function body string → DialogState. */
function parseState(body: string): Record<string, unknown> {
  const state: Record<string, unknown> = {};

  const say: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = SAY_RE.exec(body)) !== null) say.push(+m[1]);
  if (say.length) state.say = say;

  const speak: number[] = [];
  while ((m = SPEAK_RE.exec(body)) !== null) speak.push(+m[1]);
  if (speak.length) state.speak = speak;

  const keys: Array<Record<string, number>> = [];
  while ((m = ADDKEY_RE.exec(body)) !== null) {
    const k: Record<string, number> = { label: +m[1] };
    if (m[2] !== undefined) k.key = +m[2];
    if (m[3] !== undefined) k.param = +m[3];
    keys.push(k);
  }
  if (keys.length) state.keys = keys;

  const tm = body.match(TIMER_RE);
  if (tm) state.timer = +tm[1];
  if (EXIT_RE.test(body)) state.exit = true;
  if (LAUNCH_RE.test(body)) state.launch_quest = true;

  // Source-escape: if the body uses calls/conditionals outside the simple subset
  // (if/for, GetQuestState, BeginQuest, ChangeJob, CreateItem, …), keep it raw.
  if (!SIMPLE_BODY.test(body)) state.source = body.trim();
  return state;
}

/** Parse NpcScript.cpp → one DialogFile per `<prefix>` (e.g. mafl_marche). */
async function convertScripts(rawDir: string, outDir: string): Promise<{ files: number; states: number; raw: number }> {
  const content = await readSource(resolve(rawDir, 'NpcScript.cpp'));
  const sigRe = /void\s+CNpcScript::([A-Za-z_][A-Za-z0-9_]*)_(\d+)\s*\(\s*\)/g;
  const groups = new Map<string, { character_key?: string; states: Record<string, unknown> }>();
  let rawStates = 0;
  let totalStates = 0;

  let sig: RegExpExecArray | null;
  while ((sig = sigRe.exec(content)) !== null) {
    const fullName = sig[1]; // e.g. mafl_marche — already lowercase per C++ convention
    const keyIdx = sig[2];
    // Body = from the `{` after the signature to its matching `}`.
    let depth = 0;
    let i = sig.index + sig[0].length;
    while (i < content.length && content[i] !== '{') i++;
    const start = i + 1;
    for (; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = content.slice(start, i);
    const state = parseState(body);
    if (state.source) rawStates++;

    let grp = groups.get(fullName);
    if (!grp) {
      grp = { states: {} };
      groups.set(fullName, grp);
    }
    grp.states[keyIdx] = state;
    totalStates++;
  }

  let files = 0;
  for (const [prefix, grp] of groups) {
    if (Object.keys(grp.states).length === 0) continue;
    const yml = { _version: '1.0', prefix, character_key: grp.character_key, states: grp.states };
    await writeFile(resolve(outDir, `${prefix}.yml`), stringify(yml));
    files++;
  }
  return { files, states: totalStates, raw: rawStates };
}

export async function convertDialogs(rawDir: string, dataDir: string): Promise<void> {
  const outDir = resolve(dataDir, 'dialogues');
  await mkdir(outDir, { recursive: true });

  const [strN, npcN, scripts] = await Promise.all([
    convertStrings(rawDir, outDir),
    convertNpcMap(rawDir, outDir),
    convertScripts(rawDir, outDir),
  ]);

  console.log(
    `  dialogs: ${strN} strings, ${npcN} npc→prefix links, ${scripts.states} states across ${scripts.files} npc files (${scripts.raw} kept as raw source — advanced subset TODO)`,
  );
}
