#!/usr/bin/env node
// Registers the supervisor daemon with the host's service manager so the game
// servers come back after a reboot with no human action. Instances flagged
// `autoStart` in config/instances.json boot with the daemon.
//
//   node scripts/supervisor-service.mjs install    # register + start
//   node scripts/supervisor-service.mjs uninstall  # stop + deregister
//   node scripts/supervisor-service.mjs print      # dump the unit/config only
//
// Backend is auto-detected: pm2 if on PATH, else systemd (Linux) or a printed
// nssm/Task Scheduler recipe (Windows without pm2). Pass --backend=pm2|systemd
// to force one.
//
// ponytail: no Windows-native service without pm2 (prints instructions instead).
// Upgrade path = add a node-windows/nssm driver here.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(ROOT, 'packages/admin/lib/supervisor-daemon.ts');
const NAME = 'flyff-supervisor';
const IS_WIN = process.platform === 'win32';

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('--')) ?? 'print';
const forced = args.find((a) => a.startsWith('--backend='))?.split('=')[1];

/** Runs a command, inheriting stdio. Returns the exit code. */
function run(bin, argv) {
  const res = spawnSync(bin, argv, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN });
  return res.status ?? 1;
}

function hasPm2() {
  const res = spawnSync(IS_WIN ? 'where' : 'which', ['pm2'], { shell: IS_WIN });
  return res.status === 0;
}

const backend = forced ?? (hasPm2() ? 'pm2' : IS_WIN ? 'windows' : 'systemd');

// --- pm2 -------------------------------------------------------------------
// `--interpreter node --interpreter-args "--import tsx"` keeps the TS entry
// working without a build step, matching how the daemon is spawned on demand.
const PM2_ARGS = [
  ENTRY,
  '--name', NAME,
  '--interpreter', process.execPath,
  '--interpreter-args', '--import tsx',
  '--cwd', ROOT,
];

function pm2Install() {
  let code = run('pm2', ['start', ...PM2_ARGS]);
  if (code !== 0) return code;
  code = run('pm2', ['save']);
  console.log(
    '\nRun `pm2 startup` once (as admin/root) and follow its printed command\n' +
    'to make pm2 itself resurrect on boot.',
  );
  return code;
}

function pm2Uninstall() {
  run('pm2', ['delete', NAME]);
  return run('pm2', ['save']);
}

// --- systemd ---------------------------------------------------------------
function systemdUnit() {
  return `[Unit]
Description=Flyff game-server supervisor
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${process.execPath} --import tsx ${ENTRY}
Restart=always
RestartSec=5
User=${process.env.USER ?? 'root'}

[Install]
WantedBy=multi-user.target
`;
}

function systemdInstall() {
  const path = `/etc/systemd/system/${NAME}.service`;
  try {
    writeFileSync(path, systemdUnit(), 'utf-8');
  } catch (err) {
    console.error(`Could not write ${path}: ${err.message}\nRe-run with sudo, or:\n`);
    console.log(systemdUnit());
    return 1;
  }
  run('systemctl', ['daemon-reload']);
  run('systemctl', ['enable', NAME]);
  return run('systemctl', ['start', NAME]);
}

function systemdUninstall() {
  run('systemctl', ['stop', NAME]);
  run('systemctl', ['disable', NAME]);
  return run('rm', ['-f', `/etc/systemd/system/${NAME}.service`]);
}

// --- windows (no pm2) ------------------------------------------------------
function windowsRecipe() {
  const exec = `"${process.execPath}" --import tsx "${ENTRY}"`;
  return `No pm2 found. Two options on Windows:

A) pm2 (simplest — cross-platform, same as Linux):
     npm i -g pm2 pm2-windows-startup
     pm2-startup install
     node scripts/supervisor-service.mjs install

B) nssm (a real Windows service):
     nssm install ${NAME} "${process.execPath}" --import tsx "${ENTRY}"
     nssm set ${NAME} AppDirectory "${ROOT}"
     nssm set ${NAME} Start SERVICE_AUTO_START
     nssm start ${NAME}

C) Task Scheduler (no extra tooling), run once as admin:
     schtasks /Create /TN ${NAME} /SC ONSTART /RL HIGHEST /RU SYSTEM ^
       /TR "${exec.replace(/"/g, '\\"')}"
`;
}

// --- dispatch --------------------------------------------------------------
const HANDLERS = {
  pm2: { install: pm2Install, uninstall: pm2Uninstall, print: () => (console.log(`pm2 start ${PM2_ARGS.join(' ')}`), 0) },
  systemd: { install: systemdInstall, uninstall: systemdUninstall, print: () => (console.log(systemdUnit()), 0) },
  windows: { install: () => (console.log(windowsRecipe()), 1), uninstall: () => (console.log(windowsRecipe()), 1), print: () => (console.log(windowsRecipe()), 0) },
};

const handler = HANDLERS[backend]?.[cmd];
if (!handler) {
  console.error(`usage: supervisor-service.mjs <install|uninstall|print> [--backend=pm2|systemd]`);
  process.exit(1);
}
console.log(`[service] backend=${backend} action=${cmd}`);
process.exit(handler());
