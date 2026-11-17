import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';

const apiPort = Number(process.env.API_PORT || 4000);
const webPort = process.env.PORT || process.env.WEB_PORT || '3000';
const apiHost = '127.0.0.1';
const apiEntry = resolve('apps/api/dist/src/main.js');
const nextCli = resolve('node_modules/next/dist/bin/next');
let stopping = false;
const children = new Set();

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, { stdio: 'inherit', env });
  children.add(child);
  child.once('error', (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(1);
  });
  child.once('exit', (code) => {
    children.delete(child);
    if (!stopping) {
      console.error(`[${name}] exited (${code ?? 'signal'}); stopping the service.`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

function canConnect(port) {
  return new Promise((resolveResult) => {
    const socket = createConnection({ host: apiHost, port });
    socket.once('connect', () => { socket.destroy(); resolveResult(true); });
    socket.once('error', () => resolveResult(false));
  });
}

async function waitForApi(child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('The API stopped before it began listening.');
    if (await canConnect(apiPort)) return;
    await delay(500);
  }
  throw new Error(`The API did not listen on port ${apiPort} within 90 seconds.`);
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const forceStop = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 8_000);
  forceStop.unref();
  Promise.all([...children].map((child) => new Promise((resolveExit) => {
    if (child.exitCode !== null) return resolveExit();
    child.once('exit', resolveExit);
  }))).finally(() => {
    clearTimeout(forceStop);
    process.exit(code);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  const api = start('API', process.execPath, [apiEntry], {
    ...process.env,
    API_PORT: String(apiPort),
    API_HOST: apiHost,
  });
  await waitForApi(api);
  start('Web', process.execPath, [nextCli, 'start', '--hostname', '0.0.0.0'], {
    ...process.env,
    PORT: String(webPort),
    API_PROXY_URL: process.env.API_PROXY_URL || `http://${apiHost}:${apiPort}/api/v1`,
  });
} catch (error) {
  console.error(`[startup] ${error instanceof Error ? error.message : 'Unable to start the CRM.'}`);
  shutdown(1);
}
