/**
 * `CMover::m_dwMode` bit flags -- mirrors `_Common/authorization.h:18-56`.
 *
 * Set/cleared by GM `/cmd` toggles (`TextCmd_Undying`/`Onekill`/`Invisible`/
 * `ItemMode`/`AttackMode`/`CommunityMode`/`ObserveMode`/`ExpUpStop`...) and
 * broadcast to peers via `SNAPSHOTTYPE_MODIFYMODE` so the client re-renders
 * the mover's mode. Transient -- never persisted, resets to 0 each session
 * (matches C++; `m_dwMode` is not in the DB row).
 *
 * Only the flags the wired commands touch are listed; add more from
 * authorization.h as commands ship.
 *
 * @module constants/mode
 */

export const MODE = Object.freeze({
  /** Undying (invulnerable). authorization.h:20 -- `MATCHLESS_MODE`. */
  MATCHLESS: 0x00000001,
  /** Invisibility. authorization.h:21 -- `TRANSPARENT_MODE`. Toggled by `/inv`. */
  TRANSPARENT: 0x00000002,
  /** One-shot kill. authorization.h:22 -- `ONEKILL_MODE`. Toggled by `/ok`. */
  ONEKILL: 0x00000004,
  /** No-attack. authorization.h:26 -- `NO_ATTACK_MODE`. Toggled by `/gmattck`. */
  NO_ATTACK: 0x00000040,
  /** Item-locked. authorization.h:27 -- `ITEM_MODE`. Toggled by `/gmitem`. */
  ITEM: 0x00000080,
  /** Community-locked. authorization.h:28 -- `COMMUNITY_MODE`. Toggled by `/gmcommunity`. */
  COMMUNITY: 0x00000100,
  /**
   * Undying tier-2. authorization.h:25 -- `MATCHLESS2_MODE`. Cleared when
   * MATCHLESS is set (`TextCmd_Undying`, FuncTextCmd.cpp:3109).
   */
  MATCHLESS2: 0x00000020,
  /**
   * Observe composite. authorization.h:55 -- `OBSERVE_MODE` =
   * `ITEM_MODE | NO_ATTACK_MODE | SHOUTTALK_MODE | SAYTALK_MODE`. Toggled as a
   * unit by `/gmobserve` (`TextCmd_ObserveMode`, FuncTextCmd.cpp:3521). We only
   * carry the bits we model, so the live value is `ITEM | NO_ATTACK` (0xc0);
   * the two talk bits are no-ops without a mute pipeline (ponytail).
   */
  OBSERVE: 0x000000c0,
  /**
   * Exp-gain frozen. authorization.h:40 -- `MODE_EXPUP_STOP`. Toggled (no /no
   * pair) by `/es` (`TextCmd_ExpUpStop`, FuncTextCmd.cpp:2989). Honored by the
   * exp-grant path (ponytail: `CombatService.grantExp` early-out once wired).
   */
  EXPUP_STOP: 0x00040000,
} as const);
