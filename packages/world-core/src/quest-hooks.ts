/**
 * QuestHooks -- the seam through which the (Stage 3) `@flyff/quest` package
 * receives kill/move events WITHOUT combat or movement taking a hard dependency
 * on quest. Both `CombatService` and `MovementService` (in their domain
 * packages) will accept a `QuestHooks` and call it; `compose.ts` binds the
 * concrete `QuestTrackerSystem` instance at wiring time.
 *
 * Lives in `@flyff/world-core` so combat/movement/quest all share one type
 * without any of them importing each other.
 *
 * @module world-core/quest-hooks
 */

import type { CPlayer, CMover } from '@flyff/entities';

export interface QuestHooks {
  /** Fired by CombatService when a mover dies (killer gets kill credit). */
  onKill(mover: CMover, killer: CPlayer): void;
  /** Fired by MovementService on each accepted player position update. */
  onPlayerMoved(p: CPlayer): void;
}
