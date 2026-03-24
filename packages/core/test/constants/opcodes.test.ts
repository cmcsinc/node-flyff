/**
 * Tests for packages/core/src/constants/opcodes.ts
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SNSP } from '../../src/constants/opcodes.js';
import type { Snsp } from '../../src/constants/opcodes.js';

describe('SNSP opcodes', () => {
  it('LOGIN_CERTIFY equals 0xFC03', () => {
    assert.equal(SNSP.LOGIN_CERTIFY, 0xFC03);
  });

  it('SERVER_LIST equals 0xFC06', () => {
    assert.equal(SNSP.SERVER_LIST, 0xFC06);
  });

  it('PLAYER_LIST equals 0x7802', () => {
    assert.equal(SNSP.PLAYER_LIST, 0x7802);
  });

  it('CREATE_PLAYER equals 0x7803', () => {
    assert.equal(SNSP.CREATE_PLAYER, 0x7803);
  });

  it('DELETE_PLAYER equals 0x7804', () => {
    assert.equal(SNSP.DELETE_PLAYER, 0x7804);
  });

  it('SELECT_PLAYER equals 0xFC15', () => {
    assert.equal(SNSP.SELECT_PLAYER, 0xFC15);
  });

  it('PLAYER_SNAPSHOOT equals 0x7E12', () => {
    assert.equal(SNSP.PLAYER_SNAPSHOOT, 0x7E12);
  });

  it('CHAT equals 0xFF00', () => {
    assert.equal(SNSP.CHAT, 0xFF00);
  });

  it('MELEE_ATTACK equals 0x7E2C', () => {
    assert.equal(SNSP.MELEE_ATTACK, 0x7E2C);
  });

  it('PING equals 0xFF08', () => {
    assert.equal(SNSP.PING, 0xFF08);
  });

  it('ERROR_CODE equals 0xFFFF', () => {
    assert.equal(SNSP.ERROR_CODE, 0xFFFF);
  });

  it('all values are numbers', () => {
    for (const key of Object.keys(SNSP)) {
      const val = SNSP[key as keyof typeof SNSP];
      assert.equal(typeof val, 'number', `Expected ${key} to be a number`);
    }
  });

  it('all values fit in a 16-bit unsigned integer', () => {
    for (const key of Object.keys(SNSP)) {
      const val = SNSP[key as keyof typeof SNSP];
      assert.ok(val >= 0 && val <= 0xFFFF, `${key} = 0x${val.toString(16)} out of range`);
    }
  });

  it('Object.freeze prevents adding new properties in strict mode', () => {
    assert.throws(() => {
      'use strict';
      // @ts-expect-error — intentionally testing runtime freeze behaviour
      SNSP['FAKE_OPCODE'] = 0x1234;
    });
  });

  it('Snsp type encompasses LOGIN_CERTIFY', () => {
    // Compile-time check — assigning a known value to the Snsp type
    const opcode: Snsp = SNSP.LOGIN_CERTIFY;
    assert.equal(opcode, 0xFC03);
  });
});
