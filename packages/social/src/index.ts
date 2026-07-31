/**
 * `@flyff/social` -- friend roster (`CRTMessenger`) and campus/mentor
 * (`CCampusHelper`) domains. Both are social graphs the world server owns but
 * that C++ splits across the core/DB servers; a single-process emulator
 * collapses them here.
 *
 * @module social
 */

export * from './constants/friend';
export * from './net/snapshot/friend.serializer';
export * from './services/friend.service';
export * from './handlers/friend.handler';
export * from './constants/campus';
export * from './net/snapshot/campus.serializer';
export * from './services/campus.service';
export * from './handlers/campus.handler';
