#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'web');
const envPath = path.join(repoRoot, '.env');

const defaultDatabaseUrl =
  'postgresql://postgres:postgres@127.0.0.1:5432/stayreviewr?schema=public';
const defaultRedisUrl = 'redis://127.0.0.1:6379';

process.chdir(repoRoot);

function fail(message) {
  console.error(`\nStayReviewr startup failed: ${message}`);
  process.exit(1);
}

function commandWorks(command, args = ['--version']) {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0;
}

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    fail(`${command} could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}

if (!existsSync(envPath)) {
  fail('missing .env; copy .env.example to .env and fill in the required values');
}

if (!commandWorks('docker')) {
  fail('Docker is not installed or is not available on PATH');
}
if (!commandWorks('docker', ['compose', 'version'])) {
  fail('Docker Compose is not available');
}
if (!commandWorks('docker', ['info'])) {
  fail('the Docker daemon is not running; start Docker Desktop or OrbStack and retry');
}

let pnpmCommand = 'pnpm';
let pnpmPrefix = [];
if (!commandWorks('pnpm')) {
  if (!commandWorks('corepack')) {
    fail('pnpm is required; install pnpm or enable Corepack and retry');
  }
  pnpmCommand = 'corepack';
  pnpmPrefix = ['pnpm'];
}

const rootDependenciesMissing = [
  path.join(repoRoot, 'node_modules', '.bin', 'concurrently'),
  path.join(repoRoot, 'node_modules', 'dotenv', 'package.json'),
  path.join(repoRoot, 'node_modules', 'playwright', 'package.json'),
].some((dependency) => !existsSync(dependency));
const webDependenciesMissing = [
  path.join(webRoot, 'node_modules', '.bin', 'next'),
  path.join(webRoot, 'node_modules', '.bin', 'prisma'),
  path.join(webRoot, 'node_modules', '.bin', 'tsx'),
].some((dependency) => !existsSync(dependency));

if (rootDependenciesMissing) {
  console.log('\nRoot dependencies are missing; installing them with pnpm.');
  run(pnpmCommand, [...pnpmPrefix, 'install', '--frozen-lockfile']);
}

if (webDependenciesMissing) {
  console.log('\nWeb dependencies are missing; installing them with npm.');
  run('npm', ['ci', '--prefix', 'web']);
}

const { chromium } = await import('playwright');
if (!existsSync(chromium.executablePath())) {
  console.log('\nPlaywright Chromium is missing; installing it for Booking.com jobs.');
  run(pnpmCommand, [...pnpmPrefix, 'exec', 'playwright', 'install', 'chromium']);
}

const { config: loadEnv } = await import('dotenv');
const envResult = loadEnv({ path: envPath, quiet: true });
if (envResult.error) {
  fail(`could not read .env: ${envResult.error.message}`);
}

const runtimeEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || defaultDatabaseUrl,
  REDIS_URL: process.env.REDIS_URL || defaultRedisUrl,
};

console.log('\nStarting Postgres and Redis.');
run(
  'docker',
  [
    'compose',
    '-f',
    'web/docker-compose.yml',
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '90',
  ],
  { env: runtimeEnv },
);

console.log('\nSynchronizing the Prisma schema.');
run('npm', ['--prefix', 'web', 'run', 'db:push'], { env: runtimeEnv });

console.log('\nStayReviewr is starting at http://localhost:3000');
console.log('Postgres and Redis remain running after Ctrl-C; use npm run down to stop them.\n');

const stack = spawn(
  path.join(repoRoot, 'node_modules', '.bin', 'concurrently'),
  [
    '--kill-others',
    '--kill-timeout',
    '10000',
    '--success',
    'first',
    '--names',
    'web,worker',
    '--no-color',
    'npm --prefix web run dev',
    'npm --prefix web run worker:dev',
  ],
  {
    cwd: repoRoot,
    env: runtimeEnv,
    stdio: 'inherit',
  },
);

stack.on('error', (error) => {
  fail(`web/worker supervisor could not be started: ${error.message}`);
});

const { code, signal } = await new Promise((resolve) => {
  stack.on('exit', (exitCode, exitSignal) => {
    resolve({ code: exitCode, signal: exitSignal });
  });
});

if (signal) {
  process.exitCode = signal === 'SIGINT' ? 130 : 1;
} else {
  process.exitCode = code ?? 1;
}
