import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadQuestText } from '../../src/loaders/questText.loader';

/** UTF-16LE BOM + encode (mirrors how propQuest.txt.txt ships). */
function utf16(str: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(str, 'utf16le')]);
}

describe('loadQuestText', () => {
  it('parses IDS_PROPQUEST_INC_* -> text rows from a UTF-16LE file', async () => {
    const dir = join(process.env.TMPDIR ?? '.', `qt-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'propQuest.txt.txt'),
      utf16(
        'IDS_PROPQUEST_INC_000005\tPromote Mercenary\n' +
        'IDS_PROPQUEST_INC_000006\tAfter I told Julia...\n' +
        'IDS_PROPQUEST_INC_000007\t\n' +
        'garbage-no-tab\n',
      ),
    );
    const idx = await loadQuestText(dir);
    assert.equal(idx.get('IDS_PROPQUEST_INC_000005'), 'Promote Mercenary');
    assert.equal(idx.get('IDS_PROPQUEST_INC_000006'), 'After I told Julia...');
    assert.equal(idx.get('IDS_PROPQUEST_INC_000007'), ''); // empty text preserved
    assert.equal(idx.has('garbage-no-tab'), false);
  });

  it('returns an empty map when the file is missing (boot continues)', async () => {
    const idx = await loadQuestText(join(process.env.TMPDIR ?? '.', `nope-${process.pid}-${Date.now()}`));
    assert.equal(idx.size, 0);
  });
});
