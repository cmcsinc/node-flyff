/**
 * GuildContributionService -- penya/gem donation, guild level-up, and the 21:00
 * daily salary sweep.
 *
 * Ported from three C++ sites:
 *  - `CDPSrvr::OnGuildContribution` (`WORLDSERVER/DPSrvr.cpp:1837`) -- the
 *    world-server half: validate, then ask the core to credit, then remove the
 *    player's penya/gems only if the core accepted.
 *  - `CGuild::CanContribute` / `AddContribution` (`_Common/guild.cpp:554-607`)
 *    -- the core half: the refusal ladder and the level-up that CONSUMES both
 *    pools. Lives on {@link GuildManager}.
 *  - `CGuildMng::Process` (`_Common/guild.cpp:1089`) -- the 21:00 payroll tick.
 *
 * Split out of {@link GuildService} because it is the only guild code that
 * touches the player's inventory (penya + gem stacks), and dragging
 * `@flyff/inventory` into the roster/permission service would couple two
 * unrelated halves. The inventory surface is a structural port, not a class
 * import, so this package still has no dependency on `@flyff/inventory`.
 *
 * **Ordering matters (rule 04).** C++ credits the guild FIRST and only then
 * debits the player (`SendGuildStat` -> `pUser->AddGold(-nGold)`,
 * `DPSrvr.cpp:1862`), which means a failure between the two leaves the guild
 * credited and the player un-charged. We keep the same order (the contribution
 * has to be accepted before we know what to charge) but roll the credit BACK
 * via `decrementMemberContribution` when the debit then fails -- the same
 * rollback C++ has for the cross-server case, applied to the local one.
 *
 * @module services/guildContribution
 */

import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import {
  buildGuildContribution, buildGuildRealPenya, buildGuild,
  type GuildSnapshot,
} from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';
import type { GuildManager, Guild } from '../managers/guild.manager';
import { gemContributionPxp, MAX_GUILD_LEVEL } from '../guildTable';
import { TID_GAME_GUILDNOTENGGOLD } from '../guildText';

const logger = createLogger({ module: 'guild-contribution' });

/** `IK3_GEM` -- the only donatable item kind (`DPSrvr.cpp:1888`). */
const IK3_GEM = 'IK3_GEM';

/** The hour the payroll runs, and the hour the latch clears (`guild.cpp:1094`). */
export const SALARY_PAY_HOUR = 21;
export const SALARY_RESET_HOUR = 22;

/** One donatable gem stack found in the player's bag. */
export interface GemStack {
  slot: number;
  itemId: number;
  count: number;
  /** `dwItemLV` -- drives the PXP value. */
  itemLv: number;
}

/**
 * Inventory surface this service needs -- structurally satisfied by
 * `InventoryService` + the resource item index. A port rather than an import so
 * `@flyff/guild` stays free of `@flyff/inventory`.
 */
export interface GuildInventoryPort {
  /** `pUser->GetGold()`. */
  getGold(player: CPlayer): number;
  /** `pUser->AddGold( -nGold )` -- must journal + persist. False = refused. */
  spendGold(player: CPlayer, amount: number): boolean;
  /** Every IK3_GEM stack in the main bag, in slot order. */
  findGems(player: CPlayer): GemStack[];
  /** `pUser->RemoveItem( i, nItemNum )`. False = refused. */
  removeItem(player: CPlayer, slot: number, count: number): boolean;
}

export interface GuildContributionServiceDeps {
  playerManager: PlayerManager;
  guildManager: GuildManager;
  inventory: GuildInventoryPort;
  /**
   * `g_eLocal.GetState( ENABLE_GUILD_INVENTORY )` (`DPSrvr.cpp:1848`) -- the
   * server-wide switch that gates the whole guild-bank/contribution feature.
   * Defaults on; a thunk so flipping it takes effect without a recompose.
   */
  guildInventoryEnabled?: () => boolean;
  /**
   * Refusal-notice sink -- `SendDefinedText`. Optional; without it a short-penya
   * contribution looks like a dead button.
   */
  sendDefinedText?: (player: CPlayer, tid: number, args?: string) => void;
  /** Clock seam for the salary tick + tests. */
  now?: () => Date;
}

export class GuildContributionService {
  private readonly now: () => Date;
  private readonly enabled: () => boolean;
  /** `CGuildMng::m_bSendPay` -- the manager-wide latch, distinct from per-guild. */
  private sweepLatched = false;

  constructor(private readonly deps: GuildContributionServiceDeps) {
    this.now = deps.now ?? ((): Date => new Date());
    this.enabled = deps.guildInventoryEnabled ?? ((): boolean => true);
  }

  /**
   * `NW_GUILDCONTRIBUTION` handler body -- `CDPSrvr::OnGuildContribution`
   * (`DPSrvr.cpp:1837`).
   *
   * The two modes are mutually exclusive and penya WINS: C++ tests `nGold > 0`
   * first and only falls to the gem branch in an `else if`. `cbPxpCount` is read
   * off the wire but never used as a value -- the client sets it to 1 to mean
   * "this is a PXP donation", and the actual PXP comes from the gems.
   */
  contribute(player: CPlayer, pxpFlag: number, gold: number, itemFlag: number): void {
    if (!this.enabled()) return;
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;

    if (gold > 0) {
      this.contributePenya(player, guild, gold);
      return;
    }
    if (itemFlag) this.contributeGems(player, guild);
    else if (pxpFlag) {
      logger.debug({ charId: player.m_idPlayer }, 'PXP contribution with no item flag -- nothing to donate');
    }
  }

  /**
   * Penya branch (`DPSrvr.cpp:1855-1878`). C++ pre-checks `GetGold() >= nGold`
   * and drops out with TID_GAME_GUILDNOTENGGOLD when short.
   */
  private contributePenya(player: CPlayer, guild: Guild, gold: number): void {
    // TID_GAME_GUILDNOTENGGOLD -- carrying less than the amount (`:1876`).
    if (this.deps.inventory.getGold(player) < gold) {
      this.deps.sendDefinedText?.(player, TID_GAME_GUILDNOTENGGOLD);
      return;
    }
    const result = this.deps.guildManager.addContribution(guild.id, player.m_idPlayer, 0, gold);
    if (!result) return;
    if (!this.deps.inventory.spendGold(player, gold)) {
      // Debit refused after the credit landed -- roll the member's counters back
      // (`CGuild::DecrementMemberContribution`). The guild pools keep the penya,
      // exactly as the C++ cross-server failure path leaves them.
      this.deps.guildManager.decrementMemberContribution(guild.id, player.m_idPlayer, 0, gold);
      logger.warn({ charId: player.m_idPlayer, gold }, 'guild penya debit failed after credit');
      return;
    }
    this.announce(guild, player.m_idPlayer, 0, gold, result.leveled);
  }

  /**
   * Gem branch (`DPSrvr.cpp:1880-1918`). C++ walks the WHOLE bag and donates
   * every gem stack it finds, one `SendGuildStat` per stack, removing each stack
   * only after that stack's credit is accepted. A stack worth 0 PXP is skipped
   * without being consumed (`if( nValue > 0 )`).
   */
  private contributeGems(player: CPlayer, guild: Guild): void {
    for (const gem of this.deps.inventory.findGems(player)) {
      const value = gemContributionPxp(gem.itemLv, gem.count);
      if (value <= 0) continue;
      const result = this.deps.guildManager.addContribution(guild.id, player.m_idPlayer, value, 0);
      if (!result) continue; // max level / overflow -- stack stays in the bag
      if (!this.deps.inventory.removeItem(player, gem.slot, gem.count)) {
        this.deps.guildManager.decrementMemberContribution(guild.id, player.m_idPlayer, value, 0);
        logger.warn({ charId: player.m_idPlayer, slot: gem.slot }, 'gem removal failed after credit');
        continue;
      }
      this.announce(guild, player.m_idPlayer, value, 0, result.leveled);
    }
  }

  /**
   * `CUser::AddContribution` fan-out (`User.cpp:1947`) -- the whole roster gets
   * the CONTRIBUTION_CHANGED_INFO so every member's guild window updates its
   * pool bars and the donor's own contribution row.
   *
   * On a level-up we also resend the full GUILD snapshot: the level gates
   * max-members and the nickname feature, and CONTRIBUTION alone carries the new
   * level but not the recomputed caps the client derives from it.
   */
  private announce(guild: Guild, donorId: number, pxp: number, penya: number, leveled: boolean): void {
    const packet = buildGuildContribution(
      guild.id, donorId, pxp, penya,
      guild.contributionPxp, guild.gold, guild.level,
    );
    const full = leveled ? buildGuild(snapshot(guild)) : null;
    for (const m of guild.members) {
      const p = this.deps.playerManager.get(m.characterId);
      if (!p) continue;
      this.deps.playerManager.sendTo(p, packet);
      if (full) this.deps.playerManager.sendTo(p, full);
    }
    if (leveled) {
      logger.info({ guildId: guild.id, level: guild.level }, 'guild leveled up');
    }
  }

  /**
   * `CGuildMng::Process` (`guild.cpp:1089`) -- call from the world tick.
   *
   * Hour 21 pays every guild that can afford its full payroll; hour 22 clears
   * the latches. The manager-wide `m_bSendPay` means the sweep runs at most once
   * per evening even though the tick fires every 50ms.
   *
   * Each paid member receives GUILD_REAL_PENYA carrying the guild's NEW bank
   * balance and their OWN rank (`DPCoreClient.cpp:2484` passes
   * `pMember->m_nMemberLv`), which is how the client knows which salary row to
   * credit.
   */
  tickSalary(): void {
    const hour = this.now().getHours();
    if (!this.sweepLatched && hour === SALARY_PAY_HOUR) {
      this.sweepLatched = true;
      for (const { guild, total } of this.deps.guildManager.paySalaries()) {
        for (const m of guild.members) {
          const p = this.deps.playerManager.get(m.characterId);
          if (p) this.deps.playerManager.sendTo(p, buildGuildRealPenya(guild.gold, m.memberLv));
        }
        logger.info({ guildId: guild.id, total, gold: guild.gold }, 'guild salary paid');
      }
      return;
    }
    if (this.sweepLatched && hour === SALARY_RESET_HOUR) {
      this.deps.guildManager.resetSalaryLatch();
      this.sweepLatched = false;
    }
  }

  /** Is this guild at the level cap? Used by the contribution UI gate. */
  isMaxLevel(guildId: number): boolean {
    const g = this.deps.guildManager.get(guildId);
    return g !== undefined && g.level >= MAX_GUILD_LEVEL;
  }
}

/** Live {@link Guild} -> the wire shape `CGuild::Serialize` expects. */
function snapshot(guild: Guild): GuildSnapshot {
  return {
    id: guild.id, masterId: guild.masterId, level: guild.level,
    name: guild.name, logo: guild.logo, gold: guild.gold,
    win: guild.win, lose: guild.lose, surrender: guild.surrender,
    power: guild.power, penya: guild.penya, notice: guild.notice,
    contributionPxp: guild.contributionPxp,
    enemyGuildId: guild.idEnemyGuild,
    members: guild.members.map((m) => ({
      id: m.characterId, pay: m.pay, giveGold: m.giveGold, givePxp: m.givePxp,
      win: m.win, lose: m.lose, memberLv: m.memberLv,
      selectedVoteId: m.selectedVoteId, surrender: m.surrender,
      cls: m.memberClass, alias: m.alias,
    })),
  };
}

/** The gem-kind symbol, exported so compose's `findGems` filter stays in sync. */
export { IK3_GEM };
