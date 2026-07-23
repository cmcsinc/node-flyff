/**
 * CommandService -- `/cmd` router for `PACKETTYPE_CHAT`.
 *
 * Mirrors `ParsingCommand` (`_Interface/FuncTextCmd.cpp:4458`): tokenize the
 * slash-line, match the command name case-insensitively, gate on authority
 * (`cmd.auth <= player.m_bAuthority`), dispatch. Unknown / no-auth lines are
 * dropped silently -- stock v15 sends no error reply.
 *
 * Implemented commands (subset that works without inventory/combat/party):
 *   `/w <name> <msg>`     GENERAL       whisper (both peers receive)
 *   `/s <msg>`            GENERAL       shout (server-wide)
 *   `/te <name|x z>`      GAMEMASTER    teleport self to player or coords
 *   `/su <name>`          GAMEMASTER    summon target to self
 *   `/sys <msg>`          GAMEMASTER2   yellow notice to all
 *   `/lv <level>`         ADMINISTRATOR set own level
 *   `/undying` `/noud`    ADMINISTRATOR toggle MATCHLESS (undying) mode bit
 *   `/invisible` `/inv`   GAMEMASTER    toggle TRANSPARENT (invisible) mode bit
 *   `/noinvisible` `/noinv` GAMEMASTER  clear invisibility
 *   `/count` `/cnt`       GAMEMASTER    report live player + monster counts
 *   `/rtg <n>`            ADMINISTRATOR remove n gold
 *   `/rn <objid>`         ADMINISTRATOR despawn an NPC/mover (DEL_OBJ)
 *   `/disguise` `/dis` <id> ADMINISTRATOR transform into propMover id
 *   `/nodisguise` `/nodis` ADMINISTRATOR clear disguise
 *   `/bq /eq /qs /rq /raq /rcq` ADMINISTRATOR quest admin (GM3 in C++)
 *   `/ok` `/nook`         ADMINISTRATOR toggle ONEKILL mode bit (GM3 in C++)
 *   `/es`                 ADMINISTRATOR toggle EXPUP_STOP mode bit
 *   `/gmitem` `/gmnotitem` ADMINISTRATOR toggle ITEM mode bit
 *   `/gmattck` `/gmnotattck` ADMINISTRATOR toggle NO_ATTACK mode bit
 *   `/gmcommunity` `/gmnotcommunity` ADMINISTRATOR toggle COMMUNITY mode bit
 *   `/gmobserve` `/gmnotobserve` ADMINISTRATOR toggle OBSERVE composite bits
 *   `/out <name>`         GAMEMASTER2   disconnect a named player
 *   `/ak`                 ADMINISTRATOR kill monsters within 64m (GM3 in C++)
 *   `/ci <itemId> [n]`    ADMINISTRATOR create item into first free bag slot
 *   `/ul`                 ADMINISTRATOR list live player names (GM2 in C++)
 *   `/stat <str|sta|dex|int|all> <n>` ADMINISTRATOR set + persist an attribute
 *
 * ponytail: `/p` `/g` need party/guild; `/freeze` `/mute` `/talk` `/notalk`
 * need a per-target mode pipeline (target-named, not self); `/cjob` needs a
 * `characterRepo.updateJob`; `/pet*` need a pet system; `/ci` name lookup +
 * IK3_VIRTUAL/IK3_EGG validation once a propItem gate ships; Onekill/ExpUpStop
 * bit effects (damage short-circuit / exp early-out) hook into combat once
 * wired. Quest admin + disguise + stat are self-target only until a named-
 *
 * No WAL (rule 04 -- chat/commands are not journaled; level is, but the level
 * system owns its own journaling when it ships).
 *
 * @module services/command.service
 */

import type { CPlayer, Vec3 } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { SpawnManager } from '@flyff/world-core';
import type { QuestService } from './quest.service';
import type { InventoryService } from './inventory.service';
import type { CharacterRepository, InventoryRepository } from '@flyff/database';
import { AUTH, hasAuthority } from '@flyff/entities';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { MAX_GOLD } from '@flyff/core';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import {
  NULL_ID, SNAPSHOTTYPE_SETPOINTPARAM, DST_GOLD,
  SNAPSHOTTYPE_DEL_OBJ,
} from '@flyff/world-core';
import { WhisperSerializer } from '../net/snapshot/whisper.serializer';
import { ShoutSerializer } from '../net/snapshot/shout.serializer';
import { ReturnSaySerializer, RETURN_SELF_TARGET, RETURN_NOT_FOUND } from '../net/snapshot/returnSay.serializer';
import { SetPosSerializer } from '../net/snapshot/setPos.serializer';
import { NoticeSerializer } from '../net/snapshot/notice.serializer';
import { ModifyModeSerializer } from '../net/snapshot/modifyMode.serializer';
import { DisguiseSerializer } from '../net/snapshot/disguise.serializer';
import { CreateItemSnapshotSerializer } from '../net/snapshot/createItem.serializer';
import { SetStateSerializer } from '../net/snapshot/setState.serializer';
import { MODE } from '@flyff/entities';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'command-service' });

/** Minimal WAL-journal sink -- gold mutations must be journaled before ack (rule 04). */
export interface CommandJournal {
  append(entry: { charId: number; type: string; payload: unknown }): void;
}

export interface CommandServiceDeps {
  playerManager: PlayerManager;
  /** Spawn manager -- `/rn` (despawn) + `/cnt` (monster count) + `/ak` (radius kill). */
  spawnManager: SpawnManager;
  /** Quest service -- `/bq /eq /qs /rq /raq /rcq` admin. */
  questService: QuestService;
  /** Inventory service -- `/ci` (create item into main bag). */
  inventoryService?: InventoryService;
  /** Character repo -- `/stat` persists STR/STA/DEX/INT. */
  charRepo?: Pick<CharacterRepository, 'updateStats'>;
  /** Inventory container repo -- `/gg`/`/rtg` persist carried gold (migration 008). */
  inventoryRepo?: Pick<InventoryRepository, 'setGold'>;
  /** WAL journal -- appended before any gold mutation (rule 04). Optional: no-op if absent. */
  journal?: CommandJournal;
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
/** `TextCmd_AroundKill` radius (FuncTextCmd.cpp:373 -- `SendDamageAround(...,64.0f)`). */
const AROUND_KILL_RADIUS = 64.0;
/** Single-stat ceiling for `/stat` -- C++ clamps via the broader stat pipeline. */
const MAX_STAT = 999;

export class CommandService {
  private readonly whisperSer = new WhisperSerializer();
  private readonly shoutSer = new ShoutSerializer();
  private readonly returnSaySer = new ReturnSaySerializer();
  private readonly setPosSer = new SetPosSerializer();
  private readonly noticeSer = new NoticeSerializer();
  private readonly modifyModeSer = new ModifyModeSerializer();
  private readonly disguiseSer = new DisguiseSerializer();
  private readonly createItemSer = new CreateItemSnapshotSerializer();
  private readonly setStateSer = new SetStateSerializer();

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
      { names: ['gg', 'getgold'], auth: AUTH.ADMINISTRATOR, run: (c) => this.gold(c) },
      { names: ['undying', 'ud'], auth: AUTH.ADMINISTRATOR, run: (c) => this.undying(c, true) },
      { names: ['noundying', 'noud'], auth: AUTH.ADMINISTRATOR, run: (c) => this.undying(c, false) },
      { names: ['invisible', 'inv'], auth: AUTH.GAMEMASTER, run: (c) => this.invisible(c, true) },
      { names: ['noinvisible', 'noinv'], auth: AUTH.GAMEMASTER, run: (c) => this.invisible(c, false) },
      { names: ['count', 'cnt'], auth: AUTH.GAMEMASTER, run: (c) => this.count(c) },
      { names: ['rtg'], auth: AUTH.ADMINISTRATOR, run: (c) => this.removeTotalGold(c) },
      { names: ['rmvnpc', 'rn'], auth: AUTH.ADMINISTRATOR, run: (c) => this.removeNpc(c) },
      { names: ['disguise', 'dis'], auth: AUTH.ADMINISTRATOR, run: (c) => this.disguise(c, true) },
      { names: ['nodisguise', 'nodis'], auth: AUTH.ADMINISTRATOR, run: (c) => this.disguise(c, false) },
      { names: ['onekill', 'ok'], auth: AUTH.ADMINISTRATOR, run: (c) => this.onekill(c, true) },
      { names: ['noonekill', 'nook'], auth: AUTH.ADMINISTRATOR, run: (c) => this.onekill(c, false) },
      { names: ['expupstop', 'es'], auth: AUTH.ADMINISTRATOR, run: (c) => this.expUpStop(c) },
      { names: ['gmitem'], auth: AUTH.ADMINISTRATOR, run: (c) => this.modeToggle(c, MODE.ITEM, true) },
      { names: ['gmnotitem'], auth: AUTH.ADMINISTRATOR, run: (c) => this.modeToggle(c, MODE.ITEM, false) },
      { names: ['gmattck'], auth: AUTH.ADMINISTRATOR, run: (c) => this.modeToggle(c, MODE.NO_ATTACK, true) },
      { names: ['gmnotattck'], auth: AUTH.ADMINISTRATOR, run: (c) => this.modeToggle(c, MODE.NO_ATTACK, false) },
      { names: ['gmcommunity'], auth: AUTH.ADMINISTRATOR, run: (c) => this.modeToggle(c, MODE.COMMUNITY, true) },
      { names: ['gmnotcommunity'], auth: AUTH.ADMINISTRATOR, run: (c) => this.modeToggle(c, MODE.COMMUNITY, false) },
      { names: ['gmobserve'], auth: AUTH.ADMINISTRATOR, run: (c) => this.modeToggle(c, MODE.OBSERVE, true) },
      { names: ['gmnotobserve'], auth: AUTH.ADMINISTRATOR, run: (c) => this.modeToggle(c, MODE.OBSERVE, false) },
      { names: ['out'], auth: AUTH.GAMEMASTER2, run: (c) => this.out(c) },
      { names: ['aroundkill', 'ak'], auth: AUTH.ADMINISTRATOR, run: (c) => this.aroundKill(c) },
      { names: ['createitem', 'ci'], auth: AUTH.ADMINISTRATOR, run: (c) => this.createItem(c) },
      { names: ['userlist', 'ul'], auth: AUTH.ADMINISTRATOR, run: (c) => this.userList(c) },
      { names: ['stat'], auth: AUTH.ADMINISTRATOR, run: (c) => { void this.stat(c); } },
      { names: ['beginquest', 'bq'], auth: AUTH.ADMINISTRATOR, run: (c) => { void this.questCmd(c, 'begin'); } },
      { names: ['endquest', 'eq'], auth: AUTH.ADMINISTRATOR, run: (c) => { void this.questCmd(c, 'end'); } },
      { names: ['queststate', 'qs'], auth: AUTH.ADMINISTRATOR, run: (c) => { void this.questCmd(c, 'state'); } },
      { names: ['removequest', 'rq'], auth: AUTH.ADMINISTRATOR, run: (c) => { void this.questCmd(c, 'cancel'); } },
      { names: ['removeallquest', 'raq'], auth: AUTH.ADMINISTRATOR, run: (c) => { void this.questCmd(c, 'removeAll'); } },
      { names: ['removecompletequest', 'rcq'], auth: AUTH.ADMINISTRATOR, run: (c) => { void this.questCmd(c, 'removeComplete'); } },
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

  /** `/w <name> <msg>` -- TextCmd_whisper (FuncTextCmd.cpp:1229). */
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

  /** `/s <msg>` -- TextCmd_shout (FuncTextCmd.cpp:1510). Server-wide fan-out. */
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

  /**
   * `/te <name>` | `/te <x> <z>` | `/teleport <worldId> <x> <z>` --
   * TextCmd_Teleport (FuncTextCmd.cpp:2362). The Navigator minimap GM double-
   * click sends the 3-arg form (`WndField.cpp:10049`: `/teleport <worldId>
   * x z`); 2-arg is the manual shorthand. First token non-numeric => teleport
   * to that player. Coords must satisfy `x > 0 && z > 0` (C++ `VecInWorld`
   * guard, FuncTextCmd.cpp:2439) -- the old parser read `<worldId>` as x and
   * dropped the real z, landing GMs at (1, ...) off the terrain. `worldId` is
   * accepted but ignored (single-world Madrigal for now; cross-world REPLACE
   * ponytail).
   */
  private teleport({ args, player }: CommandCtx): void {
    const tokens = args.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;
    if (/^\d+(\.\d+)?$/.test(tokens[0]!)) {
      // 3 tokens => Navigator client form `<worldId> <x> <z>`; 2 => manual `<x> <z>`.
      const xIdx = tokens.length >= 3 ? 1 : 0;
      const zIdx = tokens.length >= 3 ? 2 : 1;
      const x = Number.parseFloat(tokens[xIdx] ?? '');
      const z = Number.parseFloat(tokens[zIdx] ?? '');
      if (!Number.isFinite(x) || !Number.isFinite(z) || x <= 0 || z <= 0) return;
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

  /** `/su <name>` -- TextCmd_Summon (FuncTextCmd.cpp:1689). Move target to caller. */
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
    // SETPOS (not REPLACE): same-world teleport must not null g_pPlayer
    // (OnReplace DPClient.cpp:2352 -> CWndQuestQuickInfo::Process:259 crash).
    const buf = this.setPosSer.build(target.m_idPlayer, pos);
    this.deps.playerManager.sendTo(target, buf);
  }

  /** `/sys <msg>` -- TextCmd_System (FuncTextCmd.cpp:2840). Yellow notice to all. */
  private system({ args }: CommandCtx): void {
    const text = args.slice(0, MAX_NOTICE_LEN);
    if (text.length === 0) return;
    const buf = this.noticeSer.build(text);
    this.deps.playerManager.broadcastAll(buf);
  }

  /** `/lv <level>` -- TextCmd_Level (FuncTextCmd.cpp:833). Sets own level. */
  private level({ args, player }: CommandCtx): void {
    const n = Number.parseInt(args.split(/\s+/)[0] ?? '', 10);
    if (!Number.isInteger(n) || n < MIN_LEVEL || n > MAX_LEVEL) return;
    player.m_nLevel = n;
    player._dirty.add('level');
    // ponytail: emit SETLEVEL/SETEXPERIENCE snapshot + recompute HP/MP when the
    // leveling system lands. For now the field flips + flushes on the 30s dirty.
  }

  /**
   * `/gg <amount>` -- TextCmd_GetGold (FuncTextCmd.cpp:2579). Adds (or removes,
   * if negative) gold, clamped to `[0, MAX_GOLD]` -- mirrors `CMover::AddGold`
   * (Mover.cpp:607). WAL-journals the absolute total before ack (rule 04), then
   * notifies the client via SetPointParam(DST_GOLD) so the balance updates live.
   */
  private gold({ args, player }: CommandCtx): void {
    const n = Number.parseInt(args.split(/\s+/)[0] ?? '', 10);
    if (!Number.isInteger(n) || n === 0) return;
    const total = Math.max(0, Math.min(MAX_GOLD, player.m_nGold + n));
    player.m_nGold = total;
    player._dirty.add('m_nGold');
    this.deps.journal?.append({
      charId: player.m_idPlayer,
      type: 'CHAR_GOLD',
      payload: { gold: total },
    });
    this.deps.inventoryRepo?.setGold(player.m_idPlayer, total)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, gold: total }, '/gg gold persist failed'));
    this.deps.playerManager.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_GOLD, total));
  }

  /**
   * `/undying` / `/noundying` -- `TextCmd_Undying` / `TextCmd_NoUndying`
   * (FuncTextCmd.cpp:3105 / 2977). Toggles the `MATCHLESS_MODE` bit in
   * `m_dwMode` (authorization.h:20) -- C++ sets MATCHLESS and clears the
   * tier-2 MATCHLESS2 on enable, clears both on disable. Broadcasts
   * `SNAPSHOTTYPE_MODIFYMODE` so peers re-render the mover.
   *
   * Auth is `AUTH_GAMEMASTER3` in C++ ('N'); collapsed to ADMINISTRATOR here
   * until intermediate authority tiers ship (see constants/authority.ts). No
   * WAL -- `m_dwMode` is transient.
   * MATCHLESS effect lives in `AISystem.monsterSwing` -- the invincible check
   * there skips HP subtraction while keeping the swing anim + DAMAGE broadcast.
   * ONEKILL (the `/ok` sibling) is honored in `CombatService.resolveAttack`
   * (combat.service.ts) -- a ONEKILL attacker's swing is forced lethal.
   */
  private undying({ player }: CommandCtx, enable: boolean): void {
    if (enable) {
      player.m_dwMode = (player.m_dwMode & ~MODE.MATCHLESS2) | MODE.MATCHLESS;
    } else {
      player.m_dwMode = player.m_dwMode & ~(MODE.MATCHLESS | MODE.MATCHLESS2);
    }
    const buf = this.modifyModeSer.build(player.m_idPlayer, player.m_dwMode);
    this.deps.playerManager.broadcastAll(buf);
  }

  /**
   * `/invisible` `/inv` / `/noinvisible` `/noinv` -- `TextCmd_Invisible` /
   * `TextCmd_NoInvisible` (FuncTextCmd.cpp:2959 / 2968). Toggles the
   * `TRANSPARENT_MODE` bit in `m_dwMode` (authorization.h:21) and broadcasts
   * `MODIFYMODE`. Self-render is unaffected; peers stop drawing the mover.
   * No WAL -- `m_dwMode` is transient.
   */
  private invisible({ player }: CommandCtx, enable: boolean): void {
    player.m_dwMode = enable
      ? (player.m_dwMode | MODE.TRANSPARENT)
      : (player.m_dwMode & ~MODE.TRANSPARENT);
    const buf = this.modifyModeSer.build(player.m_idPlayer, player.m_dwMode);
    this.deps.playerManager.broadcastAll(buf);
  }

  /**
   * `/count` `/cnt` -- `TextCmd_count` (FuncTextCmd.cpp:3631). Reports live player
   * + monster counts to the caller via `AddText` (per-user TEXT snapshot). C++
   * also fires a cluster `GetPlayerCount` query; we only have the local world
   * count (ponytail: fan out cross-server when IPC player-count ships).
   */
  private count({ player }: CommandCtx): void {
    const text = `Players online: ${this.deps.playerManager.all().length}  Monsters: ${this.deps.spawnManager.size}`;
    this.deps.playerManager.sendTo(player, this.noticeSer.build(text));
  }

  /**
   * `/rtg <amount>` -- `TextCmd_RemoveTotalGold` (FuncTextCmd.cpp:4517). Removes
   * `amount` from gold (clamped at 0). Mirrors `/gg` in reverse: WAL-journal the
   * new total (rule 04) + SetPointParam(DST_GOLD). If `amount > total`, C++ just
   * prints the current total -- we do the same via AddText.
   */
  private removeTotalGold({ args, player }: CommandCtx): void {
    const n = Number.parseInt(args.split(/\s+/)[0] ?? '', 10);
    if (!Number.isInteger(n) || n <= 0) return;
    if (n > player.m_nGold) {
      this.deps.playerManager.sendTo(player, this.noticeSer.build(`Penya: ${player.m_nGold}`));
      return;
    }
    const total = player.m_nGold - n;
    player.m_nGold = total;
    player._dirty.add('m_nGold');
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: total } });
    this.deps.inventoryRepo?.setGold(player.m_idPlayer, total)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, gold: total }, '/rtg gold persist failed'));
    this.deps.playerManager.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_GOLD, total));
  }

  /**
   * `/rn <objid>` -- `TextCmd_RemoveNpc` (FuncTextCmd.cpp:2479). Despawns an NPC
   * by objid (`pMover->Delete()`): `spawnManager.kill` drops it + cancels any
   * respawn, then `DEL_OBJ` broadcasts the removal. C++ gates on `IsNPC()`; we
   * accept any spawned mover (monsters included) -- the GM picks the target.
   */
  private removeNpc({ args, player }: CommandCtx): void {
    const objid = Number.parseInt(args.split(/\s+/)[0] ?? '', 10);
    if (!Number.isInteger(objid) || objid <= 0) return;
    const mover = this.deps.spawnManager.get(objid);
    if (!mover) return;
    this.deps.spawnManager.kill(objid);
    this.deps.playerManager.broadcastAll(buildRemoveObj(objid));
  }

  /**
   * `/disguise <id>` `/dis` / `/nodisguise` `/nodis` -- `TextCmd_Disguise` /
   * `TextCmd_NoDisguise` (FuncTextCmd.cpp:3159 / 3139). Sets/clears the disguise
   * propMover index + broadcasts DISGUISE/NODISGUISE. C++ resolves the mover by
   * name OR id; we take a numeric id only (ponytail: propMover name lookup).
   */
  private disguise({ args, player }: CommandCtx, enable: boolean): void {
    if (!enable) {
      player.m_dwDisguise = 0;
      this.deps.playerManager.broadcastAll(this.disguiseSer.buildClear(player.m_idPlayer));
      return;
    }
    const idx = Number.parseInt(args.split(/\s+/)[0] ?? '', 10);
    if (!Number.isInteger(idx) || idx <= 0) return;
    player.m_dwDisguise = idx;
    this.deps.playerManager.broadcastAll(this.disguiseSer.build(player.m_idPlayer, idx));
  }

  /**
   * Quest admin batch -- `/bq /eq /qs /rq /raq /rcq` (FuncTextCmd.cpp:3959+).
   * Each is `AUTH_GAMEMASTER3` in C++ ('N'); collapsed to ADMINISTRATOR here.
   * Self-targeting (C++ also supports a trailing player name; ponytail). All
   * mutate via QuestService (which persists + audit-logs) and forward the
   * returned snapshot frames to the caller. Silent on failure -- stock v15 sends
   * no error reply for most quest-admin branches.
   */
  private async questCmd(
    { args, player }: CommandCtx,
    op: 'begin' | 'end' | 'state' | 'cancel' | 'removeAll' | 'removeComplete',
  ): Promise<void> {
    const tokens = args.split(/\s+/).filter(Boolean);
    const questId = Number.parseInt(tokens[0] ?? '', 10);
    if (op !== 'removeAll' && op !== 'removeComplete' && !Number.isInteger(questId)) return;
    const qs = this.deps.questService;
    let res;
    switch (op) {
      case 'begin': res = await qs.beginQuest(player, questId); break;
      case 'end': res = await qs.endQuest(player, questId); break;
      case 'state': {
        const state = Number.parseInt(tokens[1] ?? '', 10);
        if (!Number.isInteger(state)) return;
        res = await qs.setQuestState(player, questId, state);
        break;
      }
      case 'cancel': res = await qs.cancelQuest(player, questId); break;
      case 'removeAll': res = await qs.removeAllQuests(player); break;
      case 'removeComplete': res = await qs.removeCompleteQuests(player); break;
    }
    if (res?.ok) for (const f of res.frames) this.deps.playerManager.sendTo(player, f);
  }

  /**
   * `/onekill` `/ok` / `/noonekill` `/nook` -- `TextCmd_Onekill` /
   * `TextCmd_NoOnekill` (FuncTextCmd.cpp:3541 / 3567). Toggles the
   * `ONEKILL_MODE` bit (authorization.h:22) + broadcasts MODIFYMODE. C++ gates
   * at `AUTH_GAMEMASTER3`; collapsed to ADMINISTRATOR. The one-shot kill effect
   * is honored in `CombatService.resolveAttack` -- an ONEKILL attacker's swing
   * is forced to the mover's full current HP (lethal regardless of the roll).
   */
  private onekill(ctx: CommandCtx, enable: boolean): void {
    this.modeToggle(ctx, MODE.ONEKILL, enable);
  }

  /**
   * `/expupstop` `/es` -- `TextCmd_ExpUpStop` (FuncTextCmd.cpp:2989). TOGGLES
   * `MODE_EXPUP_STOP` (no /no pair -- C++ flips on each call). Exp grant should
   * early-out while set (ponytail: honored once `CombatService.grantExp`
   * checks the bit; today the bit flips + re-renders only).
   */
  private expUpStop({ player }: CommandCtx): void {
    player.m_dwMode = player.m_dwMode & MODE.EXPUP_STOP
      ? player.m_dwMode & ~MODE.EXPUP_STOP
      : player.m_dwMode | MODE.EXPUP_STOP;
    this.deps.playerManager.broadcastAll(this.modifyModeSer.build(player.m_idPlayer, player.m_dwMode));
  }

  /**
   * Generic self-mode toggle -- `/gmitem` `/gmnotitem` (ITEM_MODE),
   * `/gmattck` `/gmnotattck` (NO_ATTACK_MODE), `/gmcommunity` `/gmnotcommunity`
   * (COMMUNITY_MODE), `/gmobserve` `/gmnotobserve` (OBSERVE composite).
   * `TextCmd_ItemMode`/`AttackMode`/`CommunityMode`/`ObserveMode`
   * (FuncTextCmd.cpp:3424/3444/3501/3521) each just OR/AND-and the bit and
   * `AddModifyMode`. `OBSERVE_MODE` is a composite (ITEM|NO_ATTACK|...) so the
   * clear path AND-ns the whole mask.
   */
  private modeToggle({ player }: CommandCtx, bits: number, enable: boolean): void {
    player.m_dwMode = enable
      ? player.m_dwMode | bits
      : player.m_dwMode & ~bits;
    this.deps.playerManager.broadcastAll(this.modifyModeSer.build(player.m_idPlayer, player.m_dwMode));
  }

  /**
   * `/out <name>` -- `TextCmd_Out` (FuncTextCmd.cpp:2449). Disconnect a named
   * peer: C++ routes via `g_DPCoreClient.SendKillPlayer` (cluster->world); in
   * this single-process emulator we destroy the target's socket directly +
   * drop it from the manager so cleanup runs the same path as a natural
   * disconnect. Self-target -> ReturnSay flag 2 (consistent with `/su`/`/te`).
   */
  private out({ args, player }: CommandCtx): void {
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
    target.socket.destroy?.();
    this.deps.playerManager.remove(target.m_idPlayer);
  }

  /**
   * `/ak` -- `TextCmd_AroundKill` (FuncTextCmd.cpp:364). C++ calls
   * `SendDamageAround(AF_MAGICSKILL, ..., OBJTYPE_MONSTER, 1, 64.0f, ...)` -- a
   * 64m AoE that rolls lethal damage. We collapse to an authoritative sweep:
   * every monster in the caller's zone within 64m is killed + DEL_OBJ
   * broadcast. Exp/drops are NOT granted (ponytail: route through
   * `CombatService` per-mover if GM-exp credit is wanted). C++ requires an
   * equipped weapon (`GetWeaponItem() == NULL => return`); we skip that gate
   * (no inventory-equip model yet).
   */
  private aroundKill({ player }: CommandCtx): void {
    const radius = AROUND_KILL_RADIUS;
    const r2 = radius * radius;
    const victims: number[] = [];
    for (const m of this.deps.spawnManager.inZone(player.m_nZoneId)) {
      if (m.m_bDead) continue;
      const d = distSq(m.m_vPos, player.m_vPos);
      if (d <= r2) victims.push(m.m_idMover);
    }
    if (victims.length === 0) return;
    const removeBuf = buildRemoveObjs(victims);
    for (const id of victims) this.deps.spawnManager.kill(id);
    this.deps.playerManager.broadcastAll(removeBuf);
  }

  /**
   * `/ci <itemId> [count]` -- `TextCmd_CreateItem` (FuncTextCmd.cpp:2522). C++
   * resolves the item by name OR id, validates non-IK3_VIRTUAL, then
   * `CreateItem` into the first free slot. We take a numeric `itemId` only
   * (ponytail: propItem name lookup) and delegate to `InventoryService.addItem`
   * (WAL + persist + state), then send the CREATEITEM snapshot on success. Bag
   * full -> silent (stock v15 prints `TID_GAME_LACKSPACE` via AddDefinedText;
   * omitted until a defined-text channel ships).
   */
  private createItem({ args, player }: CommandCtx): void {
    const inv = this.deps.inventoryService;
    if (inv === undefined) return;
    const tokens = args.split(/\s+/).filter(Boolean);
    const itemId = Number.parseInt(tokens[0] ?? '', 10);
    if (!Number.isInteger(itemId) || itemId <= 0) return;
    const count = Math.max(1, Number.parseInt(tokens[1] ?? '', 10) || 1);
    const res = inv.addItem(player, itemId, count);
    if (!res.ok) return;
    const buf = this.createItemSer.buildOne(player.m_idPlayer, res.itemId, res.count, res.slot);
    this.deps.playerManager.sendTo(player, buf);
  }

  /**
   * `/userlist` `/ul` -- `TextCmd_userlist` (FuncTextCmd.cpp:3622). C++ forwards
   * to the cluster for a cross-server list; we only have the local world, so
   * emit the live player names to the caller via TEXT/notice. `AddText` cap is
   * 512B (TEXT_GENERAL) -- names are joined comma-separated and sliced.
   */
  private userList({ player }: CommandCtx): void {
    const names = this.deps.playerManager.all().map((p) => p.m_szName).join(', ');
    const text = `Players (${this.deps.playerManager.size}): ${names}`.slice(0, MAX_NOTICE_LEN);
    this.deps.playerManager.sendTo(player, this.noticeSer.build(text));
  }

  /**
   * `/stat <str|sta|dex|int|all> <n>` -- `TextCmd_stat` (FuncTextCmd.cpp:912).
   * Sets the named attribute, clamped to `[0, MAX_STAT]`, persists via
   * `charRepo.updateStats`, marks the field dirty, and echoes `AddSetState`
   * (SETSTATE snapshot) so the client refreshes its stat window + recomputes
   * derived HP/MP/FP (matching the C++ tail at `FuncTextCmd.cpp:979`).
   * `restate`/`gp` branches skipped (no restate/gp pipeline).
   */
  private async stat({ args, player }: CommandCtx): Promise<void> {
    const tokens = args.split(/\s+/).filter(Boolean);
    const which = (tokens[0] ?? '').toLowerCase();
    const n = Number.parseInt(tokens[1] ?? '', 10);
    if (!Number.isInteger(n) || n < 0 || n > MAX_STAT) return;
    const set: Partial<Record<'strength' | 'stamina' | 'dexterity' | 'intelligence', number>> = {};
    switch (which) {
      case 'str': set.strength = n; player.m_nStr = n; break;
      case 'sta': set.stamina = n; player.m_nSta = n; break;
      case 'dex': set.dexterity = n; player.m_nDex = n; break;
      case 'int': set.intelligence = n; player.m_nInt = n; break;
      case 'all': set.strength = set.stamina = set.dexterity = set.intelligence = n;
        player.m_nStr = player.m_nSta = player.m_nDex = player.m_nInt = n; break;
      default: return;
    }
    player._dirty.add('strength'); player._dirty.add('stamina');
    player._dirty.add('dexterity'); player._dirty.add('intelligence');
    this.deps.playerManager.sendTo(
      player,
      this.setStateSer.build(player.m_idPlayer, {
        str: player.m_nStr, sta: player.m_nSta,
        dex: player.m_nDex, int: player.m_nInt,
        remainGP: player.m_nRemainGP,
      }),
    );
    await this.deps.charRepo?.updateStats(player.m_idPlayer, set);
  }

  // --- helpers --------------------------------------------------------------

  /** Move `player` to `pos` via SETPOS (CWorld::_replace same-world branch). */
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
    const buf = this.setPosSer.build(player.m_idPlayer, pos);
    this.deps.playerManager.sendTo(player, buf);
  }

  private findPlayer(name: string): CPlayer | undefined {
    try {
      Validate.name(name);
    } catch (error) {
      // Bad charset/length -> behave as "not found" rather than throwing.
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

/** Tokenize `/cmd  rest of line` -> `{ name, args }`. Returns null if bare `/`. */
function parseCommand(text: string): { name: string; args: string } | null {
  const body = text.slice(1).trimStart();
  if (!body) return null;
  const match = body.match(/^(\S+)\s*(.*)$/s);
  if (!match) return { name: body.toLowerCase(), args: '' };
  return { name: match[1]!.toLowerCase(), args: match[2] ?? '' };
}

/** Split `"name rest of message"` -> `{ target, message }`. Null if no message. */
function splitTargetMessage(args: string): { target: string; message: string } | null {
  const match = args.match(/^(\S+)\s+(.*)$/s);
  if (!match) return null;
  return { target: match[1]!, message: match[2]! };
}

function isSelf(player: CPlayer, name: string): boolean {
  return name.toLowerCase() === player.m_szName.toLowerCase();
}

/**
 * `SNAPSHOTTYPE_SETPOINTPARAM` (0x001e) -- `objid | SETPOINTPARAM | paramId:DWORD |
 * value:DWORD` (`CUserMng::AddSetPointParam`, User.cpp:3169). Used for the gold
 * balance (DST_GOLD) and other live stat updates.
 */
function buildSetPointParam(objid: number, paramId: number, value: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_SETPOINTPARAM);
  w.writeDword(paramId);
  w.writeDword(value);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_DEL_OBJ` (0x00f1) -- `CUser::AddRemoveObj` (User.cpp): bodyless
 * `objid | DEL_OBJ`. Tells clients to drop the mover from their scene; used by
 * `/rn` (despawn) so peers see the NPC vanish.
 */
function buildRemoveObj(objid: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_DEL_OBJ);
  return w.build();
}

/**
 * Batched `DEL_OBJ` -- one snapshot frame with N bodyless `objid | DEL_OBJ`
 * sub-entries (cb=N). Used by `/ak` so a single broadcast carries every slain
 * monster instead of N separate frames. Mirrors `CUserMng::AddRemoveObj`
 * fan-out pattern (one snapshot, multiple sub-records via the `cb` WORD).
 */
function buildRemoveObjs(objids: readonly number[]): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(objids.length);
  for (const id of objids) {
    w.writeDword(id);
    w.writeWord(SNAPSHOTTYPE_DEL_OBJ);
  }
  return w.build();
}

/** Squared 2D (x,z) distance -- `/ak` radius check skips Y (flat AoE, matches C++ `IsRangeObj`). */
function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
