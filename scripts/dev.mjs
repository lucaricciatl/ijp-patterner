import { spawn } from 'node:child_process';
import process from 'node:process';

const VITE_PORT = 5273;

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const electronBin = process.platform === 'win32'
  ? 'node_modules/.bin/electron.cmd'
  : 'node_modules/.bin/electron';

const vite = spawn(npx, ['vite', '--port', String(VITE_PORT), '--strictPort'], {
  stdio: ['inherit', 'pipe', 'inherit'],
  shell: process.platform === 'win32',
});

let started = false;

vite.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!started && /Local:\s+http:\/\/localhost:(\d+)/.test(text)) {
    started = true;
    const url = `http://localhost:${VITE_PORT}`;
    const child = spawn(electronBin, ['.'], {
      stdio: 'inherit',
      env: { ...process.env, VITE_DEV_SERVER_URL: url },
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => {
      vite.kill();
      process.exit(code ?? 0);
    });
  }
});

vite.on('exit', (code) => {
  if (!started) process.exit(code ?? 1);
});

const shutdown = () => {
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
