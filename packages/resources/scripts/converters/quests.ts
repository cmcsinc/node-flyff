/**
 * propQuest.inc -> data/quests/*.yml converter.
 *
 * Uses {@link tokenize} (recursive-descent; the `.inc` grammar is whitespace-
 * heavy and multi-line, so regex-per-line parsing is insufficient). Each quest
 * block becomes one `QuestDef` file; an `_index.yml` lists id->symbol->title.
 *
 * Symbols (`MI_*`/`II_*`/`JOB_*`/`QT_*`) resolve against the merged
 * `define*.h` table; unresolved ones stay as strings. Command argument lists
 * are preserved verbatim -- the Phase 3 condition/reward engine interprets them
 * positionally, exactly as `CProject::LoadPropQuest` does.
 *
 * @module scripts/converters/quests
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { readSource } from './parse.js';
import { tokenize, loadAllDefines, type Token } from './questTokenize.js';
import type { QuestArg, QuestDef, QuestItem } from '../../src/schemas/quest.schema.js';

/** `TRUE`/`FALSE` literals used by `SetRemove`/`SetRepeat`/etc. */
function toArg(tok: Token, defines: Map<string, number>): QuestArg {
  if (tok.t === 'num') return { type: 'num', value: tok.v };
  if (tok.t === 'str') return { type: 'str', value: tok.v };
  if (tok.t === 'ident') {
    if (tok.v === 'TRUE') return { type: 'bool', value: 1 };
    if (tok.v === 'FALSE') return { type: 'bool', value: 0 };
    const resolved = defines.get(tok.v);
    return { type: 'sym', value: resolved ?? tok.v };
  }
  return { type: 'num', value: 0 };
}

interface ParseAcc {
  commands: QuestDef['commands'];
  states: QuestDef['states'];
  dialog: Record<string, string>;
  questItems: QuestItem[];
  title?: string;
  /** `SetRemove(FALSE)` → true (quest cannot be cancelled). */
  noRemove?: boolean;
}

/** Coerce a `str`/`sym` arg to its string value (IDS_* keys stay symbolic for runtime text lookup). */
function asString(arg: QuestArg | undefined): string | undefined {
  if (!arg) return undefined;
  return arg.type === 'str' || arg.type === 'sym' ? String(arg.value) : undefined;
}

class QuestParser {
  private i = 0;
  constructor(private toks: Token[], private defines: Map<string, number>) {}

  /** Parse the whole file -> QuestDef records (id resolved via defines). */
  parseAll(): QuestDef[] {
    const out: QuestDef[] = [];
    while (this.i < this.toks.length) {
      const idTok = this.toks[this.i];
      const after = this.toks[this.i + 1];
      // Quest header: an ident/num immediately followed by `{`, excluding scope keywords.
      if (
        (idTok.t === 'ident' || idTok.t === 'num') &&
        after?.t === 'punct' && after.v === '{' &&
        !(idTok.t === 'ident' && (idTok.v === 'setting' || idTok.v === 'state'))
      ) {
        const rec = this.parseQuest(idTok);
        if (rec) out.push(rec);
        continue;
      }
      this.i++;
    }
    return out;
  }

  private parseQuest(idTok: Token): QuestDef | null {
    const symbol = idTok.t === 'num' ? String(idTok.v) : idTok.v;
    const id = idTok.t === 'num' ? idTok.v : (this.defines.get(idTok.v) ?? -1);
    this.i += 2; // consume id + `{`
    const acc: ParseAcc = { commands: [], states: {}, dialog: {}, questItems: [] };
    this.parseBody(acc);
    const def: QuestDef = {
      _version: '1.0', id, symbol,
      commands: acc.commands, states: acc.states,
      dialog: Object.keys(acc.dialog).length ? acc.dialog : undefined,
      quest_items: acc.questItems,
      ...(acc.title !== undefined ? { title: acc.title } : {}),
      ...(acc.noRemove ? { no_remove: true } : {}),
    };
    return def;
  }

  /** Read a `{ ... }` body until its closing brace (consumes the `}`). `setting`
   *  is a scope keyword -- recurse so its `}` does not close the quest. */
  private parseBody(acc: ParseAcc): void {
    while (this.i < this.toks.length) {
      const tok = this.toks[this.i];
      if (tok.t === 'punct' && tok.v === '}') { this.i++; return; }
      if (tok.t === 'punct') { this.i++; continue; }
      if (tok.t === 'ident' && tok.v === 'setting') {
        this.i++; // consume 'setting'
        if (this.toks[this.i]?.t === 'punct' && this.toks[this.i].v === '{') this.i++;
        this.parseBody(acc); // recurse -- inner commands merge into the quest
        continue;
      }
      if (tok.t === 'ident' && tok.v === 'state') {
        this.i++;
        const stateId = this.toks[this.i];
        this.i++;
        if (this.toks[this.i]?.t === 'punct' && this.toks[this.i].v === '{') this.i++;
        this.parseState(acc, stateId?.t === 'num' ? String(stateId.v) : '0');
        continue;
      }
      if (tok.t === 'ident') { this.parseCommand(tok.v, acc); continue; }
      this.i++;
    }
  }

  /** `state N { ... }` body -- routes SetDesc/Cond/Status + QuestItem. */
  private parseState(acc: ParseAcc, key: string): void {
    const st: QuestDef['states'][string] = {};
    while (this.i < this.toks.length) {
      const tok = this.toks[this.i];
      if (tok.t === 'punct' && tok.v === '}') { this.i++; break; }
      if (tok.t === 'ident' && (tok.v === 'SetDesc' || tok.v === 'SetCond' || tok.v === 'SetStatus')) {
        const field = tok.v === 'SetDesc' ? 'desc' : tok.v === 'SetCond' ? 'cond' : 'status';
        const val = this.readCallString();
        if (val !== undefined) st[field] = val;
        continue;
      }
      if (tok.t === 'ident' && tok.v === 'QuestItem') { this.readQuestItem(acc); continue; }
      if (tok.t === 'ident') { this.parseCommand(tok.v, acc); continue; }
      this.i++;
    }
    acc.states[key] = st;
  }

  /** One `SetX(args)` / `QuestItem(args)` call -- routes special cmds, else stores raw. */
  private parseCommand(cmd: string, acc: ParseAcc): void {
    if (cmd === 'QuestItem') { this.readQuestItem(acc); return; }
    this.i++; // past cmd ident
    const args = this.readArgs();
    if (cmd === 'SetTitle') { const t = asString(args[0]); if (t !== undefined) acc.title = t; return; }
    // C++ Project.cpp:2433 — SetRemove(N) → m_bNoRemove = !N.  Extracted as
    // `noRemove` on the def so runtime can check without scanning commands.
    if (cmd === 'SetRemove' && args[0]?.type === 'bool') { acc.noRemove = !args[0].value; return; }
    if (cmd === 'SetDialog' && args[0]?.type === 'num') {
      const t = asString(args[1]);
      if (t !== undefined) acc.dialog[String(args[0].value)] = t;
      return;
    }
    acc.commands.push({ cmd, args });
  }

  /** Read `( v, v, ... )` -- consumes the parens; handles missing-`(` tolerantly. */
  private readArgs(): QuestArg[] {
    const args: QuestArg[] = [];
    if (this.toks[this.i]?.t === 'punct' && this.toks[this.i].v === '(') this.i++;
    while (this.i < this.toks.length) {
      const tok = this.toks[this.i];
      if (tok.t === 'punct' && tok.v === ')') { this.i++; break; }
      if (tok.t === 'punct' && (tok.v === ',' || tok.v === ';')) { this.i++; continue; }
      args.push(toArg(tok, this.defines));
      this.i++;
    }
    // Tolerate a trailing `;`
    if (this.toks[this.i]?.t === 'punct' && this.toks[this.i].v === ';') this.i++;
    return args;
  }

  /** `( IDS_X )` -> the string value (for SetDesc/SetCond/SetStatus). */
  private readCallString(): string | undefined {
    this.i++; // past cmd
    const args = this.readArgs();
    return asString(args[0]);
  }

  /** `QuestItem( MI, II, prob, num )` -> push to acc.questItems. */
  private readQuestItem(acc: ParseAcc): void {
    this.i++; // past QuestItem
    const a = this.readArgs();
    if (a.length >= 4 && a.slice(0, 4).every((x) => x.type === 'num' || x.type === 'sym')) {
      const num = (x: QuestArg): number => (typeof x.value === 'number' ? x.value : 0);
      acc.questItems.push({ mover: num(a[0]), item: num(a[1]), prob: num(a[2]), num: num(a[3]) });
    }
  }
}

export async function convertQuests(rawDir: string, dataDir: string): Promise<void> {
  const outDir = resolve(dataDir, 'quests');
  await mkdir(outDir, { recursive: true });
  const src = await readSource(resolve(rawDir, 'propQuest.inc'));
  const defines = await loadAllDefines(rawDir);
  const quests = new QuestParser(tokenize(src), defines).parseAll();

  const index: Array<{ id: number; symbol: string; title?: string }> = [];
  let unresolved = 0;
  let dupes = 0;
  const seen = new Set<number>();
  for (const q of quests) {
    if (q.id < 0) { unresolved++; continue; }
    if (seen.has(q.id)) { dupes++; continue; }
    seen.add(q.id);
    index.push({ id: q.id, symbol: q.symbol, ...(q.title ? { title: q.title } : {}) });
    await writeFile(resolve(outDir, `${q.id}.yml`), stringify(q));
  }
  await writeFile(resolve(outDir, '_index.yml'), stringify({ _version: '1.0', quests: index }));
  console.log(
    `  quests: ${index.length} definitions (symbols resolved: ${defines.size} defines)` +
      `${unresolved ? `, ${unresolved} unresolved-id blocks skipped` : ''}` +
      `${dupes ? `, ${dupes} duplicate-id blocks deduped` : ''}`,
  );
}
