/**
 * Account form schema checks — the one runnable check behind the create/edit
 * modals. Covers the validation the API route relies on for its guarantee.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CreateAccountSchema, UpdateAccountSchema, fieldErrors } from '../lib/account-form';
import { AUTH } from '@flyff/entities/constants/authority';

describe('CreateAccountSchema', () => {
  it('accepts a minimal valid account and defaults the flags', () => {
    const r = CreateAccountSchema.parse({ username: 'tester', password: 'test' });
    assert.deepEqual(r, {
      username: 'tester',
      password: 'test',
      email: null,
      authority: AUTH.GENERAL,
      banned: false,
    });
  });

  it('maps an empty email to null, not an empty string', () => {
    assert.equal(
      CreateAccountSchema.parse({ username: 'abcd', password: 'test', email: '' }).email,
      null,
    );
  });

  it('rejects usernames the certifier would reject', () => {
    for (const username of ['ab', 'has space', 'dash-es', 'a'.repeat(33), 'unicøde']) {
      assert.equal(
        CreateAccountSchema.safeParse({ username, password: 'test' }).success,
        false,
        `expected reject: ${username}`,
      );
    }
    for (const username of ['ok_4', 'Mixed_Case_9', 'a'.repeat(32)]) {
      assert.equal(
        CreateAccountSchema.safeParse({ username, password: 'test' }).success,
        true,
        username,
      );
    }
  });

  it('rejects short and over-long passwords', () => {
    assert.equal(
      CreateAccountSchema.safeParse({ username: 'abcd', password: 'abc' }).success,
      false,
    );
    assert.equal(
      CreateAccountSchema.safeParse({ username: 'abcd', password: 'a'.repeat(21) }).success,
      false,
    );
  });
});

describe('UpdateAccountSchema', () => {
  it('requires at least one field besides the id', () => {
    assert.equal(UpdateAccountSchema.safeParse({ id: 1 }).success, false);
    assert.equal(
      UpdateAccountSchema.safeParse({ id: 1, authority: AUTH.GAMEMASTER }).success,
      true,
    );
  });

  it('rejects an authority value outside the AUTH_* ladder', () => {
    assert.equal(UpdateAccountSchema.safeParse({ id: 1, authority: 0x99 }).success, false);
    assert.equal(UpdateAccountSchema.safeParse({ id: 1, authority: 0 }).success, false);
  });

  it('treats an omitted password as unchanged (absent, not empty)', () => {
    const r = UpdateAccountSchema.parse({ id: 1, authority: AUTH.GAMEMASTER });
    assert.equal('password' in r, false);
  });

  it('rejects an empty password rather than accepting it as a new one', () => {
    assert.equal(UpdateAccountSchema.safeParse({ id: 1, password: '' }).success, false);
  });

  it('maps an empty bannedUntil to null and accepts an ISO stamp', () => {
    assert.equal(UpdateAccountSchema.parse({ id: 1, bannedUntil: '' }).bannedUntil, null);
    const iso = new Date('2030-01-02T03:04:05Z').toISOString();
    assert.equal(UpdateAccountSchema.parse({ id: 1, bannedUntil: iso }).bannedUntil, iso);
    assert.equal(
      UpdateAccountSchema.safeParse({ id: 1, bannedUntil: '2030-01-02' }).success,
      false,
    );
  });
});

describe('fieldErrors', () => {
  it('keys messages by field so the form can render them inline', () => {
    const errs = fieldErrors(CreateAccountSchema, { username: 'ab', password: 'x' });
    assert.deepEqual(Object.keys(errs).sort(), ['password', 'username']);
    assert.match(errs.username, /4 characters/);
  });

  it('returns an empty object when valid', () => {
    assert.deepEqual(
      fieldErrors(CreateAccountSchema, { username: 'tester', password: 'test' }),
      {},
    );
  });
});
