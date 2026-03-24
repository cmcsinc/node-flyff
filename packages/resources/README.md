# @flyff/resources

Modern YAML-based resource loader for the Flyff Node.js emulator.

## Features

- ✅ **Human-readable YAML format** — No more cryptic `.txt` files
- ✅ **Type-safe validation** — All resources validated with Zod schemas
- ✅ **Cross-reference validation** — Ensures IDs are valid across files
- ✅ **Hot-reload support** — Development mode with automatic reloading
- ✅ **Fast lookups** — Map-based indexing for O(1) queries

## Quick Start

```typescript
import { loadAllResources } from '@flyff/resources';

// Load all resources
const resources = await loadAllResources('./resources/data');

// Access items
const sword = resources.items.items.get(1);
console.log(sword.name); // "Sword"

// Access monsters
const mia = resources.movers.movers.get(1);
console.log(mia.name); // "Mia"

// Access zones
const flaris = resources.zones.zones.get('flaris');
console.log(flaris.name); // "Flaris"
```

## Directory Structure

```
resources/data/
  items/                    # Item definitions
    weapons.yml            # Weapon data
    armors.yml             # Armor data
  movers/                   # NPCs and monsters
    monsters.yml           # Monster definitions
    npcs.yml               # NPC definitions
  skills/                   # Skill data
    mercenary.yml          # Mercenary skills
  worlds/                   # Zone data
    zones/
      flaris.yml           # Flaris zone
```

## File Format

### Items (`items/weapons.yml`)

```yaml
_version: "1.0"
_kind: weapon
items:
  - id: 1
    name: "Sword"
    name_id: "ITEM_SWORD"
    icon: "icon_item_sword.dds"
    model: "mdl_sword.o3d"
    attack: 15
    attack_rate: 1.0
    durability: 5000
    weight: 15
    level_req: 1
    job_req: [vagrant, mercenary, blade, knight]
    price: 100
    sell_price: 25
    tradeable: true
    dropable: true
    destroyable: true
    rarity: common
    two_handed: false
```

### Monsters (`movers/monsters.yml`)

```yaml
_version: "1.0"
movers:
  - id: 1
    name: "Mia"
    name_id: "MOVER_MIA"
    model: "mdl_mia.o3d"
    scale: 1.0
    type: monster
    level: 1
    hp: 50
    mp: 10
    fp: 10
    attack: 5
    defense: 2
    attack_rate: 100
    dodge_rate: 10
    speed: 1.0
    attack_speed: 1.0
    ai_type: aggressive
    agro_range: 10.0
    chase_range: 30.0
    attack_range: 2.5
    exp: 10
    penya: 5
    drop_rate: 1.0
    spawn_delay: 5000
    spawn_count: 1
```

### Zones (`worlds/zones/flaris.yml`)

```yaml
_version: "1.0"
_id: "flaris"
_id_numeric: 1
name: "Flaris"
name_id: "ZONE_FLARIS"
world_id: "madrigar"

bounds:
  min: { x: -4000, y: -1000, z: -4000 }
  max: { x: 4000, y: 500, z: 4000 }

revival:
  position: { x: 6978, y: 100, z: 3329 }
  radius: 5.0

spawns:
  - id: 1
    mover_id: 1
    position: { x: 6978, y: 100, z: 3329 }
    radius: 100.0
    count: 10
    delay: 5000

npcs:
  - id: 1
    mover_id: 1001
    position: { x: 6978, y: 100, z: 3329 }
    angle: 0
    functions:
      - type: shop
        shop_id: "flaris-weapon"
```

## API

### `loadAllResources(dataDir)`

Loads and validates all resource files.

```typescript
const resources = await loadAllResources('./resources/data');
```

### `getResources(dataDir)`

Gets cached resources (singleton pattern).

```typescript
const resources = await getResources('./resources/data');
```

### `reloadResources(dataDir)`

Hot-reloads all resources (for development).

```typescript
const resources = await reloadResources('./resources/data');
```

### `validateReferences(resources)`

Validates cross-file references.

```typescript
import { validateReferences } from '@flyff/resources';

validateReferences(resources); // Throws ValidationError if invalid
```

## Resource Index

The loaded `ResourceIndex` contains:

```typescript
interface ResourceIndex {
  items: {
    items: Map<number, ItemDefinition>      // ID → item
    byName: Map<string, ItemDefinition>     // Name → item
    byKind: Map<string, ItemDefinition[]>   // Kind → items[]
  }
  movers: {
    movers: Map<number, MoverDefinition>    // ID → mover
    byName: Map<string, MoverDefinition>    // Name → mover
    byType: Map<string, MoverDefinition[]>  // Type → movers[]
  }
  skills: {
    skills: Map<number, SkillDefinition>    // ID → skill
    byName: Map<string, SkillDefinition>    // Name → skill
    byJob: Map<string, SkillDefinition[]>   // Job → skills[]
  }
  zones: {
    zones: Map<string, ZoneDefinition>      // Zone ID → zone
    byNumericId: Map<number, ZoneDefinition> // Numeric ID → zone
    byWorld: Map<string, ZoneDefinition[]>  // World → zones[]
  }
}
```

## Validation

All resources are validated against Zod schemas:

- Items: `ItemDefinitionSchema`
- Movers: `MoverDefinitionSchema`
- Skills: `SkillDefinitionSchema`
- Zones: `ZoneDefinitionSchema`

Invalid resources will throw a `ZodError` on load.

## Testing

```bash
# Run tests
pnpm --filter @flyff/resources test

# Build
pnpm --filter @flyff/resources build

# Type check
pnpm --filter @flyff/resources typecheck
```

## License

MIT
