/**
 * @flyff/npc -- NPC domain. NPC speech/scripted dialog/shop/bank/target/
 * mapKey services, their handlers, and NPC S->C serializers
 * (npcSnapshot/scriptDialog/shop/bank). mapKey.handler is the ADD_OBJ entry
 * point: it flips `VisibilityService.enterWorld` on the player's first MAP_KEY.
 *
 * Depends on `@flyff/{core,entities,world-core,combat,inventory,quest,database,
 * resources}`. All outbound edges (npc->inventory via shop, npc->quest via
 * scriptDlg, npc->combat via target policy) are acyclic.
 *
 * @module @flyff/npc
 */

export * from './services/npcSpeech.service';
export * from './services/scriptDlg.service';
export * from './services/changeJob.service';
export * from './services/shop.service';
export * from './services/bank.service';
export * from './services/target.service';
export * from './services/mapKey.service';
export * from './services/npcBuff.service';
export * from './handlers/scriptDlg.handler';
export * from './handlers/shop.handler';
export * from './handlers/bank.handler';
export * from './handlers/setTarget.handler';
export * from './handlers/mapKey.handler';
export * from './handlers/npcBuff.handler';
export * from './net/snapshot/npcSnapshot.serializer';
export * from './net/snapshot/scriptDialog.serializer';
export * from './net/snapshot/shop.serializer';
export * from './net/snapshot/bank.serializer';
