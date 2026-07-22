/**
 * Taskbar handlers -- bind/clear hotkey shortcuts.
 *
 * `WORLDSERVER/DPSrvr.cpp`:
 *   ADDITEMTASKBAR     0xffffff0c (:2203): `BYTE nSlotIndex, BYTE nIndex,
 *     DWORD dwShortcut, DWORD dwId, DWORD dwType, DWORD dwIndex, DWORD dwUserId,
 *     DWORD dwData` (+ String szString when dwShortcut==SHORTCUT_CHAT).
 *   REMOVEITEMTASKBAR  0xffffff0d (:2251): `BYTE nSlotIndex, BYTE nIndex`.
 *
 * Both handlers store/clear the slot in-memory and send no ack (matches C++ --
 * the client manages its own taskbar UI; the server only tracks bindings for
 * later hotkey-triggered validation). Rejected paths are silent.
 *
 * @module handlers/taskbar
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { Validate } from '@flyff/core/utils/validate.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { TaskBarService } from '../services/taskbar.service.js';
import type { Shortcut } from '../entities/player.js';
import { SHORTCUT, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM, MAX_SHORTCUT_STRING } from '../net/snapshot/constants.js';

const logger = createLogger({ module: 'taskbar-handler' });

export interface TaskBarHandlerDeps {
  playerManager: PlayerManager;
  taskbarService: TaskBarService;
}

export class TaskBarHandler {
  constructor(private readonly deps: TaskBarHandlerDeps) {}

  handleAddItem(socket: ClientSocket, reader: PacketReader): void {
    this.run(socket, reader, (player, r) => {
      const slotIndex = r.readByte();
      const index = r.readByte();
      Validate.slot(slotIndex, MAX_SLOT_ITEM_COUNT);
      Validate.slot(index, MAX_SLOT_ITEM);

      const shortcut: Shortcut = {
        dwShortcut: r.readDword(),
        dwId: r.readDword(),
        dwType: r.readDword(),
        dwIndex: r.readDword(),
        dwUserId: r.readDword(),
        dwData: r.readDword(),
      };
      for (const v of Object.values(shortcut)) Validate.dword(v);
      if (shortcut.dwShortcut === SHORTCUT.CHAT) {
        shortcut.szString = r.readString();
        Validate.string(shortcut.szString, 0, MAX_SHORTCUT_STRING);
      }

      const res = this.deps.taskbarService.addItem(player, slotIndex, index, shortcut);
      if (!res.ok) {
        logger.debug({ charId: player.m_idPlayer, slotIndex, index, reason: res.reason }, 'ADDITEMTASKBAR rejected');
        return;
      }
      logger.debug({ charId: player.m_idPlayer, slotIndex, index, dwShortcut: shortcut.dwShortcut }, 'ADDITEMTASKBAR ok');
    });
  }

  handleRemoveItem(socket: ClientSocket, reader: PacketReader): void {
    this.run(socket, reader, (player, r) => {
      const slotIndex = r.readByte();
      const index = r.readByte();
      Validate.slot(slotIndex, MAX_SLOT_ITEM_COUNT);
      Validate.slot(index, MAX_SLOT_ITEM);
      this.deps.taskbarService.removeItem(player, slotIndex, index);
      logger.debug({ charId: player.m_idPlayer, slotIndex, index }, 'REMOVEITEMTASKBAR ok');
    });
  }

  /** Shared session/player guard + PacketError swallow. */
  private run(
    socket: ClientSocket,
    reader: PacketReader,
    body: (player: NonNullable<ReturnType<PlayerManager['get']>>, reader: PacketReader) => void,
  ): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }
    try {
      body(player, reader);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'taskbar parse failed');
        return;
      }
      throw error;
    }
  }
}
