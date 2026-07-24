/**
 * isJobMatch -- the skill-learn job-lineage gate. A skill is learnable iff the
 * player's job descends from the skill's JOB_*.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { isJobMatch } from '@flyff/entities';

describe('isJobMatch (job-lineage gate)', () => {
  it('vagrant/common skills (job 0) are universal', () => {
    for (const playerJob of [0, 1, 4, 13, 24, 31]) {
      assert.equal(isJobMatch(playerJob, 0), true, `job ${playerJob} should learn vagrant skills`);
    }
  });

  it('a job learns its own expert skills', () => {
    assert.equal(isJobMatch(1, 1), true);  // MERCENARY
    assert.equal(isJobMatch(4, 4), true);  // MAGICIAN
  });

  it('a 2nd-job player learns its 1st-job base skills (lineage up)', () => {
    // KNIGHT descends from MERCENARY -> learns MERCENARY skills.
    assert.equal(isJobMatch(6, 1), true);
    // ELEMENTOR descends from MAGICIAN.
    assert.equal(isJobMatch(13, 4), true);
    // BILLPOSTER descends from ASSIST.
    assert.equal(isJobMatch(11, 3), true);
  });

  it('a 1st-job player CANNOT learn a 2nd-job skill (lineage is upstream only)', () => {
    // MERCENARY cannot learn KNIGHT-only skills.
    assert.equal(isJobMatch(1, 6), false);
    // MAGICIAN cannot learn ELEMENTOR skills.
    assert.equal(isJobMatch(4, 13), false);
  });

  it('a hero player learns the whole ancestor chain', () => {
    // KNIGHT_HERO descends KNIGHT_MASTER <- KNIGHT <- MERCENARY <- VAGRANT.
    assert.equal(isJobMatch(24, 6), true);   // pro skill
    assert.equal(isJobMatch(24, 16), true);  // master skill
    assert.equal(isJobMatch(24, 1), true);   // expert skill
    assert.equal(isJobMatch(24, 0), true);   // vagrant
  });

  it('sibling branches are rejected', () => {
    // KNIGHT cannot learn BLADE skills (different 2nd-job branch).
    assert.equal(isJobMatch(6, 7), false);
    // JESTER cannot learn RANGER skills.
    assert.equal(isJobMatch(8, 9), false);
    // BILLPOSTER cannot learn RINGMASTER skills.
    assert.equal(isJobMatch(11, 10), false);
  });

  it('master/hero skills are locked to their own lineage', () => {
    // KNIGHT_MASTER skill learnable by KNIGHT_MASTER + KNIGHT_HERO only.
    assert.equal(isJobMatch(16, 16), true);
    assert.equal(isJobMatch(24, 16), true);
    assert.equal(isJobMatch(6, 16), false);  // plain KNIGHT cannot learn master skill
  });

  it('fail-closed on out-of-range player job', () => {
    assert.equal(isJobMatch(99, 0), true);   // vagrant still universal
    assert.equal(isJobMatch(99, 1), false);  // garbage job grants nothing
    assert.equal(isJobMatch(-1, 1), false);
  });
});
