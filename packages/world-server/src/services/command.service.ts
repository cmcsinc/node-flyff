/**
 * CommandService -- `/cmd` router for `PACKETTYPE_CHAT`.
 *
 * Mirrors `ParsingCommand` (`_Interface/FuncTextCmd.cpp:4458`): tokenize the
 * slash-line, match the command name case-insensitively, gate on authority
 * (`cmd.auth <= player.m_bAuthority`), dispatch. Unknown / no-auth lines are
 * dropped silently -- stock v19 sends no error reply.
 *
 * Implemented commands (subset that works without inventory/combat/party):
 *   `/w <name> <msg>`     GENERAL       whisper (both peers receive)
 *   `/s <msg>`            GENERAL       shout (server-wide)
 * Per-command auth tiers are the exact C++ values (`ON_TEXTCMDFUNC` rows,
 * FuncTextCmd.cpp 5159-5337; gate `cmd.auth <= player.auth`, WndCommand.cpp:61):
 *   `/te <name|x z>`      GAMEMASTER    teleport self to player or coords
 *   `/su <name>`          GAMEMASTER    summon target to self
 *   `/sys <msg>`          GAMEMASTER2   yellow notice to all
 *   `/lv <level>`         GAMEMASTER3   set own level
 *   `/undying` `/noud`    GAMEMASTER3   toggle MATCHLESS (undying) mode bit
 *   `/invisible` `/inv`   GAMEMASTER    toggle TRANSPARENT (invisible) mode bit
 *   `/noinvisible` `/noinv` GAMEMASTER  clear invisibility
 *   `/count` `/cnt`       GAMEMASTER    report live player + monster counts
 *   `/rtg <n>`            ADMINISTRATOR remove n gold
 *   `/rn <objid>`         GAMEMASTER3   despawn an NPC/mover (DEL_OBJ)
 *   `/cn <id|name> [n] [aggro]` GAMEMASTER3 spawn n monsters at own position
 *   `/disguise` `/dis` <id> ADMINISTRATOR transform into propMover id
 *   `/nodisguise` `/nodis` ADMINISTRATOR clear disguise
 *   `/bq /eq /rq /raq /rcq` GAMEMASTER3 quest admin; `/qs` ADMINISTRATOR
 *   `/ok` `/nook`         GAMEMASTER3   toggle ONEKILL mode bit
 *   `/es`                 ADMINISTRATOR toggle EXPUP_STOP mode bit
 *   `/gmitem` `/gmnotitem` ADMINISTRATOR toggle ITEM mode bit
 *   `/gmattck` `/gmnotattck` ADMINISTRATOR toggle NO_ATTACK mode bit
 *   `/gmcommunity` `/gmnotcommunity` ADMINISTRATOR toggle COMMUNITY mode bit
 *   `/gmobserve` `/gmnotobserve` ADMINISTRATOR toggle OBSERVE composite bits
 *   `/out <name>`         GAMEMASTER2   disconnect a named player
 *   `/ak`                 GAMEMASTER3   kill monsters within 64m
 *   `/ci <itemId> [n]`    ADMINISTRATOR create item into first free bag slot
 *   `/ul`                 ADMINISTRATOR list live player names
 *   `/stat <str|sta|dex|int|all> <n>` GAMEMASTER3 set + persist an attribute
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
import type { QuestService } from '@flyff/quest';
import type { InventoryService } from '@flyff/inventory';
import { buildUpdateItemCount } from '@flyff/inventory';
import type { CharacterRepository, InventoryRepository } from '@flyff/database';
import type { ItemDefinition, MoverDefinition, ZoneDefinition } from '@flyff/resources';
import { AUTH, hasAuthority } from '@flyff/entities';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { MAX_GOLD } from '@flyff/core';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { QS_BEGIN, QS_END } from '@flyff/core/constants/quest';
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
import { buildKickNotice, KICK_CLOSE_DELAY_MS } from '../net/snapshot/kick.serializer';
import { CreateItemSnapshotSerializer } from '@flyff/inventory';
import { SetStateSerializer, SetExperienceSerializer, SetLevelSerializer } from '@flyff/combat';
import { VISIBILITY_RADIUS } from '@flyff/world-core';
import type { VisibilityService } from '@flyff/world-core';
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
  /** Mover id/name -> definition lookup for `/cn` resolution. */
  lookupMover?: (token: string) => MoverDefinition | undefined;
  /** Quest service -- `/bq /eq /qs /rq /raq /rcq` admin. */
  questService: QuestService;
  /** Inventory service -- `/ci` (create item into main bag). */
  inventoryService?: InventoryService;
  /** Item name -> definition lookup for `/ci name` resolution. */
  getItemByName?: (name: string) => ItemDefinition | undefined;
  /** Character repo -- `/stat` persists STR/STA/DEX/INT, `/lv` persists level+exp. */
  charRepo?: Pick<CharacterRepository, 'updateStats' | 'updateLevelAndExp'>;
  /** Inventory container repo -- `/gg`/`/rtg` persist carried gold (migration 008). */
  inventoryRepo?: Pick<InventoryRepository, 'setGold'>;
  /** WAL journal -- appended before any gold mutation (rule 04). Optional: no-op if absent. */
  journal?: CommandJournal;
  /** Zone manager -- `/lv` vicinity SETLEVEL broadcast. Optional: self-only update if absent. */
  zoneManager?: { broadcastAround(pos: Vec3, zoneId: number, radius: number, pkt: Buffer, except?: unknown): number };
  /**
   * Visibility service -- same-world teleport (`/te` `/teleport` `/su`) must
   * re-diff the player's view at the destination: the client does not reload the
   * world on SETPOS, so without a refresh the old spawns linger and nothing at
   * the new spot appears. Optional: teleport skips the refresh if absent.
   */
  visibilityService?: Pick<VisibilityService, 'refresh'>;
  /**
   * Zone index -- `/te` reads it for two things C++ gets from `CWorld`:
   *  - `VecInWorld` (`World.cpp:1063`), the coord gate; and
   *  - a terrain height for the `y == 0` sentinel `CWorld::_replace`
   *    (`World.cpp:1568`) resolves via `GetFullHeight`.
   *
   * ponytail: the real `GetFullHeight`/`GetLandHeight` sample the `.lnd`
   *   heightmap (`WorldFile.cpp:832`, `World.cpp:982`). No `.lnd` parser exists
   *   in TS (same gap as `drop.service.ts:91` and `flight.service.ts:24`), so
   *   `groundY` approximates it from the nearest authored spawn/NPC y in the
   *   zone -- those ARE sampled terrain heights from the extractor. Swap this
   *   for `world.getLandHeight(x, z)` once the `.lnd` files under
   *   `game/client/World/` are parsed. Optional: absent = keep the caller's y.
   */
  zones?: { byNumericId: Map<number, ZoneDefinition> };
  /**
   * Guild service -- `/g` (guild chat) and `/cg` (GM guild create).
   *
   * Guild chat has no C->S opcode of its own: `TextCmd_GuildChat`
   * (`FuncTextCmd.cpp:1122`) is registered as `TCM_BOTH`, so the client turns
   * `/g <msg>` into a plain CHAT packet and the SERVER-side half of the same
   * command reads it back off the scanner and calls `SendGuildChat`. Routing it
   * here is that server-side half. Optional: `/g` and `/cg` are dropped if absent.
   */
  guildService?: {
    chat(sender: CPlayer, msg: string): void;
    create(master: CPlayer, name: string, memberIds?: readonly number[]): unknown;
  };
  /**
   * Guild-quest ledger writer -- `TextCmd_SetGuildQuest` / `sgq`
   * (`FuncTextCmd.cpp:1257-1286`, registered `AUTH_ADMINISTRATOR` at `:5345`).
   *
   * Deliberately NOT the arena opener: the C++ command touches only guild state
   * plus the DB row (`pGuild->SetQuest` + `SendUpdateGuildQuest`) and never calls
   * `CGuildQuestProcessor::SetGuildQuest`, so it spawns no boss and starts no
   * timer. Faithful.
   */
  guildQuest?: {
    setStateByGuildName(guildName: string, questId: number, state: number): boolean;
  };
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
/** `/cn` instance cap -- `TextCmd_CreateNPC`: `if( dwNum > 100 ) dwNum = 100`. */
const MAX_CREATE_NPC = 100;
/**
 * Mover `type`s `/cn` may spawn. C++ gates on `dwAI` being one of the monster
 * AI families (AII_MONSTER / CLOCKWORKS / BIGMUSCLE / KRRR / BEAR /
 * METEONYKER / ARENA_REAPER) -- i.e. anything that fights. Our converted data
 * carries `type`, not `dwAI`; `monster` + `boss` are its equivalent span
 * (`npc`/`pet`/`player` are the excluded rest).
 */
const SPAWNABLE_MOVER_TYPES: ReadonlySet<string> = new Set(['monster', 'boss', 'giant', 'raid']);
/** Single-stat ceiling for `/stat` -- C++ clamps via the broader stat pipeline. */
const MAX_STAT = 999;
/**
 * `CWorld::_replace`'s pre-raycast y (`World.cpp:1568`: `vPos.y = 100.0f;`
 * before `GetFullHeight`). Used as the fallback when no terrain sample exists.
 */
const SENTINEL_Y = 100;
/** `/te` refusal notices -- C++ drops these silently; a GM needs to see why. */
const TE_USAGE = 'Usage: /te <name> | /te <x> <z> | /te <worldId> <x> <z>';
const TE_BAD_COORDS = '/te: coordinates must be positive numbers inside the world.';

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
  private readonly setExpSer = new SetExperienceSerializer();
  private readonly setLevelSer = new SetLevelSerializer();

  private readonly commands: CommandEntry[];

  constructor(private readonly deps: CommandServiceDeps) {
    this.commands = [
      { names: ['w', 'whisper'], auth: AUTH.GENERAL, run: (c) => this.whisper(c) },
      { names: ['say'], auth: AUTH.GENERAL, run: (c) => this.whisper(c) },
      { names: ['s', 'shout'], auth: AUTH.GENERAL, run: (c) => this.shout(c) },
      // `/g <msg>` -- TextCmd_GuildChat, TCM_BOTH, AUTH_GENERAL.
      { names: ['g', 'guildchat'], auth: AUTH.GENERAL, run: (c) => this.guildChat(c) },
      // `/cg <name>` -- TextCmd_CreateGuild, TCM_SERVER, AUTH_GAMEMASTER3.
      // Solo create with no penya cost: C++ builds a 1-entry GUILD_MEMBER_INFO
      // array from the caller and skips the whole NPC eligibility script.
      { names: ['cg', 'createguild'], auth: AUTH.GAMEMASTER3, run: (c) => this.createGuild(c) },
      { names: ['te', 'tele', 'teleport'], auth: AUTH.GAMEMASTER, run: (c) => this.teleport(c) },
      { names: ['su', 'summon'], auth: AUTH.GAMEMASTER, run: (c) => this.summon(c) },
      { names: ['sys', 'system'], auth: AUTH.GAMEMASTER2, run: (c) => this.system(c) },
      { names: ['lv', 'level'], auth: AUTH.GAMEMASTER3, run: (c) => this.level(c) },
      { names: ['gg', 'getgold'], auth: AUTH.ADMINISTRATOR, run: (c) => this.gold(c) },
      { names: ['undying', 'ud'], auth: AUTH.GAMEMASTER3, run: (c) => this.undying(c, true) },
      { names: ['noundying', 'noud'], auth: AUTH.GAMEMASTER3, run: (c) => this.undying(c, false) },
      { names: ['invisible', 'inv'], auth: AUTH.GAMEMASTER, run: (c) => this.invisible(c, true) },
      { names: ['noinvisible', 'noinv'], auth: AUTH.GAMEMASTER, run: (c) => this.invisible(c, false) },
      { names: ['count', 'cnt'], auth: AUTH.GAMEMASTER, run: (c) => this.count(c) },
      { names: ['rtg'], auth: AUTH.ADMINISTRATOR, run: (c) => this.removeTotalGold(c) },
      { names: ['rmvnpc', 'rn'], auth: AUTH.GAMEMASTER3, run: (c) => this.removeNpc(c) },
      { names: ['createnpc', 'cn'], auth: AUTH.GAMEMASTER3, run: (c) => this.createNpc(c) },
      { names: ['disguise', 'dis'], auth: AUTH.ADMINISTRATOR, run: (c) => this.disguise(c, true) },
      { names: ['nodisguise', 'nodis'], auth: AUTH.ADMINISTRATOR, run: (c) => this.disguise(c, false) },
      { names: ['onekill', 'ok'], auth: AUTH.GAMEMASTER3, run: (c) => this.onekill(c, true) },
      { names: ['noonekill', 'nook'], auth: AUTH.GAMEMASTER3, run: (c) => this.onekill(c, false) },
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
      { names: ['aroundkill', 'ak'], auth: AUTH.GAMEMASTER3, run: (c) => this.aroundKill(c) },
      { names: ['createitem', 'ci'], auth: AUTH.ADMINISTRATOR, run: (c) => this.createItem(c) },
      { names: ['userlist', 'ul'], auth: AUTH.ADMINISTRATOR, run: (c) => this.userList(c) },
      { names: ['stat'], auth: AUTH.GAMEMASTER3, run: (c) => { void this.stat(c); } },
      { names: ['beginquest', 'bq'], auth: AUTH.GAMEMASTER3, run: (c) => { void this.questCmd(c, 'begin'); } },
      { names: ['endquest', 'eq'], auth: AUTH.GAMEMASTER3, run: (c) => { void this.questCmd(c, 'end'); } },
      { names: ['queststate', 'qs'], auth: AUTH.ADMINISTRATOR, run: (c) => { void this.questCmd(c, 'state'); } },
      { names: ['removequest', 'rq'], auth: AUTH.GAMEMASTER3, run: (c) => { void this.questCmd(c, 'cancel'); } },
      { names: ['removeallquest', 'raq'], auth: AUTH.GAMEMASTER3, run: (c) => { void this.questCmd(c, 'removeAll'); } },
      { names: ['removecompletequest', 'rcq'], auth: AUTH.GAMEMASTER3, run: (c) => { void this.questCmd(c, 'removeComplete'); } },
      { names: ['setguildquest', 'sgq'], auth: AUTH.ADMINISTRATOR, run: (c) => this.setGuildQuest(c) },
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

  /**
   * `/g <msg>` -- TextCmd_GuildChat (FuncTextCmd.cpp:1122). C++ caps the line at
   * 260 bytes and DROPS it entirely when longer (`return TRUE` without sending,
   * `:1142`) rather than truncating -- kept verbatim.
   */
  private guildChat({ args, player }: CommandCtx): void {
    const text = args.trim();
    if (text.length === 0 || text.length >= MAX_WHISPER_LEN) return;
    this.deps.guildService?.chat(player, text);
  }

  /** `/cg <name>` -- TextCmd_CreateGuild (FuncTextCmd.cpp:1078). GM-only. */
  private createGuild({ args, player }: CommandCtx): void {
    const name = args.trim();
    if (name.length === 0) return;
    this.deps.guildService?.create(player, name);
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
   * `/te <name>` | `/te <worldId> <x> <z>` | `/te <x> <z>` --
   * `TextCmd_Teleport` (`FuncTextCmd.cpp:2389`, registered `TCM_SERVER,
   * AUTH_GAMEMASTER` at `:5193`). The Navigator minimap GM double-click sends
   * the 3-token form (`WndField.cpp:11983`: `"/teleport %d %f %f"`).
   *
   * C++ token order: first token non-NUMBER => player name (and on an
   * unresolved name it emits `AddReturnSay( 3, token )` -- note the C++ then
   * FALLS THROUGH into the numeric branch, where `atoi` of a name yields 0 and
   * `GetWorldStruct(0)` fails, so the fall-through is inert). Otherwise token 1
   * is ALWAYS `worldId`, token 2 is either a region key or `x`, token 3 is `z`.
   *
   * ponytail: two deliberate divergences from that shape, both surfaced per
   * rule 01 rather than silently papered over --
   *  - The 2-token `<x> <z>` shorthand does not exist in C++ (there, `/te 100
   *    200` means worldId=100, regionKey/x=200). It is kept because it is what
   *    this project's GMs already use, and it is unambiguous: a 2-token numeric
   *    line cannot be a valid C++ coord form.
   *  - `<worldId> <regionKey>` is unported: `g_WorldMng.GetRevivalPos( worldId,
   *    key )` reads the `.wld` region table, and `flaris.yml`'s `regions:`
   *    carries one pvp rect and no revival keys. A non-numeric second token is
   *    refused with a notice instead of teleporting somewhere wrong.
   */
  private teleport({ args, player }: CommandCtx): void {
    const tokens = args.split(/\s+/).filter(Boolean);
    const [first] = tokens;
    if (first === undefined) {
      this.deps.playerManager.sendTo(player, this.noticeSer.build(TE_USAGE));
      return;
    }
    if (!isNumericToken(first)) {
      const target = this.findPlayer(first);
      // AddReturnSay( 3, token ) -- the C++ no-such-player reply.
      if (!target) { this.returnSay(player, RETURN_NOT_FOUND, first); return; }
      this.applyReplace(player, { ...target.m_vPos });
      return;
    }
    // Numeric first token => `<worldId> <x> <z>`, or the 2-token `<x> <z>`.
    const [xs, zs] = tokens.length >= 3 ? tokens.slice(1, 3) : tokens.slice(0, 2);
    if (xs === undefined || zs === undefined || !isNumericToken(xs) || !isNumericToken(zs)) {
      this.deps.playerManager.sendTo(player, this.noticeSer.build(TE_USAGE));
      return;
    }
    const x = Number.parseFloat(xs);
    const z = Number.parseFloat(zs);
    // `pWorld->VecInWorld( x, z ) && x > 0 && z > 0` (FuncTextCmd.cpp:2466).
    if (!Number.isFinite(x) || !Number.isFinite(z) || x <= 0 || z <= 0) {
      this.deps.playerManager.sendTo(player, this.noticeSer.build(TE_BAD_COORDS));
      return;
    }
    // y = 0 is the `CWorld::_replace` sentinel; applyReplace resolves it.
    this.applyReplace(player, { x, y: 0, z });
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
    // Caller's live position -- y already resolved, so no sentinel. SETPOS (not
    // REPLACE): same-world teleport must not null g_pPlayer (OnReplace
    // DPClient.cpp:2352 -> CWndQuestQuickInfo::Process:259 crash).
    this.applyReplace(target, { ...player.m_vPos });
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
    // C++ SetLevel (MoverParam.cpp:1826): m_nLevel = n; m_nExp1 = 0; broadcast
    // SETEXPERIENCE + SETLEVEL; refill HP/MP/FP. m_nExp is within-level (resets
    // to 0); the wire nExp1=0 makes the client bar read 0% at the new level.
    player.m_nLevel = n;
    player.m_nExp = 0;
    player.m_nMaxHp = player.getMaxHp();
    player.m_nMaxMp = player.getMaxMp();
    player.m_nMaxFp = player.getMaxFp();
    player.m_nHp = player.m_nMaxHp;
    player.m_nMp = player.m_nMaxMp;
    player._dirty.add('level');
    player._dirty.add('m_nExp');
    player._dirty.add('m_nHp');
    player._dirty.add('m_nMp');
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'CHAR_EXP',
      payload: { level: player.m_nLevel, exp: '0' },
    });
    this.deps.playerManager.sendTo(player, this.setExpSer.build(player.m_idPlayer, {
      exp: 0, level: player.m_nLevel,
      skillLevel: player.m_nSkillLevel, skillPoint: player.m_nSkillPoint,
    }));
    this.deps.zoneManager?.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      this.setLevelSer.build(player.m_idPlayer, player.m_nLevel),
      player,
    );
    this.deps.charRepo?.updateLevelAndExp(player.m_idPlayer, player.m_nLevel, 0n)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer }, '/lv persist failed'));
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
   * Auth is `AUTH_GAMEMASTER3` ('N'). No WAL -- `m_dwMode` is transient.
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
  /**
   * `/cn <id|name> [count] [activeAttack]` -- `TextCmd_CreateNPC`
   * (FuncTextCmd.cpp:2930). Resolves the mover by numeric id or by name, gates
   * on it being a monster-AI type (C++ checks `dwAI == AII_MONSTER` and the
   * boss variants -- we use the yml `type`, the converted equivalent), then
   * materializes `count` (1..100) instances at the caller's position and
   * broadcasts each ADD_OBJ via `SpawnManager.spawnMonster` -> `onSpawn`.
   *
   * ponytail: C++ also seeds `SetGold(level*15)` on each mover; we have no
   * per-mover gold model (drops come from the drop table), so it is skipped.
   */
  private createNpc({ args, player }: CommandCtx): void {
    const resolved = resolveMover(args, this.deps.lookupMover);
    if (!resolved) {
      logger.warn({ charId: player.m_idPlayer, args }, '/cn: could not resolve mover (unknown name/id)');
      return;
    }
    const { def, rest } = resolved;
    if (!SPAWNABLE_MOVER_TYPES.has(def.type ?? '')) {
      logger.warn({ charId: player.m_idPlayer, id: def.id, type: def.type }, '/cn: mover is not a spawnable monster type');
      return;
    }

    const [countTok, activeTok] = rest.split(/\s+/);
    let count = Number.parseInt(countTok ?? '', 10);
    if (!Number.isInteger(count) || count <= 0) count = 1;
    if (count > MAX_CREATE_NPC) count = MAX_CREATE_NPC;
    const activeAttack = Number.parseInt(activeTok ?? '', 10) > 0;

    for (let i = 0; i < count; i++) {
      this.deps.spawnManager.spawnMonster(def.id, player.m_vPos, player.m_nZoneId, activeAttack);
    }
  }

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
   * Each is `AUTH_GAMEMASTER3` ('N') except `/qs` (ADMINISTRATOR 'P').
   * Self-targeting (C++ also supports a trailing player name; ponytail). All
   * mutate via QuestService (which persists + audit-logs) and forward the
   * returned snapshot frames to the caller. Silent on failure -- stock v19 sends
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
   * `/setguildquest` `/sgq <guildName> <questId> <state>` --
   * `TextCmd_SetGuildQuest` (`FuncTextCmd.cpp:1257-1286`), `AUTH_ADMINISTRATOR`.
   *
   * Writes one ledger entry and nothing else. C++ rejects an unknown quest id
   * (`GetGuildQuestProp` null -> `return FALSE`) and silently ignores a state
   * outside `[QS_BEGIN, QS_END]` -- the `if` at `:1275` has an EMPTY then-branch,
   * so an out-of-range state produces no write and no message. Both reproduced.
   *
   * Silent either way: the command sends no reply in C++.
   */
  private setGuildQuest({ args }: CommandCtx): void {
    const tokens = args.split(/\s+/).filter(Boolean);
    const guildName = tokens[0];
    const questId = Number.parseInt(tokens[1] ?? '', 10);
    const state = Number.parseInt(tokens[2] ?? '', 10);
    if (guildName === undefined || !Number.isInteger(questId) || !Number.isInteger(state)) return;
    // `nState < QS_BEGIN || nState > QS_END` -> empty branch (`:1275`).
    if (state < QS_BEGIN || state > QS_END) return;
    this.deps.guildQuest?.setStateByGuildName(guildName, questId, state);
  }

  /**
   * `/onekill` `/ok` / `/noonekill` `/nook` -- `TextCmd_Onekill` /
   * `TextCmd_NoOnekill` (FuncTextCmd.cpp:3541 / 3567). Toggles the
   * `ONEKILL_MODE` bit (authorization.h:22) + broadcasts MODIFYMODE. C++ gates
   * at `AUTH_GAMEMASTER3` ('N'). The one-shot kill effect
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
   * this single-process emulator we notify the target then destroy its socket.
   * Self-target -> ReturnSay flag 2 (consistent with `/su`/`/te`).
   *
   * The forced-logout notice goes out first: the v19 client ignores a bare
   * socket close on the world connection and freezes in-world instead of
   * returning to the title screen. See `net/snapshot/kick.serializer.ts`.
   *
   * ponytail: the `remove()` below pre-empts the dispatcher's socket-close hook
   * -- by the time the deferred destroy fires the player is gone from the
   * manager, so the hook's teardown (trade gold refund, party/friend/visibility)
   * and state flush are all skipped. Faithful to C++ (which likewise just kills
   * the connection) but a mid-trade target loses staked penya. Upgrade path:
   * take the same `beforeLeave` + `saveAndLeave` seam `AdminCommandService.kick`
   * uses, or drop the `remove()` and let the close hook own it.
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
    try {
      this.deps.playerManager.sendTo(target, buildKickNotice(target.m_idPlayer));
    } catch {
      // Dead socket -- fall through to the close.
    }
    const socket = target.socket;
    setTimeout(() => socket.destroy?.(), KICK_CLOSE_DELAY_MS).unref?.();
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
   * `/ci <itemId|"name"|name> [count]` -- `TextCmd_CreateItem` (FuncTextCmd.cpp:2522).
   * C++ resolves the item by name OR id. We support both: a numeric first token
   * is treated as an item id; a quoted or non-numeric token is looked up via
   * `getItemByName`. Delegates to `InventoryService.addItem` (WAL + persist +
   * state), then sends the CREATEITEM snapshot on success. Bag full -> silent
   * (stock v19 prints `TID_GAME_LACKSPACE`; omitted until a defined-text channel
   * ships).
   */
  private createItem({ args, player }: CommandCtx): void {
    const inv = this.deps.inventoryService;
    if (inv === undefined) {
      logger.warn({ charId: player.m_idPlayer, args }, '/ci: inventoryService unavailable');
      return;
    }

    const resolved = resolveItemId(args, this.deps.getItemByName);
    if (!resolved) {
      logger.warn({ charId: player.m_idPlayer, args }, '/ci: could not resolve item (unknown name/id)');
      return;
    }
    const count = Math.max(1, resolved.count);
    logger.info({ charId: player.m_idPlayer, args, itemId: resolved.itemId, count }, '/ci resolved');

    const res = inv.addItem(player, resolved.itemId, count);
    if (!res.ok) {
      logger.warn({ charId: player.m_idPlayer, itemId: resolved.itemId, reason: res.reason }, '/ci: addItem failed');
      return;
    }
    for (const ch of res.changes) {
      this.deps.playerManager.sendTo(
        player,
        ch.isNew
          ? this.createItemSer.buildOne(player.m_idPlayer, ch.itemId, ch.count, ch.objid)
          : buildUpdateItemCount(player.m_idPlayer, ch.objid, ch.count),
      );
    }
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

  /**
   * Move `player` to `pos` -- the same-world branch of `CWorld::_replace`
   * (`World.cpp:1565`), verbatim:
   *
   * ```cpp
   * if( vPos.y == 0.0f ) { vPos.y = 100.0f; vPos.y = GetFullHeight( vPos ); }
   * g_UserMng.AddSetPos( (CCtrl*)pMover, vPos );
   * pMover->SetPos( vPos );
   * if( pMover->IsPlayer() ) ( (CUser*)pMover )->Notify();
   * ```
   *
   * Three things that were wrong here:
   *  - literal `y: 0` went on the wire. `CDPClient::OnSetPos` (`DPClient.cpp:556`)
   *    trusts the server's y verbatim (`RemoveObj` -> `ReadWorld` -> `SetPos` ->
   *    `AddObj` -> `OBJMSG_STAND`) and there is no server-side gravity anywhere
   *    in `_Common/MoverMove.cpp` -- so y=0 is y=0 on screen, under the terrain.
   *  - `AddSetPos` is a `FOR_VISIBILITYRANGE` broadcast (`User.cpp:4675`), not a
   *    self-send: peers never saw the GM move.
   *  - every reject path was a silent `return`.
   */
  private applyReplace(player: CPlayer, pos: Vec3): void {
    const y = pos.y === 0 ? this.groundY(player.m_nZoneId, pos.x, pos.z) : pos.y;
    const dest: Vec3 = { x: pos.x, y, z: pos.z };
    try {
      Validate.pos(dest.x, dest.y, dest.z);
    } catch {
      this.deps.playerManager.sendTo(player, this.noticeSer.build(TE_BAD_COORDS));
      return;
    }
    player.m_vPos = dest;
    player._dirty.add('x');
    player._dirty.add('y');
    player._dirty.add('z');
    const buf = this.setPosSer.build(player.m_idPlayer, dest);
    this.deps.playerManager.sendTo(player, buf);
    // `g_UserMng.AddSetPos` -- visibility-range broadcast so peers relocate the
    // mover instead of watching a ghost stand at the old spot (`/lv` :420 does
    // the same for SETLEVEL). `except` is the mover: it got its copy above.
    this.deps.zoneManager?.broadcastAround(
      dest, player.m_nZoneId, VISIBILITY_RADIUS, buf, player,
    );
    // `CUser::Notify()` (`User.cpp:578`) -- re-diff the view at the destination.
    // Without it the old spawns linger and nothing at the new spot appears
    // (SETPOS does not reload the world, so no new MAP_KEY fires).
    this.refreshVisibility(player);
  }

  /**
   * `CWorld::GetFullHeight` stand-in (`WorldIntersect.cpp:12`) -- terrain y at
   * `(x, z)`, or `SENTINEL_Y` when the zone is unknown.
   *
   * ponytail: the real thing raycasts static objects then falls back to a
   *   bilinear `.lnd` heightmap sample (`World.cpp:982 GetLandHeight`). No
   *   `.lnd` parser exists in TS. This takes the y of the nearest authored
   *   spawn/NPC placement in the zone instead -- those y values ARE terrain
   *   samples taken by the extractor (`flaris.yml` carries 2600 of them), so on
   *   Flaris's rolling ground the error is metres, not the ~100 m that shipping
   *   a raw 0 costs. Replace with `world.getLandHeight(x, z)` once the `.lnd`
   *   files under `game/client/World/` are parsed.
   */
  private groundY(zoneId: number, x: number, z: number): number {
    const zone = this.deps.zones?.byNumericId.get(zoneId);
    if (!zone) return SENTINEL_Y;
    let best = SENTINEL_Y;
    let bestDistSq = Number.POSITIVE_INFINITY;
    const consider = (p: { x: number; y: number; z: number }): void => {
      // Authored 0s are themselves sentinels (portals use y: 0) -- not samples.
      if (p.y === 0) return;
      const dx = p.x - x;
      const dz = p.z - z;
      const distSq = dx * dx + dz * dz;
      if (distSq < bestDistSq) { bestDistSq = distSq; best = p.y; }
    };
    for (const spawn of zone.spawns) consider(spawn.position);
    for (const npc of zone.npcs) consider(npc.position);
    return best;
  }

  /** Re-diff the post-teleport player's view (ADD_OBJ new, DEL_OBJ stale). */
  private refreshVisibility(player: CPlayer): void {
    this.deps.visibilityService?.refresh(player.m_idPlayer, true);
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
 * Is this token a NUMBER to `CScanner::GetToken`? The scanner's NUMBER covers
 * an optional sign and a decimal point, which matters because the Navigator
 * sends floats (`"/teleport %d %f %f"`, `WndField.cpp:11983` -> `/teleport 1
 * 3880.000000 3500.000000`). The old `/^\d+(\.\d+)?$/` rejected `-1` and `.5`,
 * so a signed token fell into the player-name branch.
 */
function isNumericToken(token: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(token);
}

/**
 * Resolve `/ci` args into `{ itemId, count }`.
 * Supports: numeric id (`1234 5`), quoted name (`"Popom Powder" 5`),
 * unquoted multi-word (`Popom Powder 5` -- greedy longest-match).
 */
function resolveItemId(
  args: string,
  getItemByName?: (name: string) => ItemDefinition | undefined,
): { itemId: number; count: number } | null {
  const trimmed = args.trim();
  if (!trimmed) return null;

  // --- Quoted name: `"Popom Powder" 5` ---
  if (trimmed[0] === '"') {
    const endQuote = trimmed.indexOf('"', 1);
    if (endQuote > 1) {
      const name = trimmed.slice(1, endQuote);
      const rest = trimmed.slice(endQuote + 1).trim();
      const def = getItemByName?.(name) ?? getItemByName?.(name.toLowerCase());
      return def ? { itemId: def.id, count: parseCount(rest) } : null;
    }
  }

  // --- Try first token as numeric ID: `1234 5` ---
  const tokens = trimmed.split(/\s+/);
  const firstNum = Number.parseInt(tokens[0] ?? '', 10);
  if (Number.isInteger(firstNum) && firstNum > 0) {
    return { itemId: firstNum, count: parseCount(tokens.slice(1).join(' ')) };
  }

  // --- Greedy multi-word name match: `Popom Powder 5` ---
  // Try longest prefix first (all tokens), shrink until match.
  if (!getItemByName) return null;
  for (let n = tokens.length; n >= 1; n--) {
    const nameCandidate = tokens.slice(0, n).join(' ');
    const def = getItemByName(nameCandidate) ?? getItemByName(nameCandidate.toLowerCase());
    if (def) {
      return { itemId: def.id, count: parseCount(tokens.slice(n).join(' ')) };
    }
  }
  return null;
}

function parseCount(s: string): number {
  const n = Number.parseInt(s, 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Resolve `/cn` / `/dis` args into `{ def, rest }`.
 * Supports: numeric id (`46 3`), quoted name (`"Boss Bang" 3`), unquoted
 * multi-word (`Boss Bang 3` -- greedy longest-match, same shape as
 * `resolveItemId`). C++ `CScanner::GetToken` strips the quotes itself
 * (Scanner.cpp:764), so a quoted mover name reaches `GetMoverProp` unquoted --
 * our splitter kept the `"` and every multi-word monster name failed to match.
 */
function resolveMover(
  args: string,
  lookupMover?: (token: string) => MoverDefinition | undefined,
): { def: MoverDefinition; rest: string } | null {
  const trimmed = args.trim();
  if (!trimmed || !lookupMover) return null;

  if (trimmed[0] === '"') {
    const endQuote = trimmed.indexOf('"', 1);
    if (endQuote > 1) {
      const name = trimmed.slice(1, endQuote);
      const def = lookupMover(name);
      return def ? { def, rest: trimmed.slice(endQuote + 1).trim() } : null;
    }
  }

  const tokens = trimmed.split(/\s+/);
  for (let n = tokens.length; n >= 1; n--) {
    const def = lookupMover(tokens.slice(0, n).join(' '));
    if (def) return { def, rest: tokens.slice(n).join(' ') };
  }
  return null;
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
