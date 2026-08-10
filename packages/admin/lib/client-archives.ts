/**
 * The client's archive set.
 *
 * Its own module so `client-patch` (which patches archives) and
 * `client-auth-file` (which hashes their members) can both name it without one
 * importing the other — an import cycle between them would leave whichever
 * module loaded second holding an uninitialized binding.
 *
 * Order is `game/resource/resource.txt`'s: `data.res` (101 members),
 * `dataSub1.res` (28), `dataSub2.res` (5).
 *
 * @module lib/client-archives
 */

/** Archives the client loads, in `resource.txt` order. */
export const ARCHIVES = ['data.res', 'dataSub1.res', 'dataSub2.res'] as const;

/** True when `name` is one of the client's archives. */
export function isArchive(name: string): boolean {
  return (ARCHIVES as readonly string[]).includes(name);
}
