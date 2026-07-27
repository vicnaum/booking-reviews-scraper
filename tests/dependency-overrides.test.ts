import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const projectRequire = createRequire(__filename);

test('patched ESLint minimatch supports brace-expansion v5', () => {
  const eslintPackagePath = projectRequire.resolve('eslint/package.json');
  const requireFromEslint = createRequire(eslintPackagePath);
  const minimatch = requireFromEslint('minimatch') as {
    (value: string, pattern: string): boolean;
    braceExpand(pattern: string): string[];
  };

  assert.equal(minimatch('src/a.ts', 'src/{a,b}.ts'), true);
  assert.deepEqual(minimatch.braceExpand('src/{a,b}.ts'), [
    'src/a.ts',
    'src/b.ts',
  ]);
});
