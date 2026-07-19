import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { CharCreateService } from '../../src/services/charCreate.service.js';
import type { AccountRepository } from '@flyff/database';
import type { CharacterRepository } from '@flyff/database';
import type { CharDefaults } from '../../src/services/charCreate.service.js';

const defaults: CharDefaults = {
  maxPerAccount: 3,
  startMap: 'WI_WORLD_MADRIGAL',
  startX: 3068.0,
  startY: 31.0,
  startZ: 3176.0,
  startLevel: 1,
};

describe('CharCreateService', () => {
  let service: CharCreateService;
  let accountRepo: AccountRepository;
  let charRepo: CharacterRepository;
  let stored: Array<{ accountId: number; name: string; slot: number; sex: number }>;

  before(() => {
    stored = [];
    accountRepo = {
      findByUsername: async (u: string) =>
        u === 'alice' ? { id: 10, username: 'alice' } as any : null,
    } as unknown as AccountRepository;
    charRepo = {
      nameExists: async (name: string) =>
        stored.some((s) => s.name === name),
      slotOccupied: async (_a: number, slot: number) =>
        stored.some((s) => s.slot === slot),
      countByAccountId: async (a: number) =>
        stored.filter((s) => s.accountId === a).length,
      create: async (data: any) => {
        const id = stored.length + 1;
        stored.push({ accountId: data.account_id, name: data.name, slot: data.slot, sex: data.gender });
        return id;
      },
      findById: async (id: number) =>
        stored[id - 1]
          ? ({ id, account_id: stored[id - 1].accountId, name: stored[id - 1].name } as any)
          : null,
      delete: async (id: number) => {
        stored.splice(id - 1, 1);
      },
    } as unknown as CharacterRepository;
    service = new CharCreateService(accountRepo, charRepo, defaults);
  });

  describe('create()', () => {
    it('creates a character on valid input', async () => {
      const r = await service.create({
        account: 'alice', slot: 0, name: 'NewHero',
        skinSet: 4, hairMesh: 1, hairColor: 2, headMesh: 3, sex: 0, job: 0,
      });
      assert.equal(r.ok, true);
      if (r.ok) assert.ok(r.charId > 0);
    });

    it('rejects an invalid name', async () => {
      const r = await service.create({
        account: 'alice', slot: 1, name: 'bad name!',
        skinSet: 0, hairMesh: 0, hairColor: 0, headMesh: 0, sex: 0, job: 0,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.errorCode, 111); // ERROR_INVALID_NAME_CHARACTER
    });

    it('rejects a duplicate name', async () => {
      await service.create({
        account: 'alice', slot: 1, name: 'Dup',
        skinSet: 0, hairMesh: 0, hairColor: 0, headMesh: 0, sex: 0, job: 0,
      });
      const r = await service.create({
        account: 'alice', slot: 2, name: 'Dup',
        skinSet: 0, hairMesh: 0, hairColor: 0, headMesh: 0, sex: 0, job: 0,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.errorCode, 113); // ERROR_USER_EXISTS
    });

    it('rejects an out-of-range slot', async () => {
      const r = await service.create({
        account: 'alice', slot: 5, name: 'Slotter',
        skinSet: 0, hairMesh: 0, hairColor: 0, headMesh: 0, sex: 0, job: 0,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.errorCode, 106); // ERROR_SLOT_OUTOFRANGE
    });

    it('rejects an occupied slot', async () => {
      const r = await service.create({
        account: 'alice', slot: 0, name: 'Taken',
        skinSet: 0, hairMesh: 0, hairColor: 0, headMesh: 0, sex: 0, job: 0,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.errorCode, 105); // ERROR_DUPLICATE_SLOT
    });

    it('rejects when account does not exist', async () => {
      const r = await service.create({
        account: 'ghost', slot: 0, name: 'Phantom',
        skinSet: 0, hairMesh: 0, hairColor: 0, headMesh: 0, sex: 0, job: 0,
      });
      assert.equal(r.ok, false);
    });
  });

  describe('delete()', () => {
    it('deletes a character owned by the account', async () => {
      const created = await service.create({
        account: 'alice', slot: 2, name: 'Deletable',
        skinSet: 0, hairMesh: 0, hairColor: 0, headMesh: 0, sex: 0, job: 0,
      });
      if (!created.ok) throw new Error('setup failed');
      const r = await service.delete('alice', created.charId);
      assert.equal(r.ok, true);
    });

    it('refuses to delete a character not owned by the account', async () => {
      const created = await service.create({
        account: 'alice', slot: 2, name: 'Owned2',
        skinSet: 0, hairMesh: 0, hairColor: 0, headMesh: 0, sex: 0, job: 0,
      });
      if (!created.ok) throw new Error('setup failed');
      const r = await service.delete('eve', created.charId);
      assert.equal(r.ok, false);
    });
  });
});
