/**
 * @flyff/mail -- mail (post) domain, admin->player direction.
 *
 * Ports the receive half of the v19 post system (`_Common/post.h`): the mailbox
 * snapshot, the read/take-item/take-gold/delete handlers, and the
 * `MODE_MAILBOX` new-mail indicator. Mail is created out-of-band (the admin
 * panel writes a `mail` row), so the player-to-player send path
 * (`PACKETTYPE_QUERYPOSTMAIL`), the postage fee, and the storage-custody fee
 * are intentionally absent.
 *
 * Depends on `@flyff/{core,entities,world-core,database,inventory}` -- inventory
 * for the take-item credit + its CREATEITEM/UPDATE_ITEM echoes.
 *
 * @module @flyff/mail
 */

export * from './services/mail.service';
export * from './handlers/mail.handler';
export * from './net/snapshot/mailBox.serializer';
export * from './net/snapshot/removeMail.serializer';
