import type { Knex } from '../types';

/**
 * Database row interface for one inventory item slot (the `inventory_item` table).
 *
 * The container's scalar state (gold) lives on the separate `inventory` table
 * (1 row per character); this table holds only the per-slot item instances.
 * See rule `.claude/rules/11-database-normalization.md` + migration 008.
 */
export interface InventoryItemRow {
  id: number;
  character_id: number;
  slot: number;
  item_id: number;
  quantity: number;
  flags: number;
  durability: number;
  refine: number;
  /** SAI79::ePropType element byte (0..5); migration 012. */
  element: number;
  /** Element level (m_nResistAbilityOption, 0..20); migration 012. */
  element_level: number;
  stats: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Item creation data (excludes auto-generated fields). */
export type InventoryCreateData = Omit<
  InventoryItemRow,
  'id' | 'created_at' | 'updated_at'
>;

/**
 * Repository for the inventory container -- item slots (`inventory_item`) +
 * the container's gold (`inventory`, 1 row per character).
 *
 * All methods use Knex query builder (no raw SQL). Methods return typed
 * promises or null if not found.
 */
export class InventoryRepository {
  constructor(private db: Knex) {}

  // --- container gold (the `inventory` table, 1 row per character) ---

  /**
   * Character's carried penya (C++ `m_nGold`). Stored on the `inventory`
   * container row, not `characters` (migration 008). Returns 0 when no
   * container row exists yet (lazy-created on first `setGold`).
   */
  async getGold(characterId: number): Promise<number> {
    const row = await this.db('inventory').where({ character_id: characterId }).select('gold').first();
    return Number(row?.gold ?? 0);
  }

  /** Upsert the container gold (absolute new total, fire-and-forget at call sites). */
  async setGold(characterId: number, gold: number): Promise<void> {
    await this.db('inventory')
      .insert({ character_id: characterId, gold, created_at: new Date(), updated_at: new Date() })
      .onConflict('character_id')
      .merge({ gold, updated_at: new Date() });
  }

  // --- item slots (the `inventory_item` table) ---

  /**
   * Find all inventory items for a character.
   *
   * @param characterId - Character ID
   * @returns Array of inventory item rows
   */
  async findByCharacterId(characterId: number): Promise<InventoryItemRow[]> {
    return this.db('inventory_item')
      .where({ character_id: characterId })
      .orderBy('slot', 'asc');
  }

  /**
   * Equipped item IDs for a character (slots >= `minEquipSlot`, i.e.
   * `MAX_INVENTORY + parts`). Used by the cluster PLAYER_LIST to render the
   * character-select preview (C++ `SendPlayerList` reads `m_aEquipInfo`).
   *
   * @param minEquipSlot - First equip slot index (MAX_INVENTORY, 42 in v19).
   */
  async findEquippedItemIds(characterId: number, minEquipSlot: number): Promise<number[]> {
    const rows = await this.db('inventory_item')
      .where({ character_id: characterId })
      .andWhere('slot', '>=', minEquipSlot)
      .orderBy('slot', 'asc')
      .select('item_id');
    return rows.map((r: { item_id: number }) => Number(r.item_id));
  }

  /**
   * Find item in specific slot.
   *
   * @param characterId - Character ID
   * @param slot - Slot number
   * @returns Inventory item row or null if slot is empty
   */
  async getItem(
    characterId: number,
    slot: number
  ): Promise<InventoryItemRow | null> {
    const rows = await this.db('inventory_item')
      .where({ character_id: characterId, slot })
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Set item in slot (insert or update).
   *
   * Uses Knex's insert().onConflict() to handle both cases.
   *
   * @param characterId - Character ID
   * @param slot - Slot number
   * @param itemId - Item ID
   * @param quantity - Item quantity
   * @param flags - Item flags (elemental, rarity, etc.)
   * @param durability - Item durability (-1 for indestructible)
   * @param refine - Refine level (+0 to +20)
   * @param element - Element type byte (0..5, SAI79::ePropType); migration 012
   * @param elementLevel - Element level (0..20, m_nResistAbilityOption); migration 012
   * @param stats - JSON string for awakened stats
   */
  async setItem(
    characterId: number,
    slot: number,
    itemId: number,
    quantity = 1,
    flags = 0,
    durability = -1,
    refine = 0,
    stats?: string | null,
    element = 0,
    elementLevel = 0,
  ): Promise<void> {
    await this.db('inventory_item')
      .insert({
        character_id: characterId,
        slot,
        item_id: itemId,
        quantity,
        flags,
        durability,
        refine,
        element,
        element_level: elementLevel,
        stats: stats ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict(['character_id', 'slot'])
      .merge({
        item_id: itemId,
        quantity,
        flags,
        durability,
        refine,
        element,
        element_level: elementLevel,
        stats: stats ?? null,
        updated_at: new Date(),
      });
  }

  /**
   * Remove item from slot.
   *
   * @param characterId - Character ID
   * @param slot - Slot number
   */
  async removeItem(characterId: number, slot: number): Promise<void> {
    await this.db('inventory_item')
      .where({ character_id: characterId, slot })
      .del();
  }

  /**
   * Clear all inventory items for a character.
   *
   * @param characterId - Character ID
   */
  async clearInventory(characterId: number): Promise<void> {
    await this.db('inventory_item')
      .where({ character_id: characterId })
      .del();
  }

  /**
   * Update item quantity.
   *
   * @param characterId - Character ID
   * @param slot - Slot number
   * @param quantity - New quantity
   */
  async updateQuantity(
    characterId: number,
    slot: number,
    quantity: number
  ): Promise<void> {
    await this.db('inventory_item')
      .where({ character_id: characterId, slot })
      .update({
        quantity,
        updated_at: new Date(),
      });
  }

  /**
   * Move item from one slot to another.
   *
   * Swaps items if destination slot is occupied.
   *
   * @param characterId - Character ID
   * @param fromSlot - Source slot
   * @param toSlot - Destination slot
   */
  async moveItem(
    characterId: number,
    fromSlot: number,
    toSlot: number
  ): Promise<void> {
    // Use a transaction to safely swap items
    await this.db.transaction(async (trx) => {
      const fromItem = await trx<InventoryItemRow>('inventory_item')
        .where({ character_id: characterId, slot: fromSlot })
        .first();

      const toItem = await trx<InventoryItemRow>('inventory_item')
        .where({ character_id: characterId, slot: toSlot })
        .first();

      if (fromItem && toItem) {
        // Swap: exchange the row contents (not the slot column) so the
        // (character_id, slot) UNIQUE constraint is never violated mid-swap.
        await trx<InventoryItemRow>('inventory_item')
          .where({ character_id: characterId, slot: fromSlot })
          .update({
            item_id: toItem.item_id,
            quantity: toItem.quantity,
            updated_at: new Date(),
          });

        await trx<InventoryItemRow>('inventory_item')
          .where({ character_id: characterId, slot: toSlot })
          .update({
            item_id: fromItem.item_id,
            quantity: fromItem.quantity,
            updated_at: new Date(),
          });
      } else if (fromItem && !toItem) {
        // Simple move
        await trx<InventoryItemRow>('inventory_item')
          .where({ character_id: characterId, slot: fromSlot })
          .update({
            slot: toSlot,
            updated_at: new Date(),
          });
      }
      // If no fromItem, do nothing
    });
  }

  /**
   * Split item stack.
   *
   * Moves specified quantity from source slot to destination slot.
   * Destination slot must be empty.
   *
   * @param characterId - Character ID
   * @param fromSlot - Source slot
   * @param toSlot - Destination slot (must be empty)
   * @param quantity - Quantity to move
   */
  async splitStack(
    characterId: number,
    fromSlot: number,
    toSlot: number,
    quantity: number
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const fromItem = await trx<InventoryItemRow>('inventory_item')
        .where({ character_id: characterId, slot: fromSlot })
        .first();

      if (!fromItem) {
        return; // Source slot is empty
      }

      if (fromItem.quantity < quantity) {
        return; // Not enough quantity
      }

      const toItem = await trx<InventoryItemRow>('inventory_item')
        .where({ character_id: characterId, slot: toSlot })
        .first();

      if (toItem) {
        return; // Destination slot is occupied
      }

      // Create new stack in destination slot
      await trx<InventoryItemRow>('inventory_item').insert({
        character_id: characterId,
        slot: toSlot,
        item_id: fromItem.item_id,
        quantity,
        flags: fromItem.flags,
        durability: fromItem.durability,
        refine: fromItem.refine,
        stats: fromItem.stats,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Reduce quantity in source slot
      const newQuantity = fromItem.quantity - quantity;
      if (newQuantity > 0) {
        await trx<InventoryItemRow>('inventory_item')
          .where({ character_id: characterId, slot: fromSlot })
          .update({
            quantity: newQuantity,
            updated_at: new Date(),
          });
      } else {
        // Remove empty stack
        await trx<InventoryItemRow>('inventory_item')
          .where({ character_id: characterId, slot: fromSlot })
          .del();
      }
    });
  }

  /**
   * Merge item stacks.
   *
   * Combines quantity from source slot into destination slot.
   * Both slots must contain the same item type.
   *
   * @param characterId - Character ID
   * @param fromSlot - Source slot
   * @param toSlot - Destination slot
   */
  async mergeStacks(
    characterId: number,
    fromSlot: number,
    toSlot: number
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const fromItem = await trx<InventoryItemRow>('inventory_item')
        .where({ character_id: characterId, slot: fromSlot })
        .first();

      const toItem = await trx<InventoryItemRow>('inventory_item')
        .where({ character_id: characterId, slot: toSlot })
        .first();

      if (!fromItem || !toItem) {
        return; // Both slots must be occupied
      }

      if (fromItem.item_id !== toItem.item_id) {
        return; // Items must match
      }

      // Add quantities
      const newQuantity = toItem.quantity + fromItem.quantity;

      await trx<InventoryItemRow>('inventory_item')
        .where({ character_id: characterId, slot: toSlot })
        .update({
          quantity: newQuantity,
          updated_at: new Date(),
        });

      // Remove source slot
      await trx<InventoryItemRow>('inventory_item')
        .where({ character_id: characterId, slot: fromSlot })
        .del();
    });
  }

  /**
   * Count inventory items for a character.
   *
   * @param characterId - Character ID
   * @returns Number of inventory slots occupied
   */
  async countItems(characterId: number): Promise<number> {
    const result = await this.db('inventory_item')
      .where({ character_id: characterId })
      .count({ count: 'id' })
      .first();

    return Number(result?.count ?? 0);
  }

  /**
   * Check if slot is occupied.
   *
   * @param characterId - Character ID
   * @param slot - Slot number
   * @returns True if slot is occupied
   */
  async slotOccupied(characterId: number, slot: number): Promise<boolean> {
    const result = await this.db('inventory_item')
      .where({ character_id: characterId, slot })
      .count({ count: 'id' })
      .first();

    return Number(result?.count ?? 0) > 0;
  }
}
