#!/usr/bin/env node
// One-shot codemod: strip trailing `.js` from import/export specifiers.
// Part of the Node16 -> Bundler migration. Bundler + tsup tolerate extensionless
// relative imports, and package `exports` maps are now extensionless subpaths.
//
// Touches only trailing `.js` on `from '…js'` and `import('…js')`. Leaves
// `.json`, mid-path `.js`, and non-import strings alone.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages');
const STRIPPERS = [
  [/(\bfrom\s*)(['"])([^'"]+?)\.js\2/g, '$1$2$3$2'],
  [/(\bimport\s*\(\s*)(['"])([^'"]+?)\.js\2/g, '$1$2$3$2'],
];

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith('.ts')) yield p;
  }
}

let files = 0, sites = 0;
for (const pkg of await readdir(ROOT, { withFileTypes: true })) {
  if (!pkg.isDirectory()) continue;
  for (const sub of ['src', 'test']) {
    for await (const file of walk(path.join(ROOT, pkg.name, sub))) {
      const src = await readFile(file, 'utf8');
      let out = src;
      for (const [re, repl] of STRIPPERS) {
        const m = out.match(re);
        if (m) sites += m.length;
        out = out.replace(re, repl);
      }
      if (out !== src) { await writeFile(file, out); files++; }
    }
  }
}
console.log(`stripped .js from ${sites} import specifiers across ${files} files`);
