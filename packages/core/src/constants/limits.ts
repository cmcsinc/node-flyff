/**
 * Hard game limits (C++ `ProjectCmn.h` / `Mover.h`).
 *
 * @module constants/limits
 */

/**
 * Maximum gold a character can hold (C++ `m_nGold` clamp). The field is a
 * signed 32-bit `int` (`_Common/Mover.h`), so the practical ceiling is just
 * under 2^31. The conventional Flyff cap is 2,000,000,000. Clamp on every
 * grant (rule 03 -- gold/count overflow) so a reward never wraps the field.
 *
 * ponytail: the exact `MAX_GOLD` `#define` was not located in the v15 source
 * slice; if a different value surfaces, swap here.
 */
export const MAX_GOLD = 2_000_000_000;
