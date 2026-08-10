import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { planJobChange, jobTier, gpForLevel, BASE_STAT } from '../lib/job-change';

const RESET = {
  strength: BASE_STAT,
  dexterity: BASE_STAT,
  stamina: BASE_STAT,
  intelligence: BASE_STAT,
};

describe('jobTier', () => {
  it('maps defineJob.h boundaries', () => {
    assert.equal(jobTier(0), 'base'); // JOB_VAGRANT
    assert.equal(jobTier(1), 'expert'); // JOB_MERCENARY
    assert.equal(jobTier(5), 'expert'); // JOB_PUPPETEER (MAX_EXPERT-1)
    assert.equal(jobTier(6), 'pro'); // JOB_KNIGHT
    assert.equal(jobTier(15), 'pro'); // JOB_DOPPLER (MAX_PROFESSIONAL-1)
    assert.equal(jobTier(16), 'master'); // JOB_KNIGHT_MASTER
    assert.equal(jobTier(24), 'hero'); // JOB_KNIGHT_HERO
    assert.equal(jobTier(32), 'legend'); // JOB_LORDTEMPLER_HERO
    assert.equal(jobTier(40), null); // MAX_LEGEND_HERO
    assert.equal(jobTier(-1), null);
  });
});

describe('gpForLevel', () => {
  it("matches InitStat's (level - 1) * 2", () => {
    assert.equal(gpForLevel(1), 0);
    assert.equal(gpForLevel(15), 28);
    assert.equal(gpForLevel(60), 118);
    assert.equal(gpForLevel(120), 238);
  });
});

describe('planJobChange', () => {
  it("Vagrant lv1 -> Mercenary fills level 15, GP 28, stats reset (the user's example)", () => {
    const plan = planJobChange(1, { level: 1, remainGp: 0 });
    assert.ok(plan);
    assert.equal(plan.level, 15);
    assert.equal(plan.remainGp, 28);
    assert.deepEqual(plan.stats, RESET);
  });

  it('all four 1st jobs behave identically', () => {
    for (const job of [1, 2, 3, 4]) {
      const plan = planJobChange(job, { level: 1, remainGp: 0 });
      assert.equal(plan?.level, 15, `job ${String(job)}`);
      assert.equal(plan.remainGp, 28, `job ${String(job)}`);
    }
  });

  it('2nd job goes to level 60 and carries stats/GP (mada_* scripts omit InitStat)', () => {
    const plan = planJobChange(6, { level: 15, remainGp: 5 });
    assert.equal(plan?.level, 60);
    assert.equal(plan.remainGp, 5);
    assert.equal(plan.stats, null);
  });

  it('Master resets to level 60 with GP 118 (InitStat + SetLevel(60) + AddGPPoint(-120))', () => {
    const plan = planJobChange(16, { level: 120, remainGp: 200 });
    assert.equal(plan?.level, 60);
    assert.equal(plan.remainGp, 118);
    assert.deepEqual(plan.stats, RESET);
  });

  it('Hero goes to 121 and adds 15 GP without touching stats', () => {
    const plan = planJobChange(24, { level: 120, remainGp: 3 });
    assert.equal(plan?.level, 121);
    assert.equal(plan.remainGp, 18);
    assert.equal(plan.stats, null);
  });

  it('Legend requires 130 and changes nothing else', () => {
    const plan = planJobChange(32, { level: 130, remainGp: 7 });
    assert.equal(plan?.level, 130);
    assert.equal(plan.remainGp, 7);
    assert.equal(plan.stats, null);
    // Below the gate it still floors at 130 rather than lowering the character.
    assert.equal(planJobChange(32, { level: 100, remainGp: 0 })?.level, 130);
    assert.equal(planJobChange(32, { level: 145, remainGp: 0 })?.level, 145);
  });

  it('back to Vagrant resets to level 1 / GP 0', () => {
    const plan = planJobChange(0, { level: 60, remainGp: 40 });
    assert.equal(plan?.level, 1);
    assert.equal(plan.remainGp, 0);
    assert.deepEqual(plan.stats, RESET);
  });

  it('returns null for an out-of-range job', () => {
    assert.equal(planJobChange(255, { level: 1, remainGp: 0 }), null);
  });
});
