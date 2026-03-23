---
name: flyff-cpp-to-nodejs
description: >
  Translates Flyff C++ server source code patterns, data structures, and logic into
  idiomatic Node.js for building a Flyff server emulator. Use this skill whenever the user
  pastes C++ code from Flyff source (FlyFF, NeuzServer, etc.) and wants to convert it to
  Node.js, or asks how to implement a C++ Flyff pattern in JavaScript. Triggers on:
  C++ struct definitions, CObject/CPlayer/CGuild class methods, DWORD/WORD/BYTE typedefs,
  CMover/CCtrl/CCharacter methods, Serialization (Serialize/Deserialize), CScript parsing,
  CPropMng/CPropelemnt property lookup, DSP_ or AI_ function patterns, CGameObjMng,
  or any C++ snippet the user wants translated to Node.js. Always apply this skill when
  the user shares C++ source code in a Flyff emulator context.
---

# Flyff C++ → Node.js Translation Guide

## Primitive Type Mapping

```cpp
// C++                          // Node.js equivalent
BYTE    b;     // uint8         let b = 0;          // or use Number
WORD    w;     // uint16        let w = 0;
DWORD   dw;    // uint32        let dw = 0;
LONG    l;     // int32         let l = 0;
float   f;     // IEEE 754 32b  let f = 0.0;
bool    bFlag; // 1 byte        let bFlag = false;
char    ch;    // 1 byte char   let ch = '';
CString str;   // MFC string    let str = '';
```

Bit-width enforcement for safety:
```js
const u8  = v => (v & 0xFF) >>> 0;
const u16 = v => (v & 0xFFFF) >>> 0;
const u32 = v => (v >>> 0);           // fast uint32 clamp
const i32 = v => (v | 0);             // fast int32 clamp
```

---

## Struct → Plain Object / Class

```cpp
// C++
typedef struct tagITEM {
    DWORD  dwItemId;
    WORD   wCount;
    BYTE   nSlot;
    float  fExtraParam;
} ITEM, *LPITEM;
```

```js
// Node.js — plain object factory
function createItem() {
  return { dwItemId: 0, wCount: 0, nSlot: 0, fExtraParam: 0.0 };
}

// Or as a class if you need methods
class Item {
  constructor() {
    this.dwItemId   = 0;
    this.wCount     = 0;
    this.nSlot      = 0;
    this.fExtraParam= 0.0;
  }
}
```

---

## Serialize / Deserialize Pattern

```cpp
// C++ Serialize to packet
void ITEM::Serialize(CAr& ar) {
    if (ar.IsStoring()) {
        ar << dwItemId << wCount << nSlot << fExtraParam;
    } else {
        ar >> dwItemId >> wCount >> nSlot >> fExtraParam;
    }
}
```

```js
// Node.js — separate read/write
Item.prototype.serialize = function(writer) {
  writer.writeDword(this.dwItemId);
  writer.writeWord(this.wCount);
  writer.writeByte(this.nSlot);
  writer.writeFloat(this.fExtraParam);
};

Item.prototype.deserialize = function(reader) {
  this.dwItemId    = reader.readDword();
  this.wCount      = reader.readWord();
  this.nSlot       = reader.readByte();
  this.fExtraParam = reader.readFloat();
};
```

---

## CObject / CMover Hierarchy

Flyff's class hierarchy maps naturally to JS prototype or class extension:

```
CObj → CCharacter → CMover → CPlayer
                           → CCtrl (NPC/Monster)
     → CItem
     → CDrop
```

```js
class CObj {
  constructor() {
    this.m_dwObjID  = 0;  // unique object ID (ObjID)
    this.m_vPos     = { x: 0, y: 0, z: 0 };
    this.m_fAngle   = 0;
    this.m_nType    = 0;  // OT_ITEM, OT_MOVER, etc.
  }
}

class CMover extends CObj {
  constructor() {
    super();
    this.m_nHP      = 0;
    this.m_nMaxHP   = 0;
    this.m_nMP      = 0;
    this.m_nMaxMP   = 0;
    this.m_nLevel   = 1;
    this.m_nExp     = 0;
    this.m_dwCharId = 0;  // DB character ID
  }
}

class CPlayer extends CMover {
  constructor() {
    super();
    this.m_szName   = '';
    this.m_nJob     = 0;
    this.m_nGold    = 0;
    this.m_aInventory = new Array(MAX_INVEN).fill(null).map(createItem);
    this.socket     = null; // reference to net.Socket
  }
}
```

---

## Map / Array Containers

| C++ Container | Node.js Equivalent |
|---|---|
| `std::map<K,V>` | `new Map()` |
| `std::list<T>` | `[]` (Array) |
| `std::vector<T>` | `[]` (Array) |
| `CArray<T>` (MFC) | `[]` (Array) |
| `CMap<K,V>` (MFC) | `new Map()` |
| `CMapStringToOb` | `new Map()` |

```cpp
// C++
CMap<DWORD, DWORD, CPlayer*, CPlayer*> m_mapPlayer;
m_mapPlayer.SetAt(dwID, pPlayer);
m_mapPlayer.Lookup(dwID, pPlayer);
m_mapPlayer.RemoveKey(dwID);
```

```js
// Node.js
const playerMap = new Map();
playerMap.set(dwID, player);
const player = playerMap.get(dwID);
playerMap.delete(dwID);
```

---

## Property Manager (CPropMng) → JSON/Map

Flyff loads `.spec` and `.txt` property files into a global manager. In Node.js, load them at startup:

```js
// properties.js — loaded once at startup
const MoverProps  = new Map();  // DWORD dwCharId → MoverProp
const ItemProps   = new Map();  // DWORD dwItemId → ItemProp
const SkillProps  = new Map();  // DWORD dwSkillId → SkillProp

// Load from parsed resource files (see flyff-resources skill)
export function getMoverProp(id) { return MoverProps.get(id); }
export function getItemProp(id)  { return ItemProps.get(id); }
```

---

## Timer / Tick Loop

```cpp
// C++ — server tick in a while loop
while (m_bRunning) {
    DWORD dwTick = GetTickCount();
    Process(dwTick - m_dwLastTick);
    m_dwLastTick = dwTick;
    Sleep(50); // 50ms tick = 20 ticks/sec
}
```

```js
// Node.js — using setInterval
const TICK_MS = 50;
let lastTick = Date.now();

setInterval(() => {
  const now  = Date.now();
  const dt   = now - lastTick;
  lastTick   = now;
  worldProcess(dt);
}, TICK_MS);
```

For precise game loops, prefer `process.hrtime.bigint()` over `Date.now()`.

---

## Random Number (C Runtime rand() equivalent)

```cpp
// C++ — Flyff uses rand() heavily
int nRand = rand() % nMax;
```

```js
// Node.js
const rand  = (max)      => (Math.random() * max) | 0;
const randRange = (a, b) => a + ((Math.random() * (b - a)) | 0);
```

---

## CScript / Text Resource Parsing

Flyff reads `.txt`/`.inc` script files with a custom tokenizer. In Node.js:

```js
// Simple token scanner matching CScript::GetToken()
function* tokenize(src) {
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) yield { type: 'string', value: m[1] };
    else if (m[2])          yield { type: 'token',  value: m[2] };
  }
}
```

---

## Critical C++ Patterns to Watch

### Integer overflow / unsigned wrapping
C++ `DWORD` wraps at 2^32; in JS use `>>> 0` to stay unsigned:
```js
let hp = (current - damage) >>> 0; // safe DWORD subtraction
```

### Pointer vs Reference semantics
C++ uses raw pointers — in JS, objects are always references. No need for `*` dereference or `->` operator. Null checks: `if (!player)`.

### `memset` / `memcpy`
```js
// memset to 0
const buf = Buffer.alloc(size, 0);
// memcpy
src.copy(dst, dstOffset, srcOffset, srcOffset + length);
```

### `sprintf` string formatting
```js
// C++: sprintf(szBuf, "%s_%d", szName, nLevel)
const str = `${name}_${level}`;
```

### `GetTickCount()`
```js
const GetTickCount = () => Number(process.hrtime.bigint() / 1_000_000n);
```

---

## Object ID (ObjID) Management

```js
let nextObjId = 1;
const objMap  = new Map();

function createObjId() {
  return nextObjId++;
}

function registerObj(obj) {
  obj.m_dwObjID = createObjId();
  objMap.set(obj.m_dwObjID, obj);
  return obj;
}

function getObj(id) {
  return objMap.get(id) ?? null;
}
```

---

## Useful C++ → JS Quick Reference

| C++ | Node.js |
|---|---|
| `new CPlayer()` | `new CPlayer()` |
| `delete pPlayer` | `playerMap.delete(id)` (let GC handle) |
| `SAFE_DELETE(p)` | `p = null` |
| `pPlayer->m_szName` | `player.m_szName` |
| `CString::Format()` | template literals |
| `MAKEWORD(lo, hi)` | `(lo & 0xFF) \| ((hi & 0xFF) << 8)` |
| `MAKELONG(lo, hi)` | `(lo & 0xFFFF) \| ((hi & 0xFFFF) << 16)` |
| `LOWORD(dw)` | `dw & 0xFFFF` |
| `HIWORD(dw)` | `(dw >> 16) & 0xFFFF` |
| `LOBYTE(w)` | `w & 0xFF` |
| `HIBYTE(w)` | `(w >> 8) & 0xFF` |
