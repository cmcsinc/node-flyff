# Database Normalization Rules

Governs schema shape for containers (inventory, bank), 1:N collections (buffs,
skills, quests), and their owners. Enforces the split applied in migration
`008_normalize_containers.ts` and the collection normalization in `015`.

## The Principle

**A container's scalar state lives on the container table, never on the owner
row. A 1:N collection gets its own table, never a JSON column on the owner.**

A character owns an inventory. An account owns a bank. The container's own
attributes — gold held, password, capacity — belong to the container, not to the
character/account that owns it. Don't park one entity's attribute on a
different entity's row.

Similarly, a character has many active buffs, many learned skills, and many
active quests. Each is a separate row in its own table — not a JSON blob or
packed string on `characters`. The C++ source may serialize collections as
packed strings for its flat-file DB; that is a storage detail, not a schema
design. The relational table mirrors the in-memory collection model
(`CBuffMgr` → `character_buffs`, `m_aJobSkill` → `skills`, `m_aQuest` →
`character_quests`).

## Required Shape

Split container metadata (one row per owner) from contents (one row per slot):

```
inventory          (character_id PK FK→characters CASCADE, gold, ...)   -- 1 row/character
inventory_item     (id PK, character_id FK, slot, item_id, ...)         -- many rows

bank               (account_id PK FK→accounts CASCADE, gold, bank_pass, ...)  -- 1 row/account
bank_item          (id PK, account_id FK, tab, slot, item_id, ...)      -- many rows
```

1:N collections on characters:

```
character_buffs    (id PK, character_id FK→characters CASCADE, type, skill_id, level, total_ms)
skills             (id PK, character_id FK→characters CASCADE, slot, skill_id, level)
character_quests   (id PK, character_id FK→characters CASCADE, quest_id, state, ...)
```

Concretely in this project:

| State | WRONG | RIGHT |
| --- | --- | --- |
| Carried penya (`m_nGold`) | `characters.gold` | `inventory.gold` |
| Bank penya (`m_BankGold`) | `accounts.bank_gold` | `bank.gold` |
| Bank password (`m_szBankPass`) | `characters.bank_pass` | `bank.bank_pass` |
| Active buffs (`CBuffMgr`) | `characters.buffs` (JSON column) | `character_buffs` table |
| Learned skills (`m_aJobSkill`) | `characters.skills_json` (hypothetical) | `skills` table |
| Active quests (`m_aQuest`) | `characters.quests_json` (hypothetical) | `character_quests` table |

The owner row (`characters`, `accounts`) holds only identity and the owner's
own attributes (level, exp, position, username, ban state). Anything that
describes a *container* or a *1:N collection* goes on its own table.

## Container Rows Are Lazy

A container row need not exist until the container has state. `getGold` /
`getBankPass` return the default (`0` / `'0000'`) when no row exists; setters
upsert (`INSERT ... ON CONFLICT(owner_id) DO UPDATE`). Do not couple
character/account creation to inserting a container row. When more container
fields arrive (capacity, last-opened, etc.) and a row must always exist, create
it explicitly on owner create — that is the upgrade path, not the default.

## Why This Matters

- **Future sharing**: an item that opens a shared bank just references the bank
  container; its gold + pin travel with it because they live on the container,
  not on an owner the shared bank doesn't have.
- **No orphans**: `ON DELETE CASCADE` from the owner drops both the container
  row and its item rows; nothing leak-stays on a deleted character/account.
- **One source of truth**: gold is read/written through the container repo
  (`InventoryRepository.getGold`/`setGold`, `BankRepository.getGold`/`setGold`),
  never scattered across `CharacterRepository`/`AccountRepository`.
- **Queryable collections**: individual buffs/skills/quests can be queried,
  counted, joined, and indexed — impossible with a JSON column.
- **No JSON parse overhead**: the DB engine reads typed columns directly;
  no `JSON.parse` at the application layer for every load.

## Agent Rule: Always Normalize

**When adding any new 1:N or N:M relationship to a character (or any entity),
create a dedicated table. Never use a JSON column, packed string, or comma-
separated list on the owner row.**

This applies even when the C++ source serializes the collection as a single
string field (e.g. `SaveSkillInfluence` packs buffs into one string). The C++
serialization is a flat-file optimization; the relational equivalent is always
a separate table with a FK back to the owner.

## Checklist (apply before adding any new scalar state or collection)

- [ ] Is this field an attribute of the entity, or of one of its containers?
      (e.g. "current HP" → character; "gold in the bag" → inventory container.)
- [ ] Is this a 1:N collection? (buffs, skills, quests, hotkeys, mail, ...)
      → dedicated table with FK to owner, never a JSON column.
- [ ] If it belongs to a container, does the container table already exist?
      Add the column there, not on `characters`/`accounts`.
- [ ] If a brand-new container, add the `<container>` metadata table +
      `<container>_item` items table as a pair — never merge them.
- [ ] Is the read/write pathed through the container's/collection's repository only?
- [ ] Migration added to `packages/database/src/migrations/` **and** the
      `MIGRATIONS` list in `packages/login-server/src/seed.ts` (else the dev DB
      never sees it — see rule `10` + memory `dev-db-seed-not-migrate`).
