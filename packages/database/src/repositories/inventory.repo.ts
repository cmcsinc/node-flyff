import type { Knex } from '../types.js';

/**
 * Database row interface for inventory table.
 */
export interface InventoryRow {
  id: number;
  character_id: number;
  slot: number;
  item_id: number;
  quantity: number;
  flags: number;
  durability: number;
  refine: number;
  stats: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Inventory item creation data (excludes auto-generated fields).
 */
export type InventoryCreateData = Omit<
  InventoryRow,
  'id' | 'created_at' | 'updated_at'
>;

/**
 * Repository for inventory-related database operations.
 *
 * All methods use Knex query builder (no raw SQL).
 * Methods return typed promises or null if not found.
 */
export class InventoryRepository {
  constructor(private db: Knex) {}

  /**
   * Find all inventory items for a character.
   *
   * @param characterId - Character ID
   * @returns Array of inventory rows
   */
  async findByCharacterId(characterId: number): Promise<InventoryRow[]> {
    return this.db('inventory')
      .where({ character_id: characterId })
      .orderBy('slot', 'asc');
  }

  /**
   * Find item in specific slot.
   *
   * @param characterId - Character ID
   * @param slot - Slot number
   * @returns Inventory row or null if slot is empty
   */
  async getItem(
    characterId: number,
    slot: number
  ): Promise<InventoryRow | null> {
    const rows = await this.db('inventory')
      .where({ character_id: characterId, slot })
      .limit(1);

    return rows[0] || null;
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
   * @param stats - JSON string for awakened stats
   */
  async setItem(
    characterId: number,
    slot: number,
    itemId: number,
    quantity: number = 1,
    flags: number = 0,
    durability: number = -1,
    refine: number = 0,
    stats?: string | null
  ): Promise<void> {
    await this.db('inventory')
      .insert({
        character_id: characterId,
        slot,
        item_id: itemId,
        quantity,
        flags,
        durability,
        refine,
        stats: stats || null,
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
        stats: stats || null,
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
    await this.db('inventory')
      .where({ character_id: characterId, slot })
      .del();
  }

  /**
   * Clear all inventory items for a character.
   *
   * @param characterId - Character ID
   */
  async clearInventory(characterId: number): Promise<void> {
    await this.db('inventory')
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
    await this.db('inventory')
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
    await this.db.transaction(async (trx: any) => {
      const fromItem = await trx('inventory')
        .where({ character_id: characterId, slot: fromSlot })
        .first();

      const toItem = await trx('inventory')
        .where({ character_id: characterId, slot: toSlot })
        .first();

      if (fromItem && toItem) {
        // Swap: exchange the row contents (not the slot column) so the
        // (character_id, slot) UNIQUE constraint is never violated mid-swap.
        await trx('inventory')
          .where({ character_id: characterId, slot: fromSlot })
          .update({
            item_id: toItem.item_id,
            quantity: toItem.quantity,
            updated_at: new Date(),
          });

        await trx('inventory')
          .where({ character_id: characterId, slot: toSlot })
          .update({
            item_id: fromItem.item_id,
            quantity: fromItem.quantity,
            updated_at: new Date(),
          });
      } else if (fromItem && !toItem) {
        // Simple move
        await trx('inventory')
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
    await this.db.transaction(async (trx: any) => {
      const fromItem = await trx('inventory')
        .where({ character_id: characterId, slot: fromSlot })
        .first();

      if (!fromItem) {
        return; // Source slot is empty
      }

      if (fromItem.quantity < quantity) {
        return; // Not enough quantity
      }

      const toItem = await trx('inventory')
        .where({ character_id: characterId, slot: toSlot })
        .first();

      if (toItem) {
        return; // Destination slot is occupied
      }

      // Create new stack in destination slot
      await trx('inventory').insert({
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
        await trx('inventory')
          .where({ character_id: characterId, slot: fromSlot })
          .update({
            quantity: newQuantity,
            updated_at: new Date(),
          });
      } else {
        // Remove empty stack
        await trx('inventory')
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
    await this.db.transaction(async (trx: any) => {
      const fromItem = await trx('inventory')
        .where({ character_id: characterId, slot: fromSlot })
        .first();

      const toItem = await trx('inventory')
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

      await trx('inventory')
        .where({ character_id: characterId, slot: toSlot })
        .update({
          quantity: newQuantity,
          updated_at: new Date(),
        });

      // Remove source slot
      await trx('inventory')
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
    const result = await this.db('inventory')
      .where({ character_id: characterId })
      .count('id as count')
      .first();

    return (result?.count as number) || 0;
  }

  /**
   * Check if slot is occupied.
   *
   * @param characterId - Character ID
   * @param slot - Slot number
   * @returns True if slot is occupied
   */
  async slotOccupied(characterId: number, slot: number): Promise<boolean> {
    const result = await this.db('inventory')
      .where({ character_id: characterId, slot })
      .count('id as count')
      .first();

    return (result?.count as number) > 0;
  }
}
