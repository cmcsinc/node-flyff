/**
 * @flyff/inventory -- inventory domain. Bag/equip/consume/useItem/drop/loot
 * services, the ItemManager, ground items (GroundItem), the inventory C->S
 * handlers, and item S->C serializers (createItem/updateItem/moveItem/doEquip/
 * actMsg/itemSnapshot).
 *
 * Depends on `@flyff/{core,entities,world-core,database,resources}`. The shared
 * `itemElemBody` + `doUseSkillPoint` serializers live in `@flyff/world-core`
 * (multi-domain). Shell imports this package's service + handler constructors.
 *
 * @module @flyff/inventory
 */

export * from './services/inventory.service';
export * from './services/loot.service';
export * from './services/drop.service';
export * from './services/equip.service';
export * from './services/consumable.service';
export * from './services/cooltime';
export * from './services/useItem.service';
export * from './services/enchant.service';
export * from './services/repair.service';
export * from './services/trade.service';
export * from './services/vendor.service';
export * from './upgrade/upgradeTables';
export * from './managers/item.manager';
export * from './entities/item';
export * from './handlers/actMsg.handler';
export * from './handlers/vendor.handler';
export * from './handlers/moveItem.handler';
export * from './handlers/dropItem.handler';
export * from './handlers/dropGold.handler';
export * from './handlers/removeItem.handler';
export * from './handlers/doEquip.handler';
export * from './handlers/doUseItem.handler';
export * from './handlers/enchant.handler';
export * from './handlers/repair.handler';
export * from './handlers/trade.handler';
export * from './net/snapshot/createItem.serializer';
export * from './net/snapshot/updateItem.serializer';
export * from './net/snapshot/moveItem.serializer';
export * from './net/snapshot/doEquip.serializer';
export * from './net/snapshot/actMsg.serializer';
export * from './net/snapshot/itemSnapshot.serializer';
export * from './net/snapshot/trade.serializer';
export * from './net/snapshot/vendor.serializer';
