/**
 * SETPOINTPARAM S->C snapshot -- one stat/point value sync.
 *
 * `CUserMng::AddSetPointParam` (`WORLDSERVER/User.cpp:4624`):
 * ```
 * ar << GETID(pMover);
 * ar << SNAPSHOTTYPE_SETPOINTPARAM;   // 0x001e
 * ar << nDstParameter << nValue;      // int DST_* | int value
 * ```
 * Used for the gold counter on pickup (`CMover::AddGold` ->
 * `AddSetPointParam(this, DST_GOLD, total)`, Mover.cpp:614). Self-only: the
 * client matches the objid to its own player. Will be reused for HP/MP/stat
 * sync when those systems ship.
 *
 * @module net/snapshot/pointParam
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_SETPOINTPARAM } from './constants';

/** `DST_GOLD` (`defineAttribute.h:349`) -- the gold-counter point parameter. */
export const DST_GOLD = 10000;
/** Vitals (`defineAttribute.h:38-40`) -- HP/MP/FP point parameters. */
export const DST_HP = 38;
export const DST_MP = 39;
export const DST_FP = 40;

/** `objid | 0x001e | int param | int value`, wrapped in a single-snapshot frame. */
export function buildSetPointParam(objid: number, param: number, value: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_SETPOINTPARAM);
  w.writeDword(param);
  w.writeDword(value);
  return w.build();
}
