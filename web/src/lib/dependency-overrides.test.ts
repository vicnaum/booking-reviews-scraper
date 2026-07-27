import { createRequire } from 'node:module';
import test from 'node:test';

const webRequire = createRequire(__filename);
const { verifyDependencyOverrides } = webRequire(
  '../../scripts/verify-dependency-overrides.cjs',
) as {
  verifyDependencyOverrides: () => void;
};

test('patched ESLint minimatch supports brace-expansion v5', () => {
  verifyDependencyOverrides();
});
