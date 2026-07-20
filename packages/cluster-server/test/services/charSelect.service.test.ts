import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { CharSelectService } from '../../src/services/charSelect.service.js';
import type { AccountRepository } from '@flyff/database';
import type { CharacterRepository } from '@flyff/database';

describe('CharSelectService', () => {
  let service: CharSelectService;
  let published: Array<{ charId: number; token: string; worldId: string }>;

  before(() => {
    published = [];
    const accountRepo = {
      findByUsername: async (u: string) =>
        u === 'alice' ? { id: 10, username: 'alice' } as any : null,
    } as unknown as AccountRepository;
    const charRepo = {
      findById: async (id: number) =>
        id === 77
          ? ({ id: 77, account_id: 10, name: 'Hero', world_id: 'world1' } as any)
          : null,
    } as unknown as CharacterRepository;
    const tokenService = { generateWorldHandoffToken: async () => 'world-token' };
    const handoffPublisher = {
      publish: async (charId: number, token: string, worldId: string) => {
        published.push({ charId, token, worldId });
      },
    };
    service = new CharSelectService({
      accountRepo,
      charRepo,
      tokenService,
      handoffPublisher,
    });
  });

  it('issues a world handoff token and publishes IPC on valid prejoin', async () => {
    const r = await service.prejoin('alice', 77, 'Hero');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.charId, 77);
      assert.equal(r.token, 'world-token');
    }
    assert.equal(published.length, 1);
    assert.equal(published[0].charId, 77);
    assert.equal(published[0].token, 'world-token');
    assert.equal(published[0].worldId, 'world1');
  });

  it('rejects when account is unknown', async () => {
    const r = await service.prejoin('eve', 77, 'Hero');
    assert.equal(r.ok, false);
  });

  it('rejects when character does not exist', async () => {
    const r = await service.prejoin('alice', 999, 'Nope');
    assert.equal(r.ok, false);
  });

  it('rejects when name does not match the character', async () => {
    const r = await service.prejoin('alice', 77, 'Imposter');
    assert.equal(r.ok, false);
  });
});
