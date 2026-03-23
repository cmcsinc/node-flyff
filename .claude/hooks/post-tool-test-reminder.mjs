#!/usr/bin/env node
/**
 * PostToolUse Hook — Test Auto-run on Source File Edits
 *
 * After editing a .ts source file, checks if a companion .test.ts
 * exists and queues a reminder in SESSION.md if it does not.
 *
 * Input (stdin): JSON with tool_name, tool_input
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

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

    // Only handle .ts source files (not test files themselves)
    if (!filePath.endsWith('.ts') || filePath.endsWith('.test.ts')) process.exit(0);

    const testPath = filePath.replace(/\.ts$/, '.test.ts');
    if (existsSync(testPath)) process.exit(0); // Test file already exists

    // Log missing test file as a warning in SESSION.md
    const sessionPath = join(process.cwd(), '.claude/state/SESSION.md');
    if (!existsSync(sessionPath)) process.exit(0);

    let content = readFileSync(sessionPath, 'utf8');
    const warning = `- [ ] ⚠️  Missing test file: \`${testPath}\``;

    if (!content.includes(testPath)) {
      // Insert warning before Pending Questions section
      content = content.replace(
        '## Pending Questions for User',
        `${warning}\n\n## Pending Questions for User`
      );
      writeFileSync(sessionPath, content);
    }
  } catch {
    // Never crash Claude — silently exit
  }
  process.exit(0);
});
