import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Validate } from '../../src/utils/validate';
import { PacketError } from '../../src/errors';

describe('Validate', () => {
  describe('name()', () => {
    it('accepts alphanumeric name within default length', () => {
      assert.doesNotThrow(() => Validate.name('Bob'));
      assert.doesNotThrow(() => Validate.name('Hero123'));
      assert.doesNotThrow(() => Validate.name('a'.repeat(16)));
    });

    it('rejects name shorter than default min (3)', () => {
      assert.throws(() => Validate.name('ab'), PacketError);
      assert.throws(() => Validate.name(''), PacketError);
    });

    it('rejects name longer than default max (16)', () => {
      assert.throws(() => Validate.name('a'.repeat(17)), PacketError);
    });

    it('rejects non-alphanumeric characters', () => {
      assert.throws(() => Validate.name('Hero!'), PacketError);
      assert.throws(() => Validate.name('Hero Hero'), PacketError);
      assert.throws(() => Validate.name('H@ro'), PacketError);
    });

    it('honors custom length bounds', () => {
      // Flyff character names may use a different min/max than account names.
      assert.doesNotThrow(() => Validate.name('Ab', { minLength: 2, maxLength: 8 }));
      assert.throws(() => Validate.name('Ab'), PacketError); // default still 3
      assert.throws(
        () => Validate.name('WayTooLongName', { minLength: 2, maxLength: 8 }),
        PacketError,
      );
    });
  });

  describe('slot()', () => {
    it('accepts slot in [0, max)', () => {
      assert.doesNotThrow(() => Validate.slot(0));
      assert.doesNotThrow(() => Validate.slot(2));
      assert.doesNotThrow(() => Validate.slot(0, 5));
      assert.doesNotThrow(() => Validate.slot(4, 5));
    });

    it('rejects slot at or above max', () => {
      assert.throws(() => Validate.slot(3), PacketError);
      assert.throws(() => Validate.slot(5, 5), PacketError);
    });

    it('rejects negative or non-integer slot', () => {
      assert.throws(() => Validate.slot(-1), PacketError);
      assert.throws(() => Validate.slot(1.5), PacketError);
    });
  });

  describe('dword()', () => {
    it('accepts values in unsigned 32-bit range', () => {
      assert.doesNotThrow(() => Validate.dword(0));
      assert.doesNotThrow(() => Validate.dword(0xFFFFFFFF));
      assert.doesNotThrow(() => Validate.dword(0x5E80));
    });

    it('rejects values outside DWORD range', () => {
      assert.throws(() => Validate.dword(-1), PacketError);
      assert.throws(() => Validate.dword(0x100000000), PacketError);
      assert.throws(() => Validate.dword(1.5), PacketError);
    });
  });

  describe('pos()', () => {
    it('accepts finite coordinates', () => {
      assert.doesNotThrow(() => Validate.pos(0, 0, 0));
      assert.doesNotThrow(() => Validate.pos(3068.0, 31.0, 3176.0));
      assert.doesNotThrow(() => Validate.pos(-100.5, 0, 200.25));
    });

    it('rejects non-finite coordinates', () => {
      assert.throws(() => Validate.pos(NaN, 0, 0), PacketError);
      assert.throws(() => Validate.pos(0, Infinity, 0), PacketError);
      assert.throws(() => Validate.pos(0, 0, -Infinity), PacketError);
    });
  });
});
