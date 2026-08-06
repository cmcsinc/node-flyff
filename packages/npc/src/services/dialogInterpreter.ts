/**
 * Dialog `source:`-body interpreter -- the C++ subset that lives in the
 * unported tails of `data/dialogues/*.yml` (`if (GetQuestState(...)) { ... }`
 * quest-giver bodies). The simple-subset converter extracts `Say`/`Speak`/
 * `AddKey`/`Exit` into structured fields; everything conditional or stateful is
 * kept verbatim in `source` and handled here.
 *
 * Grammar supported (recursive descent -- mirrors `CNpcScript::<prefix>_<idx>`
 * bodies in `game/source/WORLDDIALOG/NpcScript.cpp`):
 *
 * ```
 * program    := stmt*
 * stmt       := ifStmt | call ';' | block | ';'
 * ifStmt     := 'if' '(' expr ')' stmt ('else' stmt)?
 * block      := '{' stmt* '}'
 * expr       := orE
 * orE        := andE ('||' andE)*
 * andE       := cmpE ('&&' cmpE)*
 * cmpE       := unary (('==' | '!=' | '<' | '<=' | '>' | '>=') unary)?
 * unary      := '!' unary | primary
 * primary    := num | sym | call | '(' expr ')'
 * call       := IDENT '(' (expr (',' expr)*)? ')'
 * ```
 *
 * Values are integers; truthiness = non-zero (C++ `int` semantics). Unknown
 * functions / symbols are no-ops / `undefined` -- the dialog renders with the
 * ops it could resolve rather than crashing the click.
 *
 * The interpreter is pure: all runtime state (player job/lvl, quest state,
 * inventory, RNG) is read through {@link DialogInterpBindings}, and all
 * side effects (Say/Speak/AddKey/Exit/LaunchQuest/...) are emitted through
 * {@link DialogInterpSink}. `ScriptDlgService` wires both.
 *
 * @module services/dialogInterpreter
 */

import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'dialog-interpreter' });

/** Built-in constants not in `define*.h` (quest-state enum + bool literals). */
const BUILTIN_CONST: Record<string, number> = {
  QS_BEGIN: 0,
  QS_END: 14,
  TRUE: 1,
  FALSE: 0,
};

export interface DialogInterpBindings {
  /** Resolve `QUEST_*` / `II_*` / `TID_*` / `MI_*` / `JOB_*` to a number. */
  resolveSymbol(sym: string): number | undefined;
  // --- runtime queries (return numbers; predicates return 0/1) ---
  questState(questId: number): number;
  isSetQuest(questId: number): number;
  playerJob(): number;
  playerLvl(): number;
  getItemNum(itemId: number): number;
  emptyInventoryNum(): number;
  playerGold(): number;
  partySize(): number;
  isParty(): number;
  isPartyMaster(): number;
  isGuild(): number;
  isGuildMaster(): number;
  isGuildQuest(questId: number): number;
  guildQuestState(questId: number): number;
  playerExpPercent(): number;
  random(n: number): number;
  isWormonServer(): number;
  /**
   * `MonHuntStart( nQuest, nState, nState2, n )` (`ScriptLib.cpp:443`) -- open
   * the guild-quest boss arena. Returns 1 on success, 0 on any refusal.
   *
   * A binding rather than a sink op because the script uses it in EXPRESSION
   * position (`if( MonHuntStart(...) == FALSE )`, `NpcScript.cpp:2061`), so its
   * return value drives the branch. It is the only binding with a side effect.
   */
  monHuntStart(questId: number, state: number, ns: number, nf: number): number;
}

export interface DialogInterpSink {
  say(textIndex: number): void;
  speak(textIndex: number): void;
  addKey(label: number, key?: number, param?: number): void;
  addCondKey(label: number, key: number): void;
  removeKey(key: number): void;
  exit(): void;
  launchQuest(): void;
  beginQuest(questId: number): void;
  endQuest(questId: number): void;
  changeJob(jobId: number): void;
  /** `InitStat()` -- reset base stats + refund GP (`ScriptLib.cpp:570`). */
  initStat(): void;
  createItem(itemId: number, count: number): void;
  removeAllItem(itemId: number): void;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number }
  | { t: 'ident'; v: string }
  | { t: 'punct'; v: string };

/**
 * Token pattern. `-` is in the op set for a reason worth stating: the
 * `(?<op>...)` alternation is the ONLY thing that turns a character into a
 * token, and anything unmatched is silently skipped by {@link tokenize}. Before
 * `-` was listed, `GetGuildQuestState(1) == -1` tokenized as `== 1` -- the minus
 * vanished and the comparison quietly ran against POSITIVE one. A dropped
 * operator is far worse than a parse error, because it evaluates.
 */
const TOKEN_RE = /\s+|(?<num>\d+)|(?<ident>[A-Za-z_]\w*)|(?<op>==|!=|<=|>=|&&|\|\||[!<>(),;{}-])/g;

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    const g = m.groups;
    if (g?.['num'] !== undefined) toks.push({ t: 'num', v: parseInt(g['num'], 10) });
    else if (g?.['ident'] !== undefined) toks.push({ t: 'ident', v: g['ident'] });
    else if (g?.['op'] !== undefined) toks.push({ t: 'punct', v: g['op'] });
    // whitespace / unrecognized: skip
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Parser -- recursive descent producing statement + expression AST nodes.
// ---------------------------------------------------------------------------

type Expr =
  | { k: 'num'; v: number }
  | { k: 'sym'; name: string }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'unary'; op: '!'; e: Expr }
  | { k: 'neg'; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr };

type Stmt =
  | { k: 'if'; cond: Expr; then: Stmt[]; else?: Stmt[] }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'block'; body: Stmt[] };

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined { return this.toks[this.i]; }
  private next(): Tok | undefined { return this.toks[this.i++]; }
  private isPunct(v: string): boolean { const t = this.peek(); return t?.t === 'punct' && t.v === v; }
  private eatPunct(v: string): void {
    const t = this.next();
    if (t?.t !== 'punct' || t.v !== v) throw new Error(`expected '${v}' got ${JSON.stringify(t)}`);
  }

  parseProgram(): Stmt[] {
    const out: Stmt[] = [];
    while (this.i < this.toks.length) {
      const s = this.parseStmt();
      if (s) out.push(s);
    }
    return out;
  }

  private parseStmt(): Stmt | null {
    // skip stray semicolons
    while (this.isPunct(';')) this.next();
    if (this.i >= this.toks.length) return null;
    if (this.isPunct('{')) return { k: 'block', body: this.parseBlock() };
    const t = this.peek();
    if (t?.t === 'ident' && t.v === 'if') { this.next(); return this.parseIf(); }
    if (t?.t === 'ident') { const c = this.parseCallStmt(); return c; }
    // Unknown token in statement position -- skip it (robustness: never throw on a malformed body).
    this.next();
    return null;
  }

  private parseBlock(): Stmt[] {
    this.eatPunct('{');
    const body: Stmt[] = [];
    while (!this.isPunct('}') && this.i < this.toks.length) {
      const s = this.parseStmt();
      if (s) body.push(s);
    }
    this.eatPunct('}');
    return body;
  }

  private parseIf(): Stmt {
    this.eatPunct('(');
    const cond = this.parseExpr();
    this.eatPunct(')');
    const then = this.parseBranch();
    let els: Stmt[] | undefined;
    const saved = this.i;
    while (this.isPunct(';')) this.next();
    const t = this.peek();
    if (t?.t === 'ident' && t.v === 'else') {
      this.next();
      els = this.parseBranch();
    } else {
      this.i = saved; // un-consume the trailing ';' we scanned ahead
    }
    return els ? { k: 'if', cond, then, else: els } : { k: 'if', cond, then };
  }

  private parseBranch(): Stmt[] {
    const s = this.parseStmt();
    return s ? [s] : [];
  }

  private parseCallStmt(): Stmt {
    const name = (this.next() as { v: string }).v;
    const args = this.parseArgList();
    if (this.isPunct(';')) this.next();
    return { k: 'call', name, args };
  }

  private parseArgList(): Expr[] {
    this.eatPunct('(');
    const args: Expr[] = [];
    if (!this.isPunct(')')) {
      do {
        args.push(this.parseExpr());
      } while (this.isPunct(',') && (this.next(), true));
    }
    this.eatPunct(')');
    return args;
  }

  // expr := orE
  private parseExpr(): Expr { return this.parseOr(); }
  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.isPunct('||')) { this.next(); const r = this.parseAnd(); l = { k: 'bin', op: '||', l, r }; }
    return l;
  }
  private parseAnd(): Expr {
    let l = this.parseCmp();
    while (this.isPunct('&&')) { this.next(); const r = this.parseCmp(); l = { k: 'bin', op: '&&', l, r }; }
    return l;
  }
  private parseCmp(): Expr {
    let l = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (t?.t === 'punct' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) {
        this.next();
        const r = this.parseUnary();
        l = { k: 'bin', op: t.v, l, r };
      } else break;
    }
    return l;
  }
  private parseUnary(): Expr {
    if (this.isPunct('!')) { this.next(); return { k: 'unary', op: '!', e: this.parseUnary() }; }
    // Unary minus. No shipped dialog body uses a negative literal (checked
    // across `resources/data/dialogues`), but `GetGuildQuestState` returns -1
    // and the tokenizer emits `-` as punctuation, so without this a future
    // `== -1` would THROW mid-dialog rather than evaluate. Folded into the
    // literal instead of a node: negation only ever applies to a number here.
    if (this.isPunct('-')) {
      this.next();
      const e = this.parseUnary();
      if (e.k === 'num') return { k: 'num', v: -e.v };
      return { k: 'neg', e };
    }
    return this.parsePrimary();
  }
  private parsePrimary(): Expr {
    const t = this.next();
    if (!t) throw new Error('unexpected end of input');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'punct' && t.v === '(') { const e = this.parseExpr(); this.eatPunct(')'); return e; }
    if (t.t === 'ident') {
      if (this.isPunct('(')) {
        const args = this.parseArgList();
        return { k: 'call', name: t.v, args };
      }
      return { k: 'sym', name: t.v };
    }
    throw new Error(`unexpected token ${JSON.stringify(t)}`);
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function evalExpr(e: Expr, b: DialogInterpBindings): number {
  switch (e.k) {
    case 'num': return e.v;
    case 'sym': {
      const builtin = BUILTIN_CONST[e.name];
      if (builtin !== undefined) return builtin;
      const v = b.resolveSymbol(e.name);
      return v ?? 0; // unresolved symbol -> 0 (comparisons fail safe)
    }
    case 'call': return evalCallExpr(e.name, e.args, b);
    case 'unary': return evalExpr(e.e, b) ? 0 : 1;
    case 'neg': return -evalExpr(e.e, b);
    case 'bin': return evalBin(e.op, e.l, e.r, b);
  }
}

function evalBin(op: string, l: Expr, r: Expr, b: DialogInterpBindings): number {
  if (op === '&&') return (evalExpr(l, b) !== 0 && evalExpr(r, b) !== 0) ? 1 : 0;
  if (op === '||') return (evalExpr(l, b) !== 0 || evalExpr(r, b) !== 0) ? 1 : 0;
  const lv = evalExpr(l, b);
  const rv = evalExpr(r, b);
  switch (op) {
    case '==': return lv === rv ? 1 : 0;
    case '!=': return lv !== rv ? 1 : 0;
    case '<': return lv < rv ? 1 : 0;
    case '<=': return lv <= rv ? 1 : 0;
    case '>': return lv > rv ? 1 : 0;
    case '>=': return lv >= rv ? 1 : 0;
  }
  return 0;
}

/** Function calls used in expression position (runtime queries). */
function evalCallExpr(name: string, args: Expr[], b: DialogInterpBindings): number {
  const argv = (): number => evalExpr(args[0] ?? { k: 'num', v: 0 }, b);
  const argAt = (i: number): number => evalExpr(args[i] ?? { k: 'num', v: 0 }, b);
  switch (name) {
    case 'GetQuestState': return b.questState(argv());
    case 'IsSetQuest': return b.isSetQuest(argv());
    case 'GetPlayerJob': return b.playerJob();
    case 'GetPlayerLvl': return b.playerLvl();
    case 'GetPlayerGold': return b.playerGold();
    case 'GetPlayerExpPercent': return b.playerExpPercent();
    case 'GetItemNum': return b.getItemNum(argv());
    case 'GetEmptyInventoryNum': return b.emptyInventoryNum();
    case 'GetPartyNum': return b.partySize();
    case 'IsParty': return b.isParty();
    case 'IsPartyMaster': return b.isPartyMaster();
    case 'IsPartyGuild': return b.isParty();
    case 'IsGuild': return b.isGuild();
    case 'IsGuildMaster': return b.isGuildMaster();
    case 'IsGuildQuest': return b.isGuildQuest(argv());
    case 'GetGuildQuestState': return b.guildQuestState(argv());
    case 'Random': return b.random(argv());
    case 'IsWormonServer': return b.isWormonServer();
    // Side-effecting, and in expression position on purpose -- see the binding.
    case 'MonHuntStart': return b.monHuntStart(argAt(0), argAt(1), argAt(2), argAt(3));
    case 'NpcId': return 0; // identity not needed server-side; Speak uses the active NPC
    case 'GetParam1':
    case 'GetParam2':
    case 'GetParam3': return 0; // C++ no-ops (NpcScriptHelper.cpp:4667)
    default:
      logger.debug({ fn: name }, 'interp: unknown query function -> 0');
      return 0;
  }
}

/** Function calls in statement position (side effects -> sink). */
function execCall(s: Stmt, b: DialogInterpBindings, sink: DialogInterpSink): void {
  if (s.k !== 'call') return;
  const { name, args } = s;
  const arg = (i: number): number => evalExpr(args[i] ?? { k: 'num', v: 0 }, b);
  switch (name) {
    case 'Say': sink.say(arg(0)); return;
    case 'Speak': sink.speak(arg(1)); return;          // Speak( NpcId(), n ) -- text is 2nd arg
    case 'AddKey':
      sink.addKey(arg(0), args[1] ? arg(1) : undefined, args[2] ? arg(2) : undefined);
      return;
    case 'AddCondKey': sink.addCondKey(arg(0), arg(1)); return;
    case 'RemoveKey': sink.removeKey(arg(0)); return;
    case 'RemoveAllKey': return;                        // server-side concept; emit layer handles the prefix
    case 'Exit': sink.exit(); return;
    case 'LaunchQuest': sink.launchQuest(); return;
    case 'BeginQuest': sink.beginQuest(arg(0)); return;
    case 'EndQuest': sink.endQuest(arg(0)); return;
    case 'ChangeJob': sink.changeJob(arg(0)); return;
    case 'InitStat': sink.initStat(); return;
    case 'CreateItem': sink.createItem(arg(0), arg(1)); return;
    case 'RemoveAllItem': sink.removeAllItem(arg(0)); return;
    case 'SetScriptTimer':
    case 'SetTimer':
    case 'IsTimeOut':
    case 'SetMark':
    case 'GoMark':
    case 'PrintSystemMessage':
      return; // no-op / client-only system message -- deferred
    case 'MonHuntStart':
      // Never appears in statement position in the shipped scripts (it is always
      // compared), but routed rather than falling through to the unknown-function
      // log so that a script which does call it bare still opens the arena.
      b.monHuntStart(arg(0), arg(1), arg(2), arg(3));
      return;
    default:
      logger.debug({ fn: name }, 'interp: unknown statement function -> ignored');
  }
}

function execStmts(stmts: Stmt[], b: DialogInterpBindings, sink: DialogInterpSink): void {
  for (const s of stmts) {
    if (s.k === 'if') {
      const taken = evalExpr(s.cond, b) !== 0 ? s.then : s.else;
      if (taken) execStmts(taken, b, sink);
    } else if (s.k === 'block') {
      execStmts(s.body, b, sink);
    } else if (s.k === 'call') {
      execCall(s, b, sink);
    }
  }
}

/**
 * Interpret a dialog `source:` body. Emits side effects to `sink`; never throws
 * -- a malformed body logs at debug and emits nothing, so the click degrades to
 * an empty menu rather than crashing the dialog pipeline.
 */
export function interpretDialog(
  source: string,
  bindings: DialogInterpBindings,
  sink: DialogInterpSink,
): void {
  let ast: Stmt[];
  try {
    ast = new Parser(tokenize(source)).parseProgram();
  } catch (err) {
    logger.warn({ err: (err as Error).message, source: source.slice(0, 120) }, 'interp: parse failed');
    return;
  }
  try {
    execStmts(ast, bindings, sink);
  } catch (err) {
    logger.warn({ err: (err as Error).message, source: source.slice(0, 120) }, 'interp: eval failed');
  }
}
