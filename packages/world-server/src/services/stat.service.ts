/**
 * StatService -- v19 stat-point allocation (`PACKETTYPE_MODIFY_STATUS`).
 *
 * Ports `CDPSrvr::OnModifyStatus` (`WORLDSERVER/DPSrvr.cpp:10345`): the client
 * sends four counts (STR/STA/DEX/INT) to add from the spendable `m_nRemainGP`
 * pool. Server-authoritative (rule 03): every count is range-checked, the sum
 * must be `> 0` and `<= m_nRemainGP`, then applied 1:1. The client NEVER sends
 * the resulting totals -- only the deltas -- so we recompute and echo via the
 * SETSTATE snapshot.
 *
 * Persistence: WAL `CHAR_STATS` carries the ABSOLUTE post-state (str/sta/dex/
 * int/remainGP) so a crash between journal + DB write loses nothing (idempotent
 * replay). Fire-and-forget `charRepo.updateStats` is the cold write.
 *
 * @module services/stat
 */

import type { Journal } from '@flyff/database';
import type { CharacterRepository } from '@flyff/database';
import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import { buildSetPointParam, DST_FP, DST_HP, DST_MP, VISIBILITY_RADIUS } from '@flyff/world-core';
import { SetStateSerializer } from '@flyff/combat';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'stat-service' });

/** `ScriptLib.cpp:573` -- `InitStat` resets each base stat to this floor. */
const BASE_STAT = 15;
/** `ScriptLib.cpp:577` -- `m_nRemainGP = (GetLevel() - 1) * 2`. */
const GP_PER_LEVEL = 2;

export interface StatAllocation {
  readonly str: number;
  readonly sta: number;
  readonly dex: number;
  readonly int: number;
}

export interface StatServiceDeps {
  playerManager: PlayerManager;
  charRepo: Pick<CharacterRepository, 'updateStats'>;
  journal?: Journal;
  /**
   * Vicinity fan-out for the post-allocation `SETPOINTPARAM` refill. C++
   * `CUserMng::AddSetPointParam` (`WORLDSERVER/User.cpp:4658`) is
   * `FOR_VISIBILITYRANGE` (self included), so peers watching this player see the
   * bar jump to the new max. Optional -- absent falls back to self-only.
   */
  zoneManager?: ZoneManager;
}

export type StatAllocResult =
  | { ok: true }
  | { ok: false; reason: 'negative' | 'empty' | 'insufficient' };

export class StatService {
  private readonly setState = new SetStateSerializer();
  constructor(private deps: StatServiceDeps) {}

  /**
   * Apply a stat allocation (C++ `OnModifyStatus` body). Validates, mutates the
   * player, journals the absolute post-state, echoes SETSTATE to self, and
   * persists fire-and-forget.
   */
  applyStatPoints(player: CPlayer, alloc: StatAllocation): StatAllocResult {
    const { str, sta, dex, int } = alloc;
    if (str < 0 || sta < 0 || dex < 0 || int < 0) return { ok: false, reason: 'negative' };
    const sum = str + sta + dex + int;
    if (sum <= 0) return { ok: false, reason: 'empty' };
    if (player.m_nRemainGP < sum) return { ok: false, reason: 'insufficient' };

    player.m_nStr += str;
    player.m_nSta += sta;
    player.m_nDex += dex;
    player.m_nInt += int;
    player.m_nRemainGP -= sum;
    player._dirty.add('strength');
    player._dirty.add('stamina');
    player._dirty.add('dexterity');
    player._dirty.add('intelligence');
    player._dirty.add('remain_gp');

    // ABSOLUTE post-state -- idempotent replay (rule 04).
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'CHAR_STATS',
      payload: {
        strength: player.m_nStr, stamina: player.m_nSta,
        dexterity: player.m_nDex, intelligence: player.m_nInt,
        remain_gp: player.m_nRemainGP,
      },
    });

    this.deps.playerManager.sendTo(
      player,
      this.setState.build(player.m_idPlayer, {
        str: player.m_nStr, sta: player.m_nSta,
        dex: player.m_nDex, int: player.m_nInt,
        remainGP: player.m_nRemainGP,
      }),
    );

    // Mirror the client's `OnSetState` (`DPClient.cpp:13376`): it recomputes
    // GetMaxHitPoint/Mana/Fatigue from the new stats AND refills current to
    // max. If the server keeps the old current value, the next regen tick pushes
    // a lower SETPOINTPARAM and the client's HP visibly drops after allocating
    // STA. Refill server-side to stay in sync.
    player.m_nMaxHp = player.getMaxHp();
    player.m_nMaxMp = player.getMaxMp();
    player.m_nMaxFp = player.getMaxFp();
    player.m_nHp = player.m_nMaxHp;
    player.m_nMp = player.m_nMaxMp;
    player.m_nFp = player.m_nMaxFp;
    this.syncVitals(player);

    this.deps.charRepo.updateStats(player.m_idPlayer, {
      strength: player.m_nStr, stamina: player.m_nSta,
      dexterity: player.m_nDex, intelligence: player.m_nInt,
      remain_gp: player.m_nRemainGP,
    }).catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'stat persist failed'));

    logger.debug({ charId: player.m_idPlayer, alloc, remainGP: player.m_nRemainGP }, 'stat allocated');
    return { ok: true };
  }

  /**
   * `InitStat()` -- reset the four base stats to 15 and refund every point as
   * spendable GP. Ports `ScriptLib.cpp:570`: `SetStr/Int/Dex/Sta(15)` then
   * `m_nRemainGP = (GetLevel() - 1) * 2`.
   *
   * Called from the dialog sink: the job-master `source:` bodies run
   * `ChangeJob(n); InitStat();` together, so a fresh 1st-class character
   * re-picks its build from scratch instead of carrying the Vagrant spread.
   *
   * Reuses the same echo path as {@link applyStatPoints} (SETSTATE +
   * SETPOINTPARAM refill) so the client's stat window and vitals stay in sync.
   *
   * ponytail: C++ also emits `FUNCTYPE_INITSTAT` in the RunScriptFunc stream
   * (a UI hint carrying the new remainGP). SETSTATE already carries remainGP,
   * so the window updates without it -- add the func if a client desync shows.
   */
  initStat(player: CPlayer): void {
    player.m_nStr = BASE_STAT;
    player.m_nSta = BASE_STAT;
    player.m_nDex = BASE_STAT;
    player.m_nInt = BASE_STAT;
    player.m_nRemainGP = Math.max(0, (player.m_nLevel - 1) * GP_PER_LEVEL);
    player._dirty.add('strength');
    player._dirty.add('stamina');
    player._dirty.add('dexterity');
    player._dirty.add('intelligence');
    player._dirty.add('remain_gp');

    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'CHAR_STATS',
      payload: {
        strength: player.m_nStr, stamina: player.m_nSta,
        dexterity: player.m_nDex, intelligence: player.m_nInt,
        remain_gp: player.m_nRemainGP,
      },
    });

    this.deps.playerManager.sendTo(
      player,
      this.setState.build(player.m_idPlayer, {
        str: player.m_nStr, sta: player.m_nSta,
        dex: player.m_nDex, int: player.m_nInt,
        remainGP: player.m_nRemainGP,
      }),
    );

    // Same client-mirror refill as applyStatPoints (`OnSetState` recomputes and
    // refills) -- dropping STA back to 15 lowers max HP, so resync current too.
    player.m_nMaxHp = player.getMaxHp();
    player.m_nMaxMp = player.getMaxMp();
    player.m_nMaxFp = player.getMaxFp();
    player.m_nHp = player.m_nMaxHp;
    player.m_nMp = player.m_nMaxMp;
    player.m_nFp = player.m_nMaxFp;
    this.syncVitals(player);

    this.deps.charRepo.updateStats(player.m_idPlayer, {
      strength: player.m_nStr, stamina: player.m_nSta,
      dexterity: player.m_nDex, intelligence: player.m_nInt,
      remain_gp: player.m_nRemainGP,
    }).catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'initStat persist failed'));

    logger.debug({ charId: player.m_idPlayer, remainGP: player.m_nRemainGP }, 'stats reset (InitStat)');
  }

  /**
   * Push HP/MP/FP `SETPOINTPARAM` to the visibility range (self included), per
   * `CUserMng::AddSetPointParam` (`WORLDSERVER/User.cpp:4658`). Peers watching
   * this player in the target display see the refilled bar.
   */
  private syncVitals(player: CPlayer): void {
    const vitals: ReadonlyArray<[number, number]> = [
      [DST_HP, player.m_nHp], [DST_MP, player.m_nMp], [DST_FP, player.m_nFp],
    ];
    for (const [dst, value] of vitals) {
      const packet = buildSetPointParam(player.m_idPlayer, dst, value);
      if (this.deps.zoneManager) {
        this.deps.zoneManager.broadcastAround(player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet);
      } else {
        this.deps.playerManager.sendTo(player, packet);
      }
    }
  }
}
