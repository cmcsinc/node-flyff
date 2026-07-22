/**
 * StatService -- v15 stat-point allocation (`PACKETTYPE_MODIFY_STATUS`).
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
import type { CPlayer } from '../entities/player.js';
import type { PlayerManager } from '../managers/player.manager.js';
import { SetStateSerializer } from '../net/snapshot/setState.serializer.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'stat-service' });

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

    this.deps.charRepo.updateStats(player.m_idPlayer, {
      strength: player.m_nStr, stamina: player.m_nSta,
      dexterity: player.m_nDex, intelligence: player.m_nInt,
      remain_gp: player.m_nRemainGP,
    }).catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'stat persist failed'));

    logger.debug({ charId: player.m_idPlayer, alloc, remainGP: player.m_nRemainGP }, 'stat allocated');
    return { ok: true };
  }
}
