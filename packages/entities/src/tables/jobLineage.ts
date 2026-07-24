/**
 * Flyff class lineage -- the parent-of map for the 32 `defineJob.h` jobs.
 *
 * Companion to {@link ./job} (the propJob.inc stat table). Where that file
 * holds per-job combat factors, this one holds the class tree used to gate
 * skill learning: a skill whose `dwItemKind2` (JOB_*) is `S` is learnable by a
 * player whose job is `P` iff `S` is in the ancestor chain of `P` (inclusive).
 *
 * Tree (defineJob.h):
 *
 * ```
 * VAGRANT(0)
 * ├─ MERCENARY(1) ─┬─ KNIGHT(6)  ── KNIGHT_MASTER(16)  ── KNIGHT_HERO(24)
 * │                └─ BLADE(7)   ── BLADE_MASTER(17)   ── BLADE_HERO(25)
 * ├─ ACROBAT(2)   ─┬─ JESTER(8)  ── JESTER_MASTER(18)  ── JESTER_HERO(26)
 * │                └─ RANGER(9)  ── RANGER_MASTER(19)  ── RANGER_HERO(27)
 * ├─ ASSIST(3)    ─┬─ RINGMASTER(10) ── RINGMASTER_MASTER(20) ── RINGMASTER_HERO(28)
 * │                └─ BILLPOSTER(11)  ── BILLPOSTER_MASTER(21)  ── BILLPOSTER_HERO(29)
 * ├─ MAGICIAN(4)  ─┬─ PSYCHIKEEPER(12) ── PSYCHIKEEPER_MASTER(22) ── PSYCHIKEEPER_HERO(30)
 * │                └─ ELEMENTOR(13)    ── ELEMENTOR_MASTER(23)    ── ELEMENTOR_HERO(31)
 * ├─ PUPPETEER(5) -- v15 stub, no pro skills
 * ├─ GATEKEEPER(14) / DOPPLER(15) -- unused, orphaned to root
 * ```
 *
 * Mirrors the C++ job-match check implicit in `CProject::IsLearnSkill` /
 * `propSkill` `dwItemKind2` filtering: the player's job must descend from the
 * skill's job. VAGRANT(0) is root, so `skillJob === 0` (common/vagrant skills)
 * is learnable by every job.
 *
 * @module entities/tables/jobLineage
 */

/** JOB_* id -> parent JOB_* id. Root (VAGRANT) maps to itself. */
const JOB_PARENT: ReadonlyMap<number, number> = new Map<number, number>([
  // Base
  [0, 0], // VAGRANT (root)
  // Expert (1st job)
  [1, 0], [2, 0], [3, 0], [4, 0], [5, 0],
  // Professional (2nd job) -- offset +5 from expert parent
  [6, 1], [7, 1], [8, 2], [9, 2], [10, 3], [11, 3], [12, 4], [13, 4],
  // Unused v15 stubs -- orphan to root so they only self-match.
  [14, 0], [15, 0],
  // Master -- parent is the matching pro job (offset -10).
  [16, 6], [17, 7], [18, 8], [19, 9], [20, 10], [21, 11], [22, 12], [23, 13],
  // Hero -- parent is the matching master job (offset -8).
  [24, 16], [25, 17], [26, 18], [27, 19], [28, 20], [29, 21], [30, 22], [31, 23],
]);

/** Ancestor chain of `playerJob` from the job itself up to VAGRANT, inclusive. */
function lineageUp(playerJob: number): Set<number> {
  const chain = new Set<number>();
  let job = playerJob;
  // Bound the walk -- a corrupt/garbage job id must not spin forever.
  for (let i = 0; i < 8; i++) {
    chain.add(job);
    const parent = JOB_PARENT.get(job);
    if (parent === undefined || parent === job) break;
    job = parent;
  }
  return chain;
}

/**
 * `IsLearnSkill` job-match gate: a skill whose `dwItemKind2` is `skillJob` is
 * learnable by a player whose current job is `playerJob` iff `skillJob` is an
 * ancestor of `playerJob` (inclusive). VAGRANT(0)/common skills match all jobs.
 *
 * Out-of-range jobs fall back to the empty lineage so a garbage playerJob never
 * grants a skill it should not (fail-closed).
 */
export function isJobMatch(playerJob: number, skillJob: number): boolean {
  if (skillJob === 0) return true; // vagrant/common -- universal
  if (playerJob < 0 || playerJob > 31) return false;
  return lineageUp(playerJob).has(skillJob);
}
