/**
 * TASKBAR S->C snapshot -- repopulate the F1-F9 hotkey grid on JOIN.
 *
 * `SNAPSHOTTYPE_TASKBAR` (0x0097, `_Network/MsgHdr.h:1033`). Body mirrors the
 * storing branch of `CUserTaskBar::Serialize` (`_Interface/UserTaskBar.cpp:61`):
 *
 *   [appletCount:DWORD]  appletCount entries: [i][6 DWORDs][+chat]
 *   [itemCount:DWORD]    itemCount entries:   [i][j][6 DWORDs][+chat]
 *   [queueCount:DWORD]   queueCount entries:  [i][6 DWORDs]
 *   [actionPoint:DWORD]
 *
 * The client (`CDPClient::OnTaskBar`, `Neuz/DPClient.cpp:4215`) hands the body
 * to `CWndTaskBar::Serialize` which rebuilds the grid. Only `m_aSlotItem`
 * (items/skills/emotes/chat) ships -- applet + skill-queue grids have no
 * handlers yet, so their counts are 0 and actionPoint is 0.
 *
 * Same SNAPSHOT frame as `setPos`/`setExperience`:
 *   [SNAPSHOT:DWORD][objidPlayer:DWORD][cb:WORD][ [objid:DWORD][hdr:WORD][body] ]
 *
 * @module net/snapshot/taskbar
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { Shortcut } from '../../entities/player.js';
import { SHORTCUT, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM, NULL_ID } from './constants.js';

export class TaskBarSnapshotSerializer {
  /** Build the SNAPSHOT/TASKBAR payload for `player`'s bound grid. */
  build(objid: number, grid: ReadonlyArray<ReadonlyArray<Shortcut>>): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);                 // objidPlayer -- unused client-side
    w.writeWord(1);                        // cb = 1 entry
    w.writeDword(objid);
    w.writeWord(0x0097);                   // SNAPSHOTTYPE_TASKBAR

    w.writeDword(0);                       // appletCount -- applet grid not wired

    // Item grid -- buffer non-empty slots so count precedes entries (C++ skips
    // SHORTCUT_NONE). Grid is 8x9 so the array is tiny.
    const entries: Array<{ i: number; j: number; slot: Shortcut }> = [];
    for (let i = 0; i < MAX_SLOT_ITEM_COUNT && i < grid.length; i++) {
      const row = grid[i]!;
      for (let j = 0; j < MAX_SLOT_ITEM && j < row.length; j++) {
        const slot = row[j]!;
        if (slot.dwShortcut !== SHORTCUT.NONE) entries.push({ i, j, slot });
      }
    }
    w.writeDword(entries.length);          // itemCount
    for (const { i, j, slot } of entries) {
      w.writeDword(i);
      w.writeDword(j);
      w.writeDword(slot.dwShortcut);
      w.writeDword(slot.dwId);
      w.writeDword(slot.dwType);
      w.writeDword(slot.dwIndex);
      w.writeDword(slot.dwUserId);
      w.writeDword(slot.dwData);
      if (slot.dwShortcut === SHORTCUT.CHAT) w.writeString(slot.szString ?? '');
    }

    w.writeDword(0);                       // queueCount -- skill queue not wired
    w.writeDword(0);                       // actionPoint
    return w.build();
  }
}
