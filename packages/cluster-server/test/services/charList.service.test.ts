import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { CharListService } from '../../src/services/charList.service.js';
import type { AccountRepository } from '@flyff/database';
import type { CharacterRepository, CharacterRow } from '@flyff/database';

function makeChar(id: number, name: string): CharacterRow {
  return {
    id, account_id: 10, name, slot: id, class: 0, gender: 0,
    hair_style: 1, hair_color: 1, face_style: 1, skin_color: 1,
    level: 1, exp: BigInt(0), hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'WI_WORLD_MADRIGAL', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
  } as unknown as CharacterRow;
}

describe('CharListService', () => {
  let service: CharListService;
  let mockAccountRepo: AccountRepository;
  let mockCharRepo: CharacterRepository;

  before(() => {
    mockAccountRepo = {
      findByUsername: async (u: string) =>
        u === 'alice' ? { id: 10, username: 'alice' } as any : null,
    } as unknown as AccountRepository;
    mockCharRepo = {
      findByAccountId: async (id: number) =>
        id === 10 ? [makeChar(1, 'A'), makeChar(2, 'B')] : [],
    } as unknown as CharacterRepository;
    service = new CharListService(mockAccountRepo, mockCharRepo);
  });

  it('returns characters for a known account', async () => {
    const chars = await service.listByAccount('alice');
    assert.equal(chars.length, 2);
    assert.equal(chars[0].name, 'A');
  });

  it('returns empty list for unknown account', async () => {
    const chars = await service.listByAccount('nobody');
    assert.equal(chars.length, 0);
  });
});
