import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_QUERYMAILBOX, SNAPSHOTTYPE_REMOVEMAIL } from '@flyff/world-core';
import {
  MailBoxSerializer,
  MAX_MAIL,
  MAX_MAIL_TITLE_CHARS,
  MAX_MAIL_TEXT_CHARS,
  type MailWireEntry,
} from '../../../src/net/snapshot/mailBox.serializer';
import { RemoveMailSerializer, MAIL_TYPE } from '../../../src/net/snapshot/removeMail.serializer';

/** Bytes of one `CItemElem::Serialize` body (CItemBase 16 + CItemElem 62). */
const ITEM_ELEM_BYTES = 78;

function mail(over: Partial<MailWireEntry> = {}): MailWireEntry {
  return {
    nMail: 7,
    idSender: 0,
    gold: 0,
    ageSecs: 0,
    read: false,
    title: 'hello',
    text: 'world',
    item: null,
    ...over,
  };
}

/** Read past the snapshot frame to the first mailbox field. */
function openBox(buf: Buffer, objid: number): PacketReader {
  const r = new PacketReader(buf);
  assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
  assert.equal(r.readDword(), NULL_ID);
  assert.equal(r.readWord(), 1);
  assert.equal(r.readDword(), objid);
  assert.equal(r.readWord(), SNAPSHOTTYPE_QUERYMAILBOX);
  return r;
}

describe('MailBoxSerializer (SNAPSHOTTYPE_QUERYMAILBOX 0x00e9)', () => {
  it('writes idReceiver + an int32 count, then each CMail body in order', () => {
    const objid = 0x00010020;
    const buf = new MailBoxSerializer().build(objid, objid, [
      mail({ nMail: 1, idSender: 0, gold: 5000, ageSecs: 90, read: true, title: 'a', text: 'b' }),
      mail({ nMail: 2, idSender: 42, gold: 0, ageSecs: 0, read: false, title: 'c', text: 'd' }),
    ]);
    const r = openBox(buf, objid);

    assert.equal(r.readDword(), objid, 'idReceiver');
    assert.equal(r.readDword(), 2, 'count is a 4-byte int, not a WORD');

    // Mail 1
    assert.equal(r.readDword(), 1, 'm_nMail');
    assert.equal(r.readDword(), 0, 'm_idSender (0 = system/FLYFF)');
    assert.equal(r.readByte(), 0, 'no attachment');
    assert.equal(r.readDword(), 5000, 'm_nGold');
    assert.equal(r.readDword(), 90, 'age in seconds, NOT a timestamp');
    assert.equal(r.readByte(), 1, 'm_byRead');
    assert.equal(r.readString(), 'a');
    assert.equal(r.readString(), 'b');

    // Mail 2
    assert.equal(r.readDword(), 2);
    assert.equal(r.readDword(), 42);
    assert.equal(r.readByte(), 0);
    assert.equal(r.readDword(), 0);
    assert.equal(r.readDword(), 0);
    assert.equal(r.readByte(), 0);
    assert.equal(r.readString(), 'c');
    assert.equal(r.readString(), 'd');
  });

  it('writes the 78-byte CItemElem body only when an attachment is present', () => {
    const objid = 5;
    const withItem = new MailBoxSerializer().build(objid, objid, [
      mail({ item: { itemId: 1234, count: 3 } }),
    ]);
    const without = new MailBoxSerializer().build(objid, objid, [mail()]);
    assert.equal(
      withItem.length - without.length,
      ITEM_ELEM_BYTES,
      'attachment must add exactly one CItemElem body',
    );

    const r = openBox(withItem, objid);
    r.readDword();                              // idReceiver
    r.readDword();                              // count
    r.readDword();                              // m_nMail
    r.readDword();                              // m_idSender
    assert.equal(r.readByte(), 1, 'item-present flag');
    // CItemBase head: objId then itemId.
    assert.equal(r.readDword(), 7, 'm_dwObjId (the mail id)');
    assert.equal(r.readDword(), 1234, 'm_dwItemId');
  });

  it('reads back cleanly after an attachment -- no byte drift into the next mail', () => {
    const objid = 9;
    const buf = new MailBoxSerializer().build(objid, objid, [
      mail({ nMail: 1, item: { itemId: 111, count: 1 } }),
      mail({ nMail: 2, gold: 77, title: 'second', text: 'tail' }),
    ]);
    const r = openBox(buf, objid);
    r.readDword();
    assert.equal(r.readDword(), 2);
    // Skip mail 1 entirely.
    r.readDword(); r.readDword();
    assert.equal(r.readByte(), 1);
    r.readBytes(ITEM_ELEM_BYTES);
    r.readDword(); r.readDword(); r.readByte();
    r.readString(); r.readString();
    // Mail 2 must land exactly here.
    assert.equal(r.readDword(), 2, 'm_nMail of the second mail');
    assert.equal(r.readDword(), 0);
    assert.equal(r.readByte(), 0);
    assert.equal(r.readDword(), 77);
    r.readDword();
    assert.equal(r.readByte(), 0);
    assert.equal(r.readString(), 'second');
    assert.equal(r.readString(), 'tail');
  });

  it('truncates over-long title/text (an over-long ReadString kills the archive)', () => {
    const objid = 3;
    const buf = new MailBoxSerializer().build(objid, objid, [
      mail({ title: 'T'.repeat(80), text: 'X'.repeat(400) }),
    ]);
    const r = openBox(buf, objid);
    r.readDword(); r.readDword();
    r.readDword(); r.readDword(); r.readByte();
    r.readDword(); r.readDword(); r.readByte();
    assert.equal(r.readString().length, MAX_MAIL_TITLE_CHARS);
    assert.equal(r.readString().length, MAX_MAIL_TEXT_CHARS);
  });

  it('caps the list at MAX_MAIL', () => {
    const objid = 3;
    const many = Array.from({ length: MAX_MAIL + 10 }, (_, i) => mail({ nMail: i + 1 }));
    const r = openBox(new MailBoxSerializer().build(objid, objid, many), objid);
    r.readDword();
    assert.equal(r.readDword(), MAX_MAIL);
  });

  it('clamps a negative age to 0 rather than writing a wrapped DWORD', () => {
    const objid = 3;
    const r = openBox(new MailBoxSerializer().build(objid, objid, [mail({ ageSecs: -50 })]), objid);
    r.readDword(); r.readDword();
    r.readDword(); r.readDword(); r.readByte(); r.readDword();
    assert.equal(r.readDword(), 0);
  });
});

describe('RemoveMailSerializer (SNAPSHOTTYPE_REMOVEMAIL 0x00e7)', () => {
  it('writes nMail then a 4-byte nType', () => {
    const objid = 0x00010020;
    const buf = new RemoveMailSerializer().build(objid, 12, MAIL_TYPE.ITEM);
    const r = new PacketReader(buf);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), objid);
    assert.equal(r.readWord(), SNAPSHOTTYPE_REMOVEMAIL);
    assert.equal(r.readDword(), 12);
    assert.equal(r.readDword(), MAIL_TYPE.ITEM);
    // 4 opcode + 4 NULL_ID + 2 count + 4 objid + 2 type + 4 nMail + 4 nType.
    // The 0x5E marker frame is added at the socket boundary, not here.
    assert.equal(buf.length, 4 + 4 + 2 + 4 + 2 + 4 + 4);
  });

  it('maps the CMail enum to 0/1/2/3', () => {
    assert.equal(MAIL_TYPE.MAIL, 0);
    assert.equal(MAIL_TYPE.ITEM, 1);
    assert.equal(MAIL_TYPE.GOLD, 2);
    assert.equal(MAIL_TYPE.READ, 3);
  });
});
