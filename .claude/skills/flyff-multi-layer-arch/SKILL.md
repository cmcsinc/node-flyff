---
name: flyff-multi-layer-arch
description: >
  Multi-layer clean architecture for the Flyff TypeScript emulator: Handler → Service →
  Repository layering, dependency injection, separation of concerns, TypeScript interface
  contracts, and how to correctly split responsibilities across the network, business logic,
  and data layers. Use this skill when designing where code should live, refactoring spaghetti
  handler code, setting up dependency injection, deciding if something belongs in a handler
  vs service vs repository, or discussing the overall architecture of a server component.
  Trigger on: "architecture", "layer", "handler", "service", "repository", "dependency",
  "separation of concerns", "where does this code go", "refactor", "clean architecture",
  "design pattern", "module", "injection", "interface", "abstraction", "compose.ts",
  "composition root".
---

# Flyff Emulator — Multi-Layer Architecture (TypeScript)

## Layer Overview

```text
┌─────────────────────────────────────────────────────────┐
│  Network Layer  (Handlers)                              │
│  • Parses raw packets via PacketReader                  │
│  • Validates input with Zod / PacketValidate            │
│  • Calls one service method                             │
│  • Writes response packets via PacketWriter             │
│  • NO business logic, NO DB access                      │
├─────────────────────────────────────────────────────────┤
│  Business Logic Layer  (Services)                       │
│  • Implements game rules (combat formulas, level-up…)  │
│  • Orchestrates multiple repositories                   │
│  • Emits domain events via typed EventBus               │
│  • NO packet I/O, NO Knex queries                       │
├─────────────────────────────────────────────────────────┤
│  Data Layer  (Repositories)                             │
│  • All Knex queries live here                           │
│  • Returns typed plain objects (ICharacterRow, etc.)   │
│  • NO game logic, NO packet knowledge                   │
├─────────────────────────────────────────────────────────┤
│  Cross-cutting  (Managers / Systems)                    │
│  • In-memory live state (ZoneManager, PlayerManager…)  │
│  • Called from both Handlers and Services               │
│  • Game loop systems (AI, Spawn, Combat)                │
└─────────────────────────────────────────────────────────┘
```

---

## Handler Layer

Handlers are thin. Their only jobs:

1. Read fields from the packet
2. Validate them
3. Call one service method
4. Send the response

```ts
// handlers/inventory.handler.ts
import { PacketWriter } from '@flyff/core/net/index.js';
import { PacketValidate } from '@flyff/core/validate.js';
import { SNSP_INVEN_MOVE_ACK } from '@flyff/core/constants/opcodes.js';
import type { InventoryService } from '../services/inventory.service.js';
import type { FlyffSocket } from '../types.js';
import type { PacketReader } from '@flyff/core/net/index.js';

export function makeInventoryHandler(inventoryService: InventoryService) {
  return async function handleInvenMove(socket: FlyffSocket, reader: PacketReader): Promise<void> {
    const fromSlot = reader.readByte();
    const toSlot   = reader.readByte();

    PacketValidate.slot(fromSlot);
    PacketValidate.slot(toSlot);

    const player = socket.session.player!;
    await inventoryService.moveItem(player, fromSlot, toSlot);

    const w = new PacketWriter(SNSP_INVEN_MOVE_ACK);
    w.writeByte(fromSlot).writeByte(toSlot);
    socket.write(w.build());
  };
}
```

---

## Service Layer

```ts
// services/inventory.service.ts
import type { IInventoryItem } from '@flyff/core/types/entities.js';
import { GameError } from '@flyff/core/errors/index.js';
import type { CharacterRepository } from '@flyff/database/repositories/character.repo.js';
import type { CPlayer } from '../entities/player.js';
import { appendJournal } from '../journal.js';

interface InventoryServiceDeps {
  characterRepo: CharacterRepository;
}

export class InventoryService {
  #deps!: InventoryServiceDeps;

  init(deps: InventoryServiceDeps): void {
    this.#deps = deps;
  }

  async moveItem(player: CPlayer, fromSlot: number, toSlot: number): Promise<void> {
    const inv = player.m_aInventory;
    const fromItem = inv[fromSlot];
    if (!fromItem || fromItem.dwItemId === 0) {
      throw new GameError('Source slot is empty', 'SLOT_EMPTY');
    }

    const toItem = inv[toSlot];
    inv[toSlot]   = fromItem;
    inv[fromSlot] = toItem ?? createEmptyItem();

    player._dirty.add('inventory');
    // Journal critical item changes instantly for crash recovery
    appendJournal(player.m_dwCharId, 'ITEM_MOVE', { fromSlot, toSlot });
  }

  async useItem(player: CPlayer, slot: number): Promise<void> { /* … */ }
  async dropItem(player: CPlayer, slot: number, count: number): Promise<void> { /* … */ }
}

function createEmptyItem(): IInventoryItem {
  return { dwItemId: 0, nSlot: 0, wCount: 0, nUpgrade: 0 };
}
```

---

## Repository Layer

Pure data access — no game logic:

```ts
// repositories/account.repo.ts — see flyff-database-layer for full implementation
import type { IAccountRow } from '@flyff/core/types/entities.js';

export class AccountRepository {
  async findByUsername(username: string): Promise<IAccountRow | null> { /* Knex */ }
  async create(username: string, passwordHash: string): Promise<number> { /* Knex */ }
  async updateLastLogin(id: number, ip: string): Promise<void> { /* Knex */ }
}
```

---

## Manager Layer (Live State)

```ts
// managers/player.manager.ts
import type net from 'node:net';
import type { CPlayer } from '../entities/player.js';

export class PlayerManager {
  readonly #byCharId = new Map<number, CPlayer>();
  readonly #bySocket = new Map<net.Socket, CPlayer>();

  register(player: CPlayer): void {
    this.#byCharId.set(player.m_dwCharId, player);
    this.#bySocket.set(player.socket, player);
  }

  unregister(player: CPlayer): void {
    this.#byCharId.delete(player.m_dwCharId);
    this.#bySocket.delete(player.socket);
  }

  get(charId: number): CPlayer | null     { return this.#byCharId.get(charId) ?? null; }
  getBySocket(s: net.Socket): CPlayer | null { return this.#bySocket.get(s) ?? null; }
  all(): CPlayer[]                         { return [...this.#byCharId.values()]; }
  get count(): number                      { return this.#byCharId.size; }

  tick(_dt: number): void { /* per-tick player logic */ }
}
```

---

## Dependency Injection (Composition Root)

```ts
// world-server/src/compose.ts
import { PlayerManager }    from './managers/player.manager.js';
import { ZoneManager }      from './managers/zone.manager.js';
import { SpawnManager }     from './managers/spawn.manager.js';
import { CombatSystem }     from './systems/combat.system.js';
import { InventoryService } from './services/inventory.service.js';
import { CombatService }    from './services/combat.service.js';
import { CharacterRepository } from '@flyff/database/repositories/character.repo.js';
import { makeInventoryHandler } from './handlers/inventory.handler.js';
import { IpcBus } from '@flyff/ipc';
import { createCache } from '@flyff/core/cache/createCache.js';
import { config } from '@flyff/core/config.js';

// Infrastructure
export const cache         = await createCache();
export const ipcBus        = new IpcBus(cache, config.IPC_SECRET, config.SERVER_ID);

// Repositories
export const characterRepo = new CharacterRepository();

// Managers
export const playerManager = new PlayerManager();
export const zoneManager   = new ZoneManager();
export const spawnManager  = new SpawnManager();

// Services
export const inventoryService = new InventoryService();
inventoryService.init({ characterRepo });

export const combatService = new CombatService();
combatService.init({ playerManager, zoneManager });

// Systems
export const combatSystem = new CombatSystem(zoneManager);

// Handlers (factories receive deps)
export const handleInvenMove = makeInventoryHandler(inventoryService);
```

---

## System Layer

```ts
// systems/combat.system.ts
import type { ZoneManager } from '../managers/zone.manager.js';

export class CombatSystem {
  constructor(private readonly zones: ZoneManager) {}

  tick(dt: number): void {
    for (const zone of this.zones.all()) {
      for (const mover of zone.objects.values()) {
        if (mover.isInCombat) this.#processCombatTick(mover, dt);
      }
    }
  }

  #processCombatTick(mover: CMover, dt: number): void {
    mover.attackCooldown -= dt;
    if (mover.attackCooldown <= 0 && mover.target) {
      this.#performAttack(mover, mover.target);
      mover.attackCooldown = mover.m_nAttackSpeed;
    }
  }
}
```

---

## Typed EventBus (Cross-Layer Communication)

```ts
// services/experience.service.ts
import { bus } from '@flyff/core/eventBus.js';

export class ExperienceService {
  addExp(player: CPlayer, amount: number): void {
    player.m_nExp += amount;
    if (player.m_nExp >= getExpForNextLevel(player.m_nLevel)) {
      this.#levelUp(player);
    }
    bus.emit('player:exp_change', { player, amount });
  }

  #levelUp(player: CPlayer): void {
    player.m_nLevel++;
    bus.emit('player:level_up', { player, newLevel: player.m_nLevel });
  }
}

// handlers/combat.handler.ts — listens and sends packet (no circular dep)
bus.on('player:exp_change', ({ player }) => {
  const w = new PacketWriter(SNSP_EXP_CHANGE);
  w.writeDword(player.m_nExp);
  player.socket.write(w.build());
});
```

---

## Responsibility Quick-Reference

| Concern | Lives in |
| --- | --- |
| Parse opcode / read fields | Handler |
| Input validation (Zod/PacketValidate) | Handler |
| Game rule enforcement | Service |
| Combat formula | Service / System |
| Broadcast to nearby players | Service → Zone.broadcastAround() |
| Knex query | Repository |
| In-memory entity lookup | Manager |
| Packet response assembly | Handler |
| Per-tick game simulation | System |
| Domain events | EventBus |
| Cross-server messaging | IpcBus (see flyff-ipc-framework) |
| DI wiring | compose.ts |

---

## Anti-Patterns to Avoid

```ts
// ❌ Handler doing business logic
async function handleAttack(socket: FlyffSocket, reader: PacketReader): Promise<void> {
  const damage = Math.random() * player.m_nAtk; // ← business logic in handler
}

// ❌ Service doing packet I/O
class CombatService {
  attack(attacker: CPlayer, target: CMover): void {
    const w = new PacketWriter(SNSP_HIT); // ← network concern in service
    attacker.socket.write(w.build());
  }
}

// ❌ Repository doing game logic
class CharacterRepository {
  async levelUp(id: number): Promise<void> {
    const newHp = calculateHP(level, sta); // ← game rule in repository
    await db('characters').where({ id }).update({ hp: newHp });
  }
}
```
