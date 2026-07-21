# Inventory / Equipment / Bank / Use-Item — Handoff (2026-07-21)

Cross-device resume doc for the v15 inventory feature build. Read this + `memory/v15-inventory-shipped-state.md`.

## What's built (4 systems, code-complete)

| System | Status | Real-client tested? |
|---|---|---|
| Inventory ops (pickup/move/drop/drop-gold + stacking) | code-complete, tests green | **NO** — awaiting you |
| Equipment (equip/unequip + stat fold + vicinity broadcast) | code-complete, tests green | **NO** — awaiting you |
| Use-item (DOUSEITEM router: potion/food concrete, buff/skill/warp routed) | code-complete, tests green | **NO** — awaiting you |
| Bank (open/deposit/withdraw item+gold, account-shared) | code-complete, tests green | **NO** — awaiting you |

**Test counts (green on my side):** world-server 441/441 (was 368), database 104/104 (was 97), resources item.schema 6/6. Pre-existing unrelated red: `resources/test/loaders/characterInc.loader.test.ts` + `test/extractFlaris.test.ts` (`TypeError .get on undefined` in NPC-loader harness) — NOT touched by this work.

## OVERRIDE RULE (read first)

From `CLAUDE.md`: **the user is the ONLY source of truth for complete/fixed.** No task may be marked ✅ Done, and nothing may be called "fixed/works/resolved/passing" until the user tests it. All Phase 0-4 tasks (#3-#7) stay `in_progress`. Task #8 (test coverage) is written + green on my side but also stays `in_progress` until you confirm.

When you test, tell me what broke — keep iterating until it works or you say stop.

## How to resume on another device

```bash
git pull origin master
pnpm install
pnpm --filter @flyff/resources build     # world consumes dist — rebuild after any src change
pnpm -r test                             # confirm green
pnpm server:world                        # from repo root (cwd-relative paths)
```

Then real-client test the 5 flows below. Memory `dev-servers-run-from-repo-root` + `dev-db-seed-not-migrate` cover dev-run gotchas.

## Real-client test checklist (the actual gate)

1. **Pickup persists**: loot a drop → item in bag → relog → item still there (Phase 0B JOIN container fix)
2. **Move/drop**: drag items in bag, drop item + gold to ground
3. **Equip weapon**: right-click weapon → appears on body for other players → damage scales (Phase 2)
4. **Potion**: eat food/potion → HP/MP/FP rise (Phase 3)
5. **Bank**: open bank NPC → deposit/withdraw item + penya (Phase 4)

## File map

**Source (committed in `a7631ea` + `e564f0f`):**
- `world-server/src/services/{inventory,equip,consumable,useItem,bank}.service.ts`
- `world-server/src/handlers/{moveItem,dropItem,dropGold,doEquip,doUseItem,bank,actMsg}.handler.ts`
- `world-server/src/net/snapshot/{itemElemBody,updateItem,doEquip,bank}.serializer.ts` + populated `writeItemContainer` in `mover.serializer.ts`
- `world-server/src/combat/equipStats.ts`
- `database/src/repositories/bank.repo.ts` + `database/src/migrations/004_bank_tab.ts`
- Modified: `player.ts`, `compose.ts`, `clientServer.ts`, `index.ts`, `opcodes.ts`, `pointParam.serializer.ts`, `join.service.ts`, `combatants.ts`, `combat.service.ts`, `resources/src/schemas/item.schema.ts` + converter

**Tests (committed incrementally, final batch in this commit):**
- `world-server/test/net/snapshot/{itemElemBody,updateItem,doEquip,bank,mover}.serializer.test.ts`
- `world-server/test/combat/equipStats.test.ts`
- `world-server/test/services/{equip,consumable,useItem,bank}.service.test.ts` + extended `inventory.service.test.ts`
- `world-server/test/handlers/{moveItem,dropItem,dropGold,doEquip,doUseItem,bank}.handler.test.ts`
- `database/test/repositories/bank.repo.test.ts`
- `resources/test/schemas/item.schema.test.ts`

## Deferred ponytails (not blocking real-client test)

- refine option encoding (writes `refine<<4` placeholder)
- element string → numeric ELEMENT_* enum
- jewelry HR/ER, two-handed offhand block
- per-tab bank gold (tabs 1/2 = 0; gold account-wide in tab 0)
- buff/skill/warp **effects** (charge consumed + log only; effect subsystems don't exist)
- over-cap 30% heal rule
- dedupe createItem/itemSnapshot inline CItemElem bodies → `writeCItemElemBody`

## Gotchas (hit during test writing, saved here so you don't repeat)

- Core exports `SNAPSHOTTYPE` as a frozen object → use `SNAPSHOTTYPE.DOEQUIP`, not bare `SNAPSHOTTYPE_DOEQUIP`
- Bank GETITEMBANK/BANKWINDOW have **no tab byte** → body starts at offset 16, not 17 (PUTITEMBANK/PUTGOLDBANK do have a tab byte → body at 17)
- `it()` callbacks with `await` must be declared `async`
- `bank.repo.test.ts` `after()` must NOT run migration `down` — better-sqlite3 `dropColumn` hangs the suite; in-memory DB needs only `db.destroy()`
- Equip vicinity EQUIP_INFO is `{DWORD,int,BYTE}` = 12 bytes MSVC-padded (3 zero pad bytes) — omitting them desyncs the stream
