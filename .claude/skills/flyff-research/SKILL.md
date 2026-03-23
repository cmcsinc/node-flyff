---
name: flyff-research
description: >
  Research standards and techniques for discovering Flyff (Fly For Fun) protocol details,
  packet structures, game mechanics, and C++ source implementations. Use this skill when
  the user asks to reverse-engineer a packet, find where a specific game mechanic is calculated,
  extract opcodes, or understand how the original Neuz (client) or WorldServer (server) works.
  Trigger on: "research", "reverse engineer", "find packet", "how does flyff do", "search source",
  "discover", "investigate", "explore", "packet structure", "find opcode".
---

# Flyff Emulator — Research & Discovery Guide

When asked to "research" or figure out how Flyff implements a feature, follow these methodologies to find the truth rather than guessing.

## 1. Searching the C++ Source Code

When you need to understand a packet structure or game mechanic, you must grep the original C++ source (if provided in the workspace, e.g., in a `references/` or `source/` directory).

### Finding Packet Structures
1. **Find the opcode**: Search for `SNSP_` or `PACKETTYPE_`.
2. **Find the sender**: Grep for `Send(SNSP_X`. Look at what `<<` operators are used on the `CAr` (archive) object.
3. **Find the receiver**: Grep for `case SNSP_X:`. Look at the `OnX` handler function and see what `>>` operators extract from `CAr`.

```cpp
// Example C++ Search: "How is SNSP_LOGIN_CERTIFY sent?"
// Result from Neuz/DPLoginClient.cpp:
void CDPLoginClient::SendLoginCertify(const char* szAccount, const char* szPassword) {
    CAr ar;
    ar << SNSP_LOGIN_CERTIFY;
    ar.WriteString(szAccount);
    ar.WriteString(szPassword);
    // ...
}
// Node.js implementation must mirror this exactly!
```

### Finding Game Formulas
- **Combat / Damage**: Search for `GetDamage`, `GetAttack`, `GetDefense`. Usually in `Mover.cpp` or `MoverAttack.cpp`.
- **Stats**: Search for `GetMaxHP`, `GetMaxMP`. Usually in `MoverProp.cpp` or `Character.cpp`.
- **Experience**: Search for `AddExp`, `GetExpReq`. Usually in `Character.cpp`.

## 2. Packet Reverse Engineering

If you only have a hex dump of a packet (e.g., from Wireshark or a packet sniffer):

1. **Strip Header**: The first 4 bytes are size, next 2 are `0x5E80`, next 2 are `opcode`.
2. **Identify Opcode**: Match the 2-byte opcode against `packages/core/src/constants/opcodes.ts`.
3. **Analyze Payload**:
   - `00 00 00 00` blocks are often padding or zeroed `DWORD`s.
   - Look for repeating patterns (indicates an array/list). If there's an array, the byte/word right before it is usually the `count`.
   - Look for text: Flyff strings are pre-fixed with a 4-byte length. E.g., `04 00 00 00 54 65 73 74` = `Test`.

## 3. Extracting Data from Resource Files

Flyff relies heavily on client resource files (`.txt`, `.inc`, `.res`).

- **Items**: `propItem.txt` (Columns: ID, Name, Icon, Mesh, Type, Job Req, Level Req, etc.)
- **Monsters/NPCs**: `propMover.txt` (Columns: ID, Name, Model, Level, HP, MinAtk, MaxAtk, Def, Speed, etc.)
- **Skills**: `propSkill.txt` (Columns: ID, Name, MP cost, Cooldown, Damage multiplier, etc.)

When asked about specific item stats or monster health, instruct the user to check these files, or use the `Read` tool if they exist in the workspace (e.g., `resources/data/propItem.txt`).

## 4. Validating Findings

Whenever you deduce a packet structure or formula, **validate it** by writing a quick mock or unit test in the `tools/` or `tests/` directory to see if it parses a known good hex dump correctly.
