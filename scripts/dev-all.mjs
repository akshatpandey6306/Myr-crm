import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const apiPort = process.env.API_PORT || '4000';
const webPort = process.env.WEB_PORT || '3000';
const supervisorLock = resolve('.next/dev-all.lock');

function acquireSupervisorLock() {
  mkdirSync(dirname(supervisorLock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(supervisorLock, 'wx');
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(supervisorLock, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); return false; } catch { /* stale lock */ }
      }
      unlinkSync(supervisorLock);
    }
  }
  return false;
}

if (!acquireSupervisorLock()) {
  console.log('[Dev] This project already has a dev supervisor running. Reusing its services.');
  process.exit(0);
}

function listeningPids(port) {
  if (process.platform !== 'win32') return [];
  const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return [];
  const owners = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (match?.[1] === String(port) && match[2] !== '0' && match[2] !== '4') owners.add(match[2]);
  }
  return [...owners];
}

function clearPortOwners(port) {
  const owners = listeningPids(port);
  if (!owners.length) return;
  for (const pid of owners) {
    console.warn(`[Dev] Releasing port ${port} from stale listener PID ${pid}.`);
    spawnSync('taskkill', ['/pid', pid, '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  }
}

async function isExistingCrmService(state) {
  const url = state.name === 'API'
    ? `http://127.0.0.1:${state.port}/api/v1/health`
    : `http://127.0.0.1:${state.port}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return false;
    if (state.name === 'API') return true;
    const html = await response.text();
    return /LeadPilot|myr-crm/i.test(html);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
const services = [
  {
    name: 'API',
    args: ['run', 'api:dev'],
    port: apiPort,
    env: { API_PORT: apiPort },
  },
  {
    name: 'Web',
    args: ['run', 'dev:web'],
    port: webPort,
    env: {
      PORT: webPort,
      API_PROXY_URL: process.env.API_PROXY_URL || `http://127.0.0.1:${apiPort}/api/v1`,
    },
  },
];

const states = new Map(services.map((service) => [service.name, {
  ...service,
  child: null,
  restartTimer: null,
  restartDelayMs: 1000,
  startedAt: 0,
  portConflict: false,
  existingServer: false,
}]));

let stopping = false;

function launch(state) {
  if (stopping) return;

  clearPortOwners(state.port);
  const npmCli = process.env.npm_execpath;
  const npmCommand = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmArgs = npmCli ? [npmCli, ...state.args] : state.args;
  console.log(`[${state.name}] starting: npm ${state.args.join(' ')}`);

  const child = spawn(npmCommand, npmArgs, {
    // Keep output visible while capturing it so port conflicts can be handled.
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, ...state.env },
    shell: !npmCli && process.platform === 'win32',
  });

  state.child = child;
  state.startedAt = Date.now();
  state.portConflict = false;

  for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]]) {
    if (!stream) continue;
    const output = createInterface({ input: stream });
    output.on('line', (line) => {
      if (line.includes('EADDRINUSE')) state.portConflict = true;
      if (state.name === 'Web' && line.includes('Another next dev server is already running.')) {
        state.existingServer = true;
      }
      (isError ? console.error : console.log)(`[${state.name}] ${line}`);
    });
  }

  child.on('error', (error) => {
    console.error(`[${state.name}] could not start: ${error.message}`);
  });

  child.on('close', (code, signal) => {
    if (state.child === child) state.child = null;
    if (stopping) return;

    if (state.existingServer) {
      state.existingServer = false;
      console.error('[Web] Next.js reports another dev server for this project. Stopping the duplicate launcher; use the server URL printed above.');
      return;
    }

    if (state.portConflict) {
      void isExistingCrmService(state).then((isRunning) => {
        if (stopping) return;
        if (isRunning) {
          console.log(`[${state.name}] an existing CRM service is responding on required port ${state.port}; reusing it.`);
          state.existingServer = false;
          return;
        }
        clearPortOwners(state.port);
        console.warn(`[${state.name}] port ${state.port} is occupied by a non-CRM listener. Clearing it and retrying on the required port.`);
        state.restartTimer = setTimeout(() => {
          state.restartTimer = null;
          launch(state);
        }, 1500);
      });
      return;
    }

    const livedMs = Date.now() - state.startedAt;
    if (livedMs >= 30_000) state.restartDelayMs = 1000;

    console.error(`[${state.name}] exited (code ${code ?? 'none'}, signal ${signal ?? 'none'}); restarting in ${state.restartDelayMs / 1000}s.`);
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;
      state.restartDelayMs = Math.min(state.restartDelayMs * 2, 30_000);
      launch(state);
    }, state.restartDelayMs);
  });
}

function stopChildTree(child) {
  if (!child?.pid) return Promise.resolve();

  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    return new Promise((resolve) => child.once('exit', resolve));
  }

  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    killer.once('error', () => {
      child.kill('SIGTERM');
      resolve();
    });
    killer.once('exit', () => resolve());
  });
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping LeadPilot web and API...');

  const activeChildren = [];
  for (const state of states.values()) {
    if (state.restartTimer) clearTimeout(state.restartTimer);
    state.restartTimer = null;
    if (state.child) activeChildren.push(stopChildTree(state.child));
  }

  await Promise.all(activeChildren);
  try {
    if (Number(readFileSync(supervisorLock, 'utf8').trim()) === process.pid) unlinkSync(supervisorLock);
  } catch { /* lock may already have been cleaned up */ }
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

for (const state of states.values()) launch(state);
