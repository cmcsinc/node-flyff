#!/usr/bin/env node
// Supervisor CLI — manage the detached daemon that owns the game-server
// processes. The admin dashboard talks to the same daemon, so servers started
// here show up there and vice versa.
//
//   node scripts/supervisor.mjs status
//   node scripts/supervisor.mjs start <instanceId>
//   node scripts/supervisor.mjs stop <instanceId>
//   node scripts/supervisor.mjs autostart <instanceId> [on|off]
//   node scripts/supervisor.mjs up          # start every registered instance
//   node scripts/supervisor.mjs down        # stop all children + exit daemon
//   node scripts/supervisor.mjs logs <instanceId>
//
// Equivalent pnpm aliases: `pnpm sv:status`, `pnpm sv:up`, `pnpm sv:down`.
// To survive a host reboot: `node scripts/supervisor-service.mjs install`.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// `-e` scripts have no base URL, so imports must be absolute file:// URLs
// (a bare `H:\...` path is rejected as an unsupported ESM scheme on Windows).
const LIB = pathToFileURL(resolve(ROOT, 'packages/admin/lib')).href;

/** Runs the TS body in a tsx child so this .mjs needs no build step. */
function runTs(source) {
  return new Promise((res) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('exit', (code) => res(code ?? 1));
  });
}

const [cmd, arg] = process.argv.slice(2);
const IMPORTS = `
import { getStatuses, listInstances, saveInstances, startInstance, stopInstance, getLogs, requestShutdown } from '${LIB}/server-manager.ts';
import { daemonAlive, ensureDaemon } from '${LIB}/supervisor-client.ts';
`;

const BODIES = {
  status: `
    const handle = await ensureDaemon();
    console.log(handle ? \`daemon pid=\${handle.pid} port=\${handle.port}\` : 'daemon: UNREACHABLE');
    for (const i of await getStatuses()) {
      console.log(\`  \${i.id.padEnd(12)} \${i.type.padEnd(8)} :\${String(i.port).padEnd(6)} \${i.state.padEnd(9)} pid=\${String(i.pid ?? '-').padEnd(7)} \${i.autoStart ? 'auto' : ''}\`);
    }
  `,
  autostart: `
    const [id, flag] = ${JSON.stringify([arg ?? '', process.argv[4] ?? 'on'])};
    const enabled = flag !== 'off';
    const instances = listInstances();
    const idx = instances.findIndex((i) => i.id === id);
    if (idx < 0) { console.error('Unknown instance: ' + id); process.exit(1); }
    instances[idx] = { ...instances[idx], autoStart: enabled };
    saveInstances(instances);
    console.log(id + ': autostart ' + (enabled ? 'on' : 'off'));
  `,
  start: `
    const res = await startInstance(${JSON.stringify(arg ?? '')});
    if ('error' in res) { console.error(res.error); process.exit(1); }
    console.log(\`\${res.id}: \${res.state} pid=\${res.pid}\`);
  `,
  stop: `
    const res = await stopInstance(${JSON.stringify(arg ?? '')});
    if ('error' in res) { console.error(res.error); process.exit(1); }
    console.log('stopping ${arg ?? ''}');
  `,
  up: `
    for (const inst of listInstances()) {
      const res = await startInstance(inst.id);
      console.log('error' in res ? \`\${inst.id}: \${res.error}\` : \`\${inst.id}: \${res.state} pid=\${res.pid}\`);
    }
  `,
  down: `
    if (!(await daemonAlive())) { console.log('daemon not running'); process.exit(0); }
    const res = await requestShutdown();
    console.log('error' in res ? res.error : 'daemon shutting down');
  `,
  logs: `
    let since = 0;
    for (;;) {
      for (const l of await getLogs(${JSON.stringify(arg ?? '')}, since)) {
        since = Math.max(since, l.seq);
        console.log(l.line);
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  `,
};

if (!cmd || !(cmd in BODIES)) {
  console.error(`usage: supervisor.mjs <${Object.keys(BODIES).join('|')}> [instanceId]`);
  process.exit(1);
}
if ((cmd === 'start' || cmd === 'stop' || cmd === 'logs' || cmd === 'autostart') && !arg) {
  console.error(`${cmd} requires an instance id (see \`supervisor.mjs status\`)`);
  process.exit(1);
}

process.exit(await runTs(IMPORTS + BODIES[cmd]));
