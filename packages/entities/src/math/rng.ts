/**
 * `xRandom` (MoverAttack.cpp) -- shared RNG contract used by combat (damage
 * rolls) + quest/drop (kill counters). Lives in entities so both pull one
 * injectable interface without a combat<->quest edge.
 *
 * @module entities/math/rng
 */

/** `xRandom` (MoverAttack.cpp) -- `[0,n)` / `[a,b)` int. Injectable for tests. */
export interface Rng {
  int(max: number): number;
  range(min: number, max: number): number;
}

/** Default rng -- `Math.random`-backed, matches `xRandom` semantics. */
export const xRandomRng: Rng = {
  int: (n) => Math.floor(Math.random() * n),
  range: (a, b) => a + Math.floor(Math.random() * (b - a)),
};
