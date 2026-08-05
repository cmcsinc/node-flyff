/**
 * Shared `define*.h` text handling for every consumer that scans `#define`
 * lines: the converters (`scripts/converters/parse.ts`, `questTokenize.ts`) and
 * the quest writer's reverse symbol table (`writers/questSymbols.ts`).
 *
 * All three are line-regex scanners, not preprocessors, so a commented-out
 * block of defines reads as live code unless it is blanked first. `defineObj.h`
 * has exactly that: a dead `MI_*` block (lines 1852-1921) sitting above the
 * live one. With first-write-wins the dead numbering won, giving 65 of 1120
 * movers a `dwObjIndex` the client never uses -- the server ran a different
 * monster than the client drew.
 *
 * @module defineHeader
 */

/**
 * Blank out `/* ... *\/` block-comment bodies, keeping every newline so line
 * numbers and the `^` anchor of a multiline `#define` scan stay put.
 *
 * Not string-aware: define headers have no string literals containing `/*`, and
 * a `.inc` source (which does) goes through `questTokenize.stripComments`.
 */
export function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
}

/** Decode a define header buffer (the v19 headers are UTF-16LE with BOM). */
export function decodeDefineHeader(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}
