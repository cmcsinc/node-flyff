/**
 * S->C NPC dialog menu -- `SNAPSHOTTYPE_RUNSCRIPTFUNC` (0x0024) entries.
 *
 * Mirrors `CUser::AddRunScriptFunc` (`WORLDSERVER/User.cpp:6259`): each
 * `Say`/`AddKey`/`Exit` the dialog script emits becomes one RUNSCRIPTFUNC
 * entry. Entries are batched into a single `PACKETTYPE_SNAPSHOT` frame and
 * applied client-side by `CDPClient::OnRunScriptFunc` (`Neuz/DPClient.cpp:14127`)
 * to the `CWndDialog` the client already opened on click
 * (`_Interface/WndWorld.cpp:5163`). The server sends no "open dialog" packet --
 * it only populates and closes.
 *
 * Per-entry wire layout (after the outer `SNAPSHOT | NULL_ID | cb` preamble):
 *   [objid:DWORD] [SNAPSHOTTYPE_RUNSCRIPTFUNC:WORD] [wFuncType:WORD] [payload]
 *
 * The C++ sender writes `GetId()` (the clicker) as `objid`; the client ignores
 * it for SAY/ADDKEY/EXIT (it uses the `m_idMover` set on click), so the value
 * is decorative -- we pass the player objid to stay faithful.
 *
 * @module net/snapshot/scriptDialog.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import {
  NULL_ID,
  SNAPSHOTTYPE_RUNSCRIPTFUNC,
  FUNCTYPE_SAY,
  FUNCTYPE_ADDKEY,
  FUNCTYPE_ADDANSWER,
  FUNCTYPE_REMOVEKEY,
  FUNCTYPE_REMOVEALLKEY,
  FUNCTYPE_EXIT,
} from './constants.js';

/** One queued dialog operation (the TypeScript mirror of a C++ `RunScriptFunc`). */
export type ScriptFunc =
  | { type: 'say'; text: string; quest?: number }
  | { type: 'addKey'; word: string; key: string; param?: number; quest?: number }
  | { type: 'addAnswer'; word: string; key: string; param?: number; quest?: number }
  | { type: 'removeKey'; key: string }
  | { type: 'removeAllKeys' }
  | { type: 'exit' };

export class ScriptDialogSerializer {
  /**
   * Build one `SNAPSHOT` frame containing `funcs.length` RUNSCRIPTFUNC entries,
   * attributed to `playerObjid` (the clicker). Empty `funcs` returns a frame
   * with `cb=0` -- callers should skip emitting when there is nothing to say.
   */
  build(playerObjid: number, funcs: readonly ScriptFunc[]): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(funcs.length);
    for (const f of funcs) {
      w.writeDword(playerObjid);
      w.writeWord(SNAPSHOTTYPE_RUNSCRIPTFUNC);
      this.writeFunc(w, f);
    }
    return w.build();
  }

  /** Write the `wFuncType` WORD + variant payload for one op. */
  private writeFunc(w: PacketWriter, f: ScriptFunc): void {
    switch (f.type) {
      case 'say':
        w.writeWord(FUNCTYPE_SAY);
        w.writeString(f.text);
        w.writeDword(f.quest ?? 0);
        break;
      case 'addKey':
      case 'addAnswer':
        w.writeWord(f.type === 'addKey' ? FUNCTYPE_ADDKEY : FUNCTYPE_ADDANSWER);
        w.writeString(f.word);
        w.writeString(f.key);
        w.writeDword(f.param ?? 0);
        w.writeDword(f.quest ?? 0);
        break;
      case 'removeKey':
        w.writeWord(FUNCTYPE_REMOVEKEY);
        w.writeString(f.key);
        break;
      case 'removeAllKeys':
        w.writeWord(FUNCTYPE_REMOVEALLKEY);
        break;
      case 'exit':
        w.writeWord(FUNCTYPE_EXIT);
        break;
    }
  }
}
