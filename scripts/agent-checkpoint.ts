import fs from 'fs/promises';
import path from 'path';

/**
 * Automates the updating of .claude/state/SESSION.md.
 * Usage: tsx scripts/agent-checkpoint.ts --goal="New Goal" --status="In Progress" --task="Finished task X"
 */

async function main(): Promise<void> {
  const args: string[] = process.argv.slice(2);
  const sessionPath: string = path.join(process.cwd(), '.claude/state/SESSION.md');

  try {
    let content: string = await fs.readFile(sessionPath, 'utf8');
    const now: string = new Date().toISOString().split('T')[0];

    // Simple arg parsing
    const goal: string | undefined = args.find((a: string) => a.startsWith('--goal='))?.split('=')[1];
    const status: string | undefined = args.find((a: string) => a.startsWith('--status='))?.split('=')[1];
    const task: string | undefined = args.find((a: string) => a.startsWith('--task='))?.split('=')[1];

    if (goal) {
      content = content.replace(/- \*\*Active Goal\*\*: .*/, `- **Active Goal**: ${goal}`);
    }

    if (status) {
      content = content.replace(/- \*\*Status\*\*: .*/, `- **Status**: ${status}`);
    }

    content = content.replace(/- \*\*Last Updated\*\*: .*/, `- **Last Updated**: ${now}`);

    if (task) {
      const logHeader = '## Progress Log';
      const logIndex = content.indexOf(logHeader);
      if (logIndex !== -1) {
        // Find the boundary between log and technical context
        const techHeader = '## Technical Context';
        const techIndex = content.indexOf(techHeader);

        const logContent = content.slice(logIndex + logHeader.length, techIndex).trim();
        const techContent = content.slice(techIndex);

        const logLines = logContent.split('\n').filter((l: string) => l.trim().length > 0);

        // Find first non-completed item or append
        const firstPending = logLines.findIndex((l: string) => l.includes('[ ]') || l.includes('[/]'));
        if (firstPending !== -1) {
          logLines.splice(firstPending, 0, `- [x] ${task} (Checkpoint auto-log)`);
        } else {
          logLines.push(`- [x] ${task} (Checkpoint auto-log)`);
        }

        content = content.slice(0, logIndex + logHeader.length) + '\n\n' + logLines.join('\n') + '\n\n' + techContent;
      }
    }

    await fs.writeFile(sessionPath, content);
    console.log(`Checkpoint updated: ${now}`);
  } catch (error) {
    console.error('Failed to update checkpoint:', error);
    process.exit(1);
  }
}

main();
