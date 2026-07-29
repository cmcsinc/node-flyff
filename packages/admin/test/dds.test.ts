/**
 * DDS decode + color-key tests.
 *
 * `applyColorKey` is the fix for purple icon backgrounds: the Flyff client
 * passes `0xffff00ff` as a D3D color key on every icon load
 * (`game/source/_Common/Item.cpp:113`), so magenta on these A1R5G5B5 surfaces
 * means "transparent", not "pink". The offline PNG converter has to do the same
 * punch-out or the admin UI shows a purple square behind every item.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { applyColorKey, type DecodedImage } from '../scripts/dds.js';

function img(pixels: number[][]): DecodedImage {
  return {
    width: pixels.length,
    height: 1,
    data: new Uint8Array(pixels.flat()),
  };
}

describe('applyColorKey', () => {
  it('zeroes alpha and RGB on exact magenta', () => {
    const out = applyColorKey(img([[255, 0, 255, 255]]));
    assert.deepEqual([...out.data], [0, 0, 0, 0]);
  });

  it('leaves near-magenta untouched (exact match only, like D3DX)', () => {
    const out = applyColorKey(img([[254, 0, 255, 255]]));
    assert.deepEqual([...out.data], [254, 0, 255, 255]);
  });

  it('preserves non-keyed pixels alongside keyed ones', () => {
    const out = applyColorKey(
      img([
        [255, 0, 255, 255],
        [10, 20, 30, 255],
      ]),
    );
    assert.deepEqual([...out.data], [0, 0, 0, 0, 10, 20, 30, 255]);
  });
});
