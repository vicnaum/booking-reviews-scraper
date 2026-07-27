'use strict';

/* eslint-disable @typescript-eslint/no-require-imports -- Node postinstall verifier */

const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const webRequire = createRequire(path.join(__dirname, '..', 'package.json'));

function verifyDependencyOverrides() {
  const minimatchPackagePath = webRequire.resolve('minimatch/package.json');
  const requireFromMinimatch = createRequire(minimatchPackagePath);
  const braceExpansion = requireFromMinimatch('brace-expansion');
  const minimatch = webRequire('minimatch');

  assert.equal(
    typeof braceExpansion.expand,
    'function',
    'minimatch must resolve the brace-expansion v5 API',
  );
  assert.equal(
    minimatch('src/a.ts', 'src/{a,b}.ts'),
    true,
    'patched minimatch must preserve ESLint brace globs',
  );
  assert.deepEqual(minimatch.braceExpand('src/{a,b}.ts'), [
    'src/a.ts',
    'src/b.ts',
  ]);
}

if (require.main === module) {
  verifyDependencyOverrides();
  console.log('Dependency override verification passed');
}

module.exports = { verifyDependencyOverrides };
