import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  { name: 'API', args: ['run', 'api:dev'], env: { API_PORT: process.env.API_PORT || '4000' } },
  {
    name: 'Web',
    args: ['run', 'dev:web'],
    env: {
      PORT: process.env.WEB_PORT || '3000',
      API_PROXY_URL: process.env.API_PROXY_URL || 'http://127.0.0.1:4000/api/v1',
    },
  },
].map(({ name, args, env }) => {
  const child = spawn(npmCommand, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });

  child.on('error', (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code) => {
    if (!shuttingDown) shutdown(code ?? 1);
  });

  return child;
});

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('error', () => child.kill('SIGTERM'));
    } else {
      child.kill('SIGTERM');
    }
  }

  const forceExit = setTimeout(() => process.exit(exitCode), 3000);
  forceExit.unref();
  Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
  }))).then(() => process.exit(exitCode));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
