/**
 * Cross-platform test-file collector + `tsx --test` launcher.
 *
 * Why this exists: a bare `tsx --test "test/**\/*.test.ts"` cannot work
 * everywhere. Unquoted, the shell expands it -- and bash without `globstar`
 * turns `**` into a single `*`, so root-level test files never match. Quoted,
 * the glob reaches node, which only learned to expand it in Node 22 (the
 * Node 20 leg then dies with "Could not find"). So we glob in JS and hand
 * `tsx` an explicit file list.
 *
 * Usage: `node <path>/run-tests.mjs [--tsx-flag ...] [rootDir ...]`
 * (default root: `test`). A root may contain one `*` segment, e.g.
 * `packages/<star>/test`. Args starting with `-` are forwarded to `tsx`.
 */
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('-'));
const roots = args.filter((a) => !a.startsWith('-'));
const files = [];

/** Recurse `dir`, pushing every `*.test.ts(x)` path into `files`. */
function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.test\.tsx?$/.test(entry.name)) files.push(full);
  }
}

/** Expand a single `*` segment (e.g. `packages/<star>/test`) into concrete dirs. */
function expand(pattern) {
  const i = pattern.split(/[\\/]/).indexOf('*');
  if (i < 0) return [pattern];
  const parts = pattern.split(/[\\/]/);
  const base = parts.slice(0, i).join('/') || '.';
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => [base, e.name, ...parts.slice(i + 1)].join('/'));
}

for (const pattern of roots.length > 0 ? roots : ['test']) {
  for (const root of expand(pattern)) {
    if (existsSync(root)) collect(root);
  }
}

if (files.length === 0) {
  console.error(`run-tests: no *.test.ts under ${roots.join(', ') || 'test'}`);
  process.exit(1);
}

const tsxBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const bin = existsSync(tsxBin) ? tsxBin : 'tsx';
const { status } = spawnSync(bin, ['--test', ...flags, ...files], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(status ?? 1);
