import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const upScriptPath = path.resolve('scripts/up.mjs');
const webPackagePath = path.resolve('web/package.json');
const upScript = fs.readFileSync(upScriptPath, 'utf-8');
const webPackage = JSON.parse(fs.readFileSync(webPackagePath, 'utf-8')) as {
  scripts: Record<string, string>;
};

test('one-command startup uses a stable worker while development watch stays opt-in', () => {
  assert.match(upScript, /'npm --prefix web run worker',/);
  assert.doesNotMatch(upScript, /'npm --prefix web run worker:dev',/);

  assert.equal(
    webPackage.scripts.worker,
    'dotenv -e ../.env -e .env.local -- tsx src/lib/search-worker.ts',
  );
  assert.doesNotMatch(webPackage.scripts.worker, /\bwatch\b/);
  assert.match(webPackage.scripts['worker:dev'], /\btsx watch\b/);
});
