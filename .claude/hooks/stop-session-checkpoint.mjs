#!/usr/bin/env node
/**
 * Stop Hook — Session Deep Checkpoint
 *
 * Fires when Claude finishes responding. Writes a timestamp and the
 * current git branch to SESSION.md so the next session can resume
 * from the exact state.
 *
 * Input (stdin): JSON with session_id, transcript_path
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const sessionPath = join(process.cwd(), '.claude/state/SESSION.md');
    if (!existsSync(sessionPath)) process.exit(0);

    let content = readFileSync(sessionPath, 'utf8');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

    // Get current git branch
    let branch = 'unknown';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch { /* not a git repo or no commits yet */ }

    // Update timestamp
    content = content.replace(
      /- \*\*Last Updated\*\*: .*/,
      `- **Last Updated**: ${now} (session end)`
    );

    // Update branch in Technical Context
    if (content.includes('**Current Branch**')) {
      content = content.replace(
        /- \*\*Current Branch\*\*: .*/,
        `- **Current Branch**: \`${branch}\``
      );
    } else {
      content = content.replace(
        '## Technical Context',
        `## Technical Context\n\n- **Current Branch**: \`${branch}\``
      );
    }

    writeFileSync(sessionPath, content);
  } catch {
    // Never crash — silently exit
  }
  process.exit(0);
});
