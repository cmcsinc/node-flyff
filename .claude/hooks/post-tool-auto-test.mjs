#!/usr/bin/env node
/**
 * PostToolUse Hook — Auto-run tests after writing a .test.ts file
 *
 * When the agent writes or edits a .test.ts file, this hook immediately
 * runs that file with `npx tsx --test` and appends the result to SESSION.md
 * so the agent knows in the same turn whether tests pass or fail.
 *
 * SELF-LEARNING: When a test that previously FAILED now PASSES, the hook
 * records a "Lesson Learned" entry in MEMORY.md and PROGRESS.md so that
 * future agents benefit from the fix.
 *
 * Input (stdin): JSON with tool_name, tool_input
 * Output: Writes test result summary to SESSION.md
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const MEMORY_PATH = join(process.env.HOME ?? '', '.claude/projects/-Users-owner-Cyril-nodejs-flyff/memory/MEMORY.md');
const PROGRESS_PATH = join(process.cwd(), '.claude/state/PROGRESS.md');
const SESSION_PATH = join(process.cwd(), '.claude/state/SESSION.md');
// Tracks last known result per test file across the hook's runtime.
// Persisted as a JSON file so it survives across hook invocations within a session.
const RESULT_CACHE_PATH = join(process.cwd(), '.claude/state/test-result-cache.json');

function loadResultCache() {
  try {
    if (existsSync(RESULT_CACHE_PATH)) {
      return JSON.parse(readFileSync(RESULT_CACHE_PATH, 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveResultCache(cache) {
  try {
    writeFileSync(RESULT_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch { /* ignore */ }
}

/**
 * Appends a "Lesson Learned" entry to MEMORY.md.
 * Only writes if the lesson is not already recorded (deduplication).
 */
function recordLesson(shortPath, lessonText) {
  try {
    if (!existsSync(MEMORY_PATH)) return;
    let memory = readFileSync(MEMORY_PATH, 'utf8');
    // Deduplication: skip if shortPath already appears in Lessons Learned
    if (memory.includes(shortPath)) return;

    const now = new Date().toISOString().slice(0, 10);
    const lessonEntry = `- **[${now}] ${shortPath}**: ${lessonText}`;

    if (memory.includes('## Lessons Learned')) {
      memory = memory.replace('## Lessons Learned\n', `## Lessons Learned\n${lessonEntry}\n`);
    } else {
      // Append new section at end of file
      memory = memory.trimEnd() + `\n\n## Lessons Learned\n${lessonEntry}\n`;
    }
    writeFileSync(MEMORY_PATH, memory);
  } catch { /* never crash Claude */ }
}

/**
 * Appends a lesson to PROGRESS.md → Agent Communication Log.
 */
function recordProgressLesson(shortPath, lessonText) {
  try {
    if (!existsSync(PROGRESS_PATH)) return;
    let progress = readFileSync(PROGRESS_PATH, 'utf8');
    if (progress.includes(shortPath)) return; // already recorded

    const now = new Date().toISOString().slice(0, 10);
    const entry = `| ${now} | auto-test hook | all agents | FIX→PASS: \`${shortPath}\` — ${lessonText} |`;

    if (progress.includes('## Agent Communication Log')) {
      progress = progress.replace(
        /(\| Timestamp \| From \| To \| Message \|\n\|[-| ]+\|\n)/,
        (match) => match + entry + '\n',
      );
    }
    writeFileSync(PROGRESS_PATH, progress);
  } catch { /* never crash Claude */ }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const toolName = input.tool_name ?? '';
    const toolInput = input.tool_input ?? {};

    if (!['Write', 'Edit'].includes(toolName)) process.exit(0);

    const filePath = toolInput.file_path ?? '';

    // Only run for .test.ts files
    if (!filePath.endsWith('.test.ts')) process.exit(0);
    if (!existsSync(filePath)) process.exit(0);
    if (!existsSync(SESSION_PATH)) process.exit(0);

    // ── Run the tests ──────────────────────────────────────────────────────
    let testResult = '';
    let passed = false;
    try {
      const output = execSync(`npx tsx --test "${filePath}" 2>&1`, {
        encoding: 'utf8',
        timeout: 30_000,
        cwd: process.cwd(),
      });
      testResult = output.trim().split('\n').slice(-5).join('\n'); // last 5 lines
      passed = !output.includes('not ok') && !output.includes('Error:');
    } catch (err) {
      const output = err.stdout ?? err.message ?? 'Unknown error';
      testResult = output.trim().split('\n').slice(-8).join('\n');
      passed = false;
    }

    // ── Self-learning: detect FAIL → PASS transitions ─────────────────────
    const shortPath = filePath.replace(process.cwd() + '/', '');
    const cache = loadResultCache();
    const previousResult = cache[shortPath]; // 'pass' | 'fail' | undefined

    if (previousResult === 'fail' && passed) {
      // Extract what changed: look for the most recent diff context (first 3 lines of testResult)
      const summary = testResult.split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ').slice(0, 200);
      const lessonText = `Tests now pass after fix. Passing output: "${summary}"`;
      recordLesson(shortPath, lessonText);
      recordProgressLesson(shortPath, lessonText);
    }

    // Update cache
    cache[shortPath] = passed ? 'pass' : 'fail';
    saveResultCache(cache);

    // ── Write result to SESSION.md ─────────────────────────────────────────
    const icon = passed ? '✅' : '❌';
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const entry = `- ${icon} Test run [${now}]: \`${shortPath}\` — ${passed ? 'PASSED' : 'FAILED'}\n  \`\`\`\n  ${testResult.replace(/\n/g, '\n  ')}\n  \`\`\`\n`;

    let content = readFileSync(SESSION_PATH, 'utf8');

    // Insert into Test Results section, or create it
    if (content.includes('## Test Results')) {
      content = content.replace(
        '## Test Results\n',
        `## Test Results\n${entry}`,
      );
    } else {
      content = content.replace(
        '## Pending Questions for User',
        `## Test Results\n${entry}\n## Pending Questions for User`,
      );
    }

    writeFileSync(SESSION_PATH, content);
  } catch {
    // Never crash Claude — silently exit
  }
  process.exit(0);
});
