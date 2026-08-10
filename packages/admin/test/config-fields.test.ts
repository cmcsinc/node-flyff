import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CONFIG_FIELDS, addToken, getAtPath, setAtPath } from '../lib/config-fields';

describe('addToken', () => {
  it('appends a trimmed token', () => {
    assert.deepEqual(addToken(['world_1'], '  world_2 '), ['world_1', 'world_2']);
  });

  it('is a no-op for blanks and duplicates (same length back)', () => {
    assert.deepEqual(addToken(['world_1'], '   '), ['world_1']);
    assert.deepEqual(addToken(['world_1'], 'world_1'), ['world_1']);
  });

  it('does not mutate the input', () => {
    const before = ['world_1'];
    addToken(before, 'world_2');
    assert.deepEqual(before, ['world_1']);
  });
});

describe('getAtPath', () => {
  it('reads nested values and returns undefined for missing segments', () => {
    const obj = { registration: { clusterInternalPort: 29000 } };
    assert.equal(getAtPath(obj, 'registration.clusterInternalPort'), 29000);
    assert.equal(getAtPath(obj, 'registration.missing'), undefined);
    assert.equal(getAtPath(obj, 'nope.deep.deeper'), undefined);
  });
});

describe('setAtPath', () => {
  it('writes nested values without mutating the input', () => {
    const before = { log: { level: 'info' } };
    const after = setAtPath(before, 'registration.clusterInternalPort', 29005);
    assert.deepEqual(before, { log: { level: 'info' } });
    assert.deepEqual(after, {
      log: { level: 'info' },
      registration: { clusterInternalPort: 29005 },
    });
  });

  it('deletes the leaf and prunes empty parents when value is undefined', () => {
    const obj = { log: { level: 'debug' }, registration: { loginInternalPort: 29001 } };
    const out = setAtPath(obj, 'registration.loginInternalPort', undefined);
    assert.deepEqual(out, { log: { level: 'debug' } });
  });

  it('keeps siblings when only one leaf is cleared', () => {
    const obj = { registration: { loginHost: '127.0.0.1', loginInternalPort: 29001 } };
    const out = setAtPath(obj, 'registration.loginInternalPort', undefined);
    assert.deepEqual(out, { registration: { loginHost: '127.0.0.1' } });
  });
});

describe('CONFIG_FIELDS', () => {
  it('exposes the connecting-server ports the operator must align', () => {
    const paths = (t: 'login' | 'cluster' | 'world'): string[] =>
      CONFIG_FIELDS[t].flatMap((s) => s.fields.map((f) => f.path));
    assert.ok(paths('world').includes('registration.clusterInternalPort'));
    assert.ok(paths('world').includes('registration.clusterHost'));
    assert.ok(paths('cluster').includes('registration.loginInternalPort'));
    assert.ok(paths('cluster').includes('registration.internalPort'));
    assert.ok(paths('login').includes('registration.internalPort'));
  });

  it('has unique paths per type and choice fields declare their source', () => {
    for (const type of ['login', 'cluster', 'world'] as const) {
      const fields = CONFIG_FIELDS[type].flatMap((s) => s.fields);
      const paths = fields.map((f) => f.path);
      assert.equal(new Set(paths).size, paths.length, `${type} has duplicate paths`);
      for (const f of fields) {
        if (f.kind === 'select') assert.ok(f.options?.length, `${f.path} missing options`);
        if (f.kind === 'multiselect') assert.ok(f.optionsFrom, `${f.path} missing optionsFrom`);
      }
    }
  });

  it('sources allowed world ids from registered world instances', () => {
    const f = CONFIG_FIELDS.cluster
      .flatMap((s) => s.fields)
      .find((x) => x.path === 'registration.allowedWorlds');
    assert.equal(f?.kind, 'multiselect');
    assert.equal(f.optionsFrom, 'world');
  });
});
