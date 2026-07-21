/**
 * CommandService — `/cmd` router for `PACKETTYPE_CHAT`.
 *
 * Mirrors `ParsingCommand` (`_Interface/FuncTextCmd.cpp:4458`): tokenize the
 * slash-line, match the command name case-insensitively, gate on authority
 * (`cmd.auth <= player.m_bAuthority`), dispatch. Unknown / no-auth lines are
 * dropped silently — stock v15 sends no error reply.
 *
 * Implemented commands (subset that works without inventory/combat/party):
 *   `/w <name> <msg>`     GENERAL       whisper (both peers receive)
 *   `/s <msg>`            GENERAL       shout (server-wide)
 *   `/te <name|x z>`      GAMEMASTER    teleport self to player or coords
 *   `/su <name>`          GAMEMASTER    summon target to self
 *   `/sys <msg>`          GAMEMASTER2   yellow notice to all
 *   `/lv <level>`         ADMINISTRATOR set own level
 *
 * ponytail: `/ci` `/gg` `/k` `/out` need inventory/gold/combat/disconnect
 * pipelines — add when those systems land. `/p` `/g` need party/guild.
 *
 * No WAL (rule 04 — chat/commands are not journaled; level is, but the level
 * system owns its own journaling when it ships).
 *
 * @module services/command.service
 */

import type { CPlayer, Vec3 } from '../entities/player.js';
import type { PlayerManager } from '../managers/player.manager.js';
import { AUTH, hasAuthority } from '../constants/authority.js';
import { Validate } from '@flyff/core/utils/validate.js';
import { PacketError } from '@flyff/core/errors.js';
import { WI_WORLD_MADRIGAL } from '../net/snapshot/constants.js';
import { WhisperSerializer } from '../net/snapshot/whisper.serializer.js';
import { ShoutSerializer } from '../net/snapshot/shout.serializer.js';
import { ReturnSaySerializer, RETURN_SELF_TARGET, RETURN_NOT_FOUND } from '../net/snapshot/returnSay.serializer.js';
import { ReplaceSerializer } from '../net/snapshot/replace.serializer.js';
import { NoticeSerializer } from '../net/snapshot/notice.serializer.js';

export interface CommandServiceDeps {
  playerManager: PlayerManager;
}

export type CommandOutcome =
  | { ok: true; handled: true }
  | { ok: false; reason: 'no_auth' | 'unknown' };

interface CommandCtx {
  args: string;
  player: CPlayer;
}

interface CommandEntry {
  names: string[];
  auth: number;
  run: (ctx: CommandCtx) => void;
}

// C++ caps: whisper 260 (TextCmd_whisper:1259), shout 1024, system 512
// (TextCmd_System:2846). Level 1..MAX_LEGEND_LEVEL (ponytail: 150 ceiling).
const MAX_WHISPER_LEN = 260;
const MAX_SHOUT_LEN = 1024;
const MAX_NOTICE_LEN = 512;
const MIN_LEVEL = 1;
const MAX_LEVEL = 150;

export class CommandService {
  private readonly whisperSer = new WhisperSerializer();
  private readonly shoutSer = new ShoutSerializer();
  private readonly returnSaySer = new ReturnSaySerializer();
  private readonly replaceSer = new ReplaceSerializer();
  private readonly noticeSer = new NoticeSerializer();

  private readonly commands: CommandEntry[];

  constructor(private readonly deps: CommandServiceDeps) {
    this.commands = [
      { names: ['w', 'whisper'], auth: AUTH.GENERAL, run: (c) => this.whisper(c) },
      { names: ['say'], auth: AUTH.GENERAL, run: (c) => this.whisper(c) },
      { names: ['s', 'shout'], auth: AUTH.GENERAL, run: (c) => this.shout(c) },
      { names: ['te', 'tele', 'teleport'], auth: AUTH.GAMEMASTER, run: (c) => this.teleport(c) },
      { names: ['su', 'summon'], auth: AUTH.GAMEMASTER, run: (c) => this.summon(c) },
      { names: ['sys', 'system'], auth: AUTH.GAMEMASTER2, run: (c) => this.system(c) },
      { names: ['lv', 'level'], auth: AUTH.ADMINISTRATOR, run: (c) => this.level(c) },
    ];
  }

  /** Route a `/cmd rest` line. Returns whether a command handled it. */
  route(player: CPlayer, text: string): CommandOutcome {
    const parsed = parseCommand(text);
    if (!parsed) return { ok: false, reason: 'unknown' };
    const entry = this.lookup(parsed.name);
    if (!entry) return { ok: false, reason: 'unknown' };
    if (!hasAuthority(player.m_bAuthority, entry.auth)) return { ok: false, reason: 'no_auth' };
    entry.run({ args: parsed.args, player });
    return { ok: true, handled: true };
  }

  private lookup(name: string): CommandEntry | undefined {
    for (const cmd of this.commands) {
      if (cmd.names.includes(name)) return cmd;
    }
    return undefined;
  }

  // --- commands -------------------------------------------------------------

  /** `/w <name> <msg>` — TextCmd_whisper (FuncTextCmd.cpp:1229). */
  private whisper({ args, player }: CommandCtx): void {
    const split = splitTargetMessage(args);
    if (!split) return;
    if (isSelf(player, split.target)) {
      this.returnSay(player, RETURN_SELF_TARGET, ' ');
      return;
    }
    const target = this.findPlayer(split.target);
    if (!target) {
      this.returnSay(player, RETURN_NOT_FOUND, split.target);
      return;
    }
    const text = split.message.slice(0, MAX_WHISPER_LEN);
    if (text.length === 0) return;
    const buf = this.whisperSer.build({
      fromName: player.m_szName,
      toName: target.m_szName,
      text,
      fromId: player.m_idPlayer,
      toId: target.m_idPlayer,
    });
    this.deps.playerManager.sendTo(player, buf);
    this.deps.playerManager.sendTo(target, buf);
  }

  /** `/s <msg>` — TextCmd_shout (FuncTextCmd.cpp:1510). Server-wide fan-out. */
  private shout({ args, player }: CommandCtx): void {
    const text = args.slice(0, MAX_SHOUT_LEN);
    if (text.length === 0) return;
    const buf = this.shoutSer.build({
      senderObjid: player.m_idPlayer,
      senderName: player.m_szName,
      text,
    });
    this.deps.playerManager.broadcastAll(buf);
  }

  /** `/te <name>` or `/te <x> <z>` — TextCmd_Teleport (FuncTextCmd.cpp:1873). */
  private teleport({ args, player }: CommandCtx): void {
    const tokens = args.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;
    if (/^\d+(\.\d+)?$/.test(tokens[0]!)) {
      const x = Number.parseFloat(tokens[0] ?? '');
      const z = Number.parseFloat(tokens[1] ?? '');
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      this.applyReplace(player, { x, y: 0, z });
      return;
    }
    const target = this.findPlayer(tokens[0]!);
    if (!target) {
      this.returnSay(player, RETURN_NOT_FOUND, tokens[0]!);
      return;
    }
    this.applyReplace(player, { ...target.m_vPos });
  }

  /** `/su <name>` — TextCmd_Summon (FuncTextCmd.cpp:1689). Move target to caller. */
  private summon({ args, player }: CommandCtx): void {
    const name = args.split(/\s+/)[0];
    if (!name) return;
    if (isSelf(player, name)) {
      this.returnSay(player, RETURN_SELF_TARGET, ' ');
      return;
    }
    const target = this.findPlayer(name);
    if (!target) {
      this.returnSay(player, RETURN_NOT_FOUND, name);
      return;
    }
    const pos: Vec3 = { ...player.m_vPos };
    target.m_vPos = pos;
    target._dirty.add('x');
    target._dirty.add('y');
    target._dirty.add('z');
    const buf = this.replaceSer.build(WI_WORLD_MADRIGAL, pos);
    this.deps.playerManager.sendTo(target, buf);
  }

  /** `/sys <msg>` — TextCmd_System (FuncTextCmd.cpp:2840). Yellow notice to all. */
  private system({ args }: CommandCtx): void {
    const text = args.slice(0, MAX_NOTICE_LEN);
    if (text.length === 0) return;
    const buf = this.noticeSer.build(text);
    this.deps.playerManager.broadcastAll(buf);
  }

  /** `/lv <level>` — TextCmd_Level (FuncTextCmd.cpp:833). Sets own level. */
  private level({ args, player }: CommandCtx): void {
    const n = Number.parseInt(args.split(/\s+/)[0] ?? '', 10);
    if (!Number.isInteger(n) || n < MIN_LEVEL || n > MAX_LEVEL) return;
    player.m_nLevel = n;
    player._dirty.add('level');
    // ponytail: emit SETLEVEL/SETEXPERIENCE snapshot + recompute HP/MP when the
    // leveling system lands. For now the field flips + flushes on the 30s dirty.
  }

  // --- helpers --------------------------------------------------------------

  /** Move `player` to `pos` + send REPLACE snapshot (CUser::AddReplace). */
  private applyReplace(player: CPlayer, pos: Vec3): void {
    try {
      Validate.pos(pos.x, pos.y, pos.z);
    } catch {
      return;
    }
    player.m_vPos = pos;
    player._dirty.add('x');
    player._dirty.add('y');
    player._dirty.add('z');
    const buf = this.replaceSer.build(WI_WORLD_MADRIGAL, pos);
    this.deps.playerManager.sendTo(player, buf);
  }

  private findPlayer(name: string): CPlayer | undefined {
    try {
      Validate.name(name);
    } catch (error) {
      // Bad charset/length → behave as "not found" rather than throwing.
      if (error instanceof PacketError) return undefined;
      throw error;
    }
    return this.deps.playerManager.getByName(name);
  }

  private returnSay(player: CPlayer, flag: number, name: string): void {
    const buf = this.returnSaySer.build(player.m_idPlayer, flag, name);
    this.deps.playerManager.sendTo(player, buf);
  }
}

/** Tokenize `/cmd  rest of line` → `{ name, args }`. Returns null if bare `/`. */
function parseCommand(text: string): { name: string; args: string } | null {
  const body = text.slice(1).trimStart();
  if (!body) return null;
  const match = body.match(/^(\S+)\s*(.*)$/s);
  if (!match) return { name: body.toLowerCase(), args: '' };
  return { name: match[1]!.toLowerCase(), args: match[2] ?? '' };
}

/** Split `"name rest of message"` → `{ target, message }`. Null if no message. */
function splitTargetMessage(args: string): { target: string; message: string } | null {
  const match = args.match(/^(\S+)\s+(.*)$/s);
  if (!match) return null;
  return { target: match[1]!, message: match[2]! };
}

function isSelf(player: CPlayer, name: string): boolean {
  return name.toLowerCase() === player.m_szName.toLowerCase();
}
