/**
 * Tests for the `character.inc` statement scanner.
 *
 * The scanner is what makes the writer surgical, so the cases here are the raw
 * file's real formatting variants -- continuation after a comma, name and paren
 * on separate lines, stray double spaces, and `//` comments that contain
 * parens or braces.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  detectEol,
  findStatements,
  replaceStatements,
  settingEnd,
  splitLines,
} from '../../src/writers/incStatements';

describe('findStatements', () => {
  it('finds a single-line statement and captures its indent', () => {
    const lines = ['\tsetting', '\t{', '\t\tAddMenu( MMI_TRADE  );', '\t}'];
    const found = findStatements(lines, 'AddMenu');
    assert.equal(found.length, 1);
    assert.equal(found[0]?.start, 2);
    assert.equal(found[0]?.count, 1);
    assert.equal(found[0]?.indent, '\t\t');
  });

  it('spans a statement that breaks after a comma', () => {
    const lines = ['\t\tAddVendorSlot( 0,', '\tIDS_X', '\t);', '\t\tAddMenu( MMI_DIALOG );'];
    const found = findStatements(lines, 'AddVendorSlot');
    assert.equal(found.length, 1);
    assert.equal(found[0]?.count, 3);
    assert.ok(found[0]?.text.includes('IDS_X'));
  });

  it('spans a statement whose name and paren are on separate lines', () => {
    const lines = ['\tSetName', '\t(', '\tIDS_X', '\t);', '}'];
    const found = findStatements(lines, 'SetName');
    assert.equal(found.length, 1);
    assert.equal(found[0]?.count, 4);
  });

  it('finds every occurrence', () => {
    const lines = [
      '\t\tAddMenu( MMI_DIALOG );',
      '\t\t// AddMenu in a comment must not match',
      '\t\tAddMenu( MMI_TRADE );',
    ];
    assert.equal(findStatements(lines, 'AddMenu').length, 2);
  });

  it('does not let AddVendorItem match AddVendorItem2', () => {
    const lines = ['\t\tAddVendorItem2( 0, 42 );', '\t\tAddVendorItem( 0, IK3_SWD, -1, 0, 1, 2 );'];
    const one = findStatements(lines, 'AddVendorItem');
    assert.equal(one.length, 1);
    assert.equal(one[0]?.start, 1);
    assert.equal(findStatements(lines, 'AddVendorItem2').length, 1);
  });

  it('treats a parenless assignment as a single line', () => {
    const lines = ['\t\tm_nStructure= SRT_MAGIC;', '\t\tm_szDialog= "A.txt";'];
    const found = findStatements(lines, 'm_nStructure');
    assert.equal(found.length, 1);
    assert.equal(found[0]?.count, 1);
  });

  it('returns nothing for an absent name', () => {
    assert.deepEqual(findStatements(['\t\tAddMenu( MMI_TRADE );'], 'SetFigure'), []);
  });
});

describe('replaceStatements', () => {
  it('replaces in place at the first occurrence, reusing its indent', () => {
    const lines = ['\ta', '\t\tAddMenu( MMI_A );', '\t\tAddMenu( MMI_B );', '\tb'];
    replaceStatements(lines, 'AddMenu', ['AddMenu( MMI_C );'], 99);
    assert.deepEqual(lines, ['\ta', '\t\tAddMenu( MMI_C );', '\tb']);
  });

  it('deletes when given no replacements', () => {
    const lines = ['\ta', '\t\tAddMenu( MMI_A );', '\tb'];
    replaceStatements(lines, 'AddMenu', [], 99);
    assert.deepEqual(lines, ['\ta', '\tb']);
  });

  it('inserts at fallbackPos when the statement is absent', () => {
    const lines = ['\ta', '\tb'];
    replaceStatements(lines, 'SetOutput', ['SetOutput( FALSE );'], 1);
    assert.deepEqual(lines, ['\ta', '\t\tSetOutput( FALSE );', '\tb']);
  });

  it('collapses a multi-line statement to the replacement', () => {
    const lines = ['\t\tAddVendorSlot( 0,', '\tIDS_OLD', '\t);'];
    replaceStatements(lines, 'AddVendorSlot', ['AddVendorSlot( 1, IDS_NEW );'], 99);
    assert.deepEqual(lines, ['\t\tAddVendorSlot( 1, IDS_NEW );']);
  });
});

describe('settingEnd', () => {
  it('returns the line closing the setting group', () => {
    const lines = ['\tsetting', '\t{', '\t\tAddMenu( MMI_A );', '\t}', '', '\tSetName'];
    assert.equal(settingEnd(lines), 3);
  });

  it('falls back to the end when there is no setting group', () => {
    const lines = ['\tSetName', '\t(', '\tIDS_X', '\t);'];
    assert.equal(settingEnd(lines), 4);
  });
});

describe('detectEol / splitLines', () => {
  it('detects CRLF and LF', () => {
    assert.equal(detectEol('a\r\nb'), '\r\n');
    assert.equal(detectEol('a\nb'), '\n');
  });

  it('splits on either variant without keeping the terminator', () => {
    assert.deepEqual(splitLines('a\r\nb\nc'), ['a', 'b', 'c']);
  });

  it('leaves a trailing empty element for a trailing newline', () => {
    assert.deepEqual(splitLines('a\r\n'), ['a', '']);
  });
});
