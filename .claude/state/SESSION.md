# Session: 2026-07-25

- **Branch**: `feat/endskillqueue-handler`

## Current Task
Fix: bought weapon auto-equips to shield slot (and inverse: bought shield → weapon slot). Implemented, tests green, **user-confirmed fixed 2026-07-25**. Ready to commit.

## Progress Log
- **Symptom (user)**: drag newly-bought weapon into inventory → it renders in the shield slot. Inverse: bought shield renders in weapon slot. Class = Vagrant/Merc/Knight (non-blade). Right-weapon slot was occupied. Item appears to "auto-equip" because the CREATEITEM lands it in the wrong cell.
- **Root cause**: `CREATEITEM` trailer `pnId` (and body `m_dwObjId`) must be the client's **drifted** `m_apIndex[slot]` (= `player.clientObjId(slot)`), NOT the raw bag index. Client `OnCreateItem` → `SetAtId(pnId)` writes `m_apItem[pnId]`; after equipping out of a bag slot, `m_apIndex[slot]` points at a free `m_apItem` index while the equipped item holds its own cell. Sending `slot` makes `SetAtId(slot)` overwrite the equipped item's cell → new item renders in the equipped slot, equipped item vanishes. C++ `CItemContainer::Add` (Item.h:718-727) sends `nId = m_apIndex[i]`.
- **Fix**:
  - `AddItemResult` / `BuyResult` gained `objid: number`.
  - `InventoryService.addItem` returns `placed.objid` (= `player.clientObjId(slot)`, already computed) on both new-slot and stack-merge paths.
  - Three CREATEITEM call sites pass `r.objid`/`res.objid` instead of `r.slot`/`res.slot`:
    `shop.handler.ts:80`, `actMsg.handler.ts:112`, `loot.service.ts:151`.
  - `actMsg.handler.ts:113` UPDATE_ITEM merge path also fixed (was `r.slot`).
  - `CreateItemEntry.slot` → `objid`; serializer doc corrected. `loot.service` misleading comment removed.
- Files: inventory/src/services/inventory.service.ts, inventory/src/handlers/actMsg.handler.ts, inventory/src/services/loot.service.ts, inventory/src/net/snapshot/createItem.serializer.ts, npc/src/services/shop.service.ts, npc/src/handlers/shop.handler.ts, inventory/test/net/snapshot/createItem.serializer.test.ts.
- Tests: build 15/15; inventory 111/111, npc 113/113, quest 59/59, world-server 222/222. createItem serializer test extended with a drift case (objid ≠ slot).
- Memory updated: `v15-invindex-mirror-createitem-objid` (re-reported 2026-07-25; prior note was ahead of the code).

## Technical Context
- **Current Branch**: `feat/endskillqueue-handler`
- Last tool: Write (SESSION.md).

## Next Step
Committed. Awaiting next task.
