/**
 * ScriptDlgService — `PACKETTYPE_SCRIPTDLG` (0x00ff00b0).
 *
 * `DPSrvr::OnScriptDialogReq` (DPSrvr.cpp:887) reads:
 *   OBJID objid   String key(256)   int nGlobal1..nGlobal4
 *
 * `__QUEST_1208` rate-limits to 1 dialog per 400ms per player. Then it verifies
 * the NPC exists, the player is within `MAX_LEN_MOVER_MENU` of it, and runs the
 * dialog script.
 *
 * We have no NPC manager or dialog runtime yet. Service enforces the 400ms
 * rate-limit (anti-spam), validates string bounds, and logs the request for
 * diagnostics. ponytail: wire `NpcManager` + dialog runtime.
 *
 * @module services/scriptDlg.service
 */

import type { CPlayer } from '../entities/player.js';

/** C++ `__QUEST_1208` rate limit (`DPSrvr.cpp:903`). */
const SCRIPT_DLG_COOLDOWN_MS = 400;

/** C++ reads `lpKey[256]` — so the wire string can be up to 255 chars. */
const MAX_SCRIPT_KEY = 255;

export interface ScriptDlgFrame {
  objid: number;
  key: string;
  nGlobal1: number;
  nGlobal2: number;
  nGlobal3: number;
  nGlobal4: number;
}

export type ScriptDlgOutcome =
  | { ok: true }
  | { ok: false; reason: 'rate_limited' | 'invalid_target' | 'key_too_long' };

export class ScriptDlgService {
  /** Apply the 400ms rate-limit + validate; log if accepted. */
  dialog(player: CPlayer, frame: ScriptDlgFrame, now: number): ScriptDlgOutcome {
    if (now - player.m_tickScript < SCRIPT_DLG_COOLDOWN_MS) {
      return { ok: false, reason: 'rate_limited' };
    }
    if (frame.key.length > MAX_SCRIPT_KEY) {
      return { ok: false, reason: 'key_too_long' };
    }
    // ponytail: validate objid against NpcManager + MAX_LEN_MOVER_MENU distance.
    player.m_tickScript = now;
    return { ok: true };
  }
}
