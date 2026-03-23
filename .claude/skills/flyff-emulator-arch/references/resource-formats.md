# Flyff Resource File Formats

## propItem.txt

Tab-separated, first row is column headers. Key columns:

| Column | Type | Description |
|---|---|---|
| `dwID` | DWORD | Unique item ID |
| `szName` | string | Internal name (e.g. `II_WEA_SWD_WOODSWORD`) |
| `dwItemKind1` | DWORD | Category (IK1_WEAPON, IK1_ARMOR, etc.) |
| `dwItemKind2` | DWORD | Sub-category |
| `dwItemKind3` | DWORD | Sub-sub-category |
| `dwItemJob` | DWORD | Job restriction bitmask |
| `bPermanence` | BYTE | 1 = stackable (consumable) |
| `nAbilityMin` | INT | Min attack/defense |
| `nAbilityMax` | INT | Max attack/defense |
| `dwItemLV` | DWORD | Required level |
| `dwWeight` | DWORD | Item weight |
| `dwCost` | DWORD | NPC sell price |
| `dwEndurance` | DWORD | Durability |

### Parser Snippet

```js
import fs from 'fs';

export function parsePropItem(filepath) {
  const lines = fs.readFileSync(filepath, 'utf-8').split('\n');
  const headers = lines[0].split('\t').map(h => h.trim());
  const result = new Map();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => row[h] = cols[idx]?.trim());
    const id = parseInt(row.dwID);
    if (!isNaN(id)) result.set(id, row);
  }
  return result;
}
```

---

## propMover.txt

| Column | Type | Description |
|---|---|---|
| `dwID` | DWORD | Unique mover ID |
| `szName` | string | Internal name |
| `nHP` | INT | Base HP |
| `nMP` | INT | Base MP |
| `nStr` | INT | Strength |
| `nSta` | INT | Stamina |
| `nDex` | INT | Dexterity |
| `nInt` | INT | Intelligence |
| `nAtk` | INT | Attack |
| `nAtkRange` | INT | Attack range |
| `nAggro` | INT | Aggro range |
| `nExpLow` | INT | Min exp reward |
| `nExpHigh` | INT | Max exp reward |
| `dwGoldLow` | DWORD | Min gold drop |
| `dwGoldHigh` | DWORD | Max gold drop |
| `nLevel` | INT | Monster level |
| `bBoss` | BYTE | 1 = boss monster |

---

## defineItem.h / definePlayer.h / defineSkill.h

These are C-style `#define` files mapping symbolic names to DWORD IDs.

### Parser

```js
export function parseDefineFile(filepath) {
  const src = fs.readFileSync(filepath, 'utf-8');
  const defines = new Map();
  const re = /^#define\s+(\w+)\s+(0x[0-9a-fA-F]+|\d+)/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    defines.set(m[1], parseInt(m[2]));
  }
  return defines;
}
```

---

## World File (.wld)

Binary format. Layout:

```
[4 bytes] magic: 'WRLD'
[4 bytes] version
[4 bytes] num_regions
[num_regions × RegionEntry]
  RegionEntry:
    [4 bytes] region_id
    [256 bytes] region_name (null padded)
    [4 bytes] offset in file
    [4 bytes] size
[region data blocks...]
```

---

## Region File (.rgn)

Contains spawn points and area bounds:

```
[4 bytes] num_spawns
[num_spawns × SpawnEntry]
  SpawnEntry:
    [4 bytes] mover_id
    [4 bytes] count
    [4 bytes] respawn_time_ms
    [4 bytes] x (float)
    [4 bytes] y (float)
    [4 bytes] z (float)
    [4 bytes] radius (float)
```

### Node.js Region Loader

```js
export function parseRegion(buf) {
  let offset = 0;
  const numSpawns = buf.readUInt32LE(offset); offset += 4;
  const spawns = [];
  for (let i = 0; i < numSpawns; i++) {
    spawns.push({
      moverId:      buf.readUInt32LE(offset),     offset += 4,
      count:        buf.readUInt32LE(offset),     offset += 4,
      respawnMs:    buf.readUInt32LE(offset),     offset += 4,
      x:            buf.readFloatLE(offset),      offset += 4,
      y:            buf.readFloatLE(offset),      offset += 4,
      z:            buf.readFloatLE(offset),      offset += 4,
      radius:       buf.readFloatLE(offset),      offset += 4,
    });
  }
  return spawns;
}
```
