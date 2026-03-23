---
name: flyff-brainstorming
description: >
  Brainstorming, planning, and architectural discussion rules for the Flyff TypeScript
  server emulator. Use this skill when the user asks for ideas, wants to plan a new system,
  asks "how should we implement X", or requires high-level architectural guidance before
  writing code. Trigger on: "brainstorm", "plan", "design", "how should we", "idea",
  "architectural decision", "propose", "suggest".
---

# Flyff Emulator — Brainstorming & Planning

When the user asks to brainstorm or plan a new feature, follow this structured approach to ensure the design fits within the established architecture.

## 1. Context Gathering
Before proposing a solution, ask yourself (and the user, if necessary):
- How did the original C++ Flyff server handle this? (Use `flyff-research` if unsure).
- Does this feature cross server boundaries (Login ↔ Cluster ↔ World)?
- What state needs to be persisted? Does it need to be written to the WAL journal immediately?
- Is this a high-frequency action that needs to be optimized (e.g., inside the 50ms game tick)?

## 2. Architectural Alignment
All proposed solutions **MUST** align with the current stack:
- **TypeScript**: Strict typing, Zod validation for external data.
- **Data Flow**: `Handler` (Network) → `Service` (Business Logic) → `Repository` (Knex DB).
- **Persistence**: Fast memory writes + WAL journaling (`world_X_journal.sqlite`) + Periodic Knex sync.
- **Communication**: `@flyff/ipc` for cross-server, typed `EventBus` for cross-system (within one server).
- **Performance**: Non-blocking async, object pooling for packets, Zone-based spatial queries.

## 3. Proposal Structure
When presenting a design to the user, use this format:

### A. The Core Concept
A brief (1-2 paragraph) summary of how the system will work.

### B. Layer Breakdown
Detail how the logic will be distributed:
- **Database (Migrations & Repo)**: What tables are needed? What methods go in the Repository?
- **Managers / Live State**: How will this data live in memory (`CPlayer` properties, new manager)?
- **Services (Business Logic)**: What are the core functions? What events will they emit?
- **Handlers (Network)**: What new opcodes (`SNSP_*`) are involved?

### C. Edge Cases & Security
- **Crash Recovery**: What happens if the server crashes mid-action? (Mention WAL).
- **Exploits**: How could a player cheat this? (Race conditions, packet spam, bad inputs).
- **Validation**: What Zod schemas or `PacketValidate` assertions are required?

### D. Step-by-Step Implementation Plan
A numbered list of how to build the feature, starting from data (DB) and moving up to network (Handlers).

## Example: Planning a "Guild System"
If the user asks "How should we implement guilds?", your proposal should cover:
1. **DB**: `guilds` and `guild_members` tables.
2. **State**: `GuildManager` holding active guilds in memory.
3. **IPC**: Since players on World 1 can chat with guildmates on World 2, the `GuildService` must use `@flyff/ipc` to broadcast guild chat to the Cluster, which then relays to all Worlds.
4. **Persistence**: Creating a guild or adding a member must be journaled to the WAL instantly.
5. **Packets**: Handlers for `SNSP_GUILD_CREATE`, `SNSP_GUILD_INVITE`, `SNSP_GUILD_CHAT`.