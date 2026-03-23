#!/usr/bin/env node
/**
 * PostToolUse Hook — Automatic Session Checkpointing
 *
 * Fired after every Write or Edit tool call. Reads stdin for the tool
 * context and appends a brief log entry to SESSION.md.
 *
 * Input (stdin): JSON with tool_name, tool_input, hook_event_name
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const toolName = input.tool_name ?? '';
    const toolInput = input.tool_input ?? {};

    // Only checkpoint on file-writing tools
    if (!['Write', 'Edit'].includes(toolName)) process.exit(0);

    const filePath = toolInput.file_path ?? toolInput.path ?? 'unknown file';
    const sessionPath = join(process.cwd(), '.claude/state/SESSION.md');

    if (!existsSync(sessionPath)) process.exit(0);

    let content = readFileSync(sessionPath, 'utf8');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

    // Update Last Updated timestamp
    content = content.replace(
      /- \*\*Last Updated\*\*: .*/,
      `- **Last Updated**: ${now}`
    );

    // Append to Technical Context: Last Successful Tool
    content = content.replace(
      /- \*\*Current Task\*\*: .*/,
      `- **Current Task**: Modified \`${filePath}\` via ${toolName} at ${now}`
    );

    writeFileSync(sessionPath, content);
  } catch {
    // Never crash Claude — silently exit
  }
  process.exit(0);
});
