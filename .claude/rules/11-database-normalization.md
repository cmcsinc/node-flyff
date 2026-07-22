# Database Normalization Rules

Governs schema shape for containers (inventory, bank) and their owners. Enforces
the split applied in migration `008_normalize_containers.ts`.

## The Principle

**A container's scalar state lives on the container table, never on the owner row.**

A character owns an inventory. An account owns a bank. The container's own
attributes — gold held, password, capacity — belong to the container, not to
the character/account that owns it. Don't park one entity's attribute on a
different entity's row.

## Required Shape

Split container metadata (one row per owner) from contents (one row per slot):

```
inventory          (character_id PK FK→characters CASCADE, gold, ...)   -- 1 row/character
inventory_item     (id PK, character_id FK, slot, item_id, ...)         -- many rows

bank               (account_id PK FK→accounts CASCADE, gold, bank_pass, ...)  -- 1 row/account
bank_item          (id PK, account_id FK, tab, slot, item_id, ...)      -- many rows
```

Concretely in this project:

| State | WRONG | RIGHT |
| --- | --- | --- |
| Carried penya (`m_nGold`) | `characters.gold` | `inventory.gold` |
| Bank penya (`m_BankGold`) | `accounts.bank_gold` | `bank.gold` |
| Bank password (`m_szBankPass`) | `characters.bank_pass` | `bank.bank_pass` |

The owner row (`characters`, `accounts`) holds only identity and the owner's
own attributes (level, exp, position, username, ban state). Anything that
describes a *container* goes on the container table.

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

## Checklist (apply before adding any new scalar state)

- [ ] Is this field an attribute of the entity, or of one of its containers?
      (e.g. "current HP" → character; "gold in the bag" → inventory container.)
- [ ] If it belongs to a container, does the container table already exist?
      Add the column there, not on `characters`/`accounts`.
- [ ] If a brand-new container, add the `<container>` metadata table +
      `<container>_item` items table as a pair — never merge them.
- [ ] Is the read/write pathed through the container's repository only?
- [ ] Migration added to `packages/database/src/migrations/` **and** the
      `MIGRATIONS` list in `packages/login-server/src/seed.ts` (else the dev DB
      never sees it — see rule `10` + memory `dev-db-seed-not-migrate`).
