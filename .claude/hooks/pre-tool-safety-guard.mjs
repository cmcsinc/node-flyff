#!/usr/bin/env node
/**
 * PreToolUse Hook — Bash Command Safety Guard
 *
 * Blocks dangerous destructive git and system commands from running
 * without explicit confirmation. Returns exit code 2 to block.
 *
 * Blocked patterns:
 *   - git reset --hard
 *   - git push --force / -f to main or master
 *   - rm -rf (outside of node_modules or dist)
 *   - DROP TABLE (raw SQL)
 *
 * Input (stdin): JSON with tool_name, tool_input.command
 */


let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    if (input.tool_name !== 'Bash') process.exit(0);

    const rawCommand = (input.tool_input?.command ?? '').trim();

    // Strip everything inside heredocs (<<'EOF'...EOF) and quoted strings
    // so we only inspect the actual shell commands, not commit message text.
    const command = rawCommand
      .replace(/<<\s*['"]?EOF['"]?[\s\S]*?^EOF/gm, '')   // remove heredoc bodies
      .replace(/-m\s+"[^"]*"/g, '-m ""')                  // remove -m "..." bodies
      .replace(/-m\s+'[^']*'/g, "-m ''")                  // remove -m '...' bodies
      .replace(/-m\s+\$\(cat[^)]*\)/gs, '-m ""');         // remove -m $(cat ...) bodies

    const BLOCKED = [
      { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'git reset --hard destroys uncommitted work' },
      { pattern: /\bgit\s+push\s+(--force|-f)\b.*\b(main|master)\b/, reason: 'Force-pushing to main/master is forbidden' },
      { pattern: /\bgit\s+push\s+(--force|-f)\s*$/, reason: 'Force-push requires explicit branch — cowardly refusing' },
      { pattern: /\bDROP\s+TABLE\b/i, reason: 'Raw DROP TABLE detected — use Knex migrations instead' },
      { pattern: /\brm\s+-rf\s+(?!\S*(node_modules|dist|\.cache|tmp))/, reason: 'rm -rf outside of safe directories is blocked' },
    ];

    for (const { pattern, reason } of BLOCKED) {
      if (pattern.test(command)) {
        const decision = {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `🛡️ Safety Guard: ${reason}. If you truly need this, ask the user to run it manually.`,
          },
        };
        process.stdout.write(JSON.stringify(decision));
        process.exit(0);
      }
    }
  } catch {
    // On parse error, allow through — don't block legitimate work
  }
  process.exit(0);
});
