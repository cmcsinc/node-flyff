/**
 * PkModeService -- PK-mode toggle logic.
 *
 * The v19 client sends `DWORD dwMode` via `PACKETTYPE_MODE` (0xffffff7b).
 * `dwMode=1` = PK on, `dwMode=0` = PK off. This sets `player.m_bPKMode`, which
 * gates PvP targeting in the combat pipeline (`isPlayerAttackableBy`).
 *
 * The C++ `OnMode` handler also dispatches GM-mode toggles (ONEKILL/MATCHLESS/
 * TRANSPARENT/...), but those arrive via chat commands (`/ok`/`/inv`/`/ma`) and
 * are handled by `CommandService` directly -- this service only owns the PK bit.
 *
 * A text notification is sent to the player confirming the toggle. C++ uses
 * `AddDefinedText` with DST_PK_MODE_ON / DST_PK_MODE_OFF; we send a vicinity
 * CHAT frame so the message is visible without a defined-text table (ponytail:
 * wire the real DST_* ids once the defined-text loader ships).
 *
 * @module services/pkMode.service
 */

import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import { ChatSerializer } from '@flyff/world-core';

import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'pkMode-service' });

/** v19 client PK-mode toggle values (C++ `OnMode` dispatch table). */
const PK_MODE_ON = 1;

export interface PkModeServiceDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
}

export class PkModeService {
  private readonly chat = new ChatSerializer();
  constructor(private readonly deps: PkModeServiceDeps) {}

  /**
   * Toggle PK mode. `dwMode=1` = on, `0` = off. Idempotent -- repeating the same
   * value is a no-op. Logs the action so a server operator can audit PK toggles.
   */
  toggle(player: CPlayer, dwMode: number): void {
    const pkOn = dwMode === PK_MODE_ON;
    if (player.m_bPKMode === pkOn) return; // idempotent
    player.m_bPKMode = pkOn;
    logger.info(
      { charId: player.m_idPlayer, pkMode: pkOn },
      pkOn ? 'PK mode enabled' : 'PK mode disabled',
    );
    // Notify the player via a vicinity CHAT frame (sent to self). ponytail:
    // real DST_PK_MODE_ON/OFF defined text ids once the table loader ships.
    const msg = pkOn
      ? 'PK Mode: ON. You may now attack other players.'
      : 'PK Mode: OFF. You are safe from PvP combat.';
    this.deps.playerManager.sendTo(player, this.chat.build(player.m_idPlayer, msg));
  }
}