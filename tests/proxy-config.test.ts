import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyProxyToEnv,
  buildProxyUrl,
  parseProxyUrl,
  resolveProxy,
  resolveProxyProtocol,
} from '../src/config.js';

const PROXY_ENV_KEYS = [
  'USE_PROXY',
  'PROXY_PROTOCOL',
  'PROXY_HOST',
  'PROXY_PORT',
  'PROXY_USERNAME',
  'PROXY_PASSWORD',
] as const;

function withProxyEnv(
  values: Partial<Record<(typeof PROXY_ENV_KEYS)[number], string | undefined>>,
  callback: () => void,
): void {
  const previous = Object.fromEntries(
    PROXY_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  try {
    for (const key of PROXY_ENV_KEYS) {
      const value = values[key];
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    callback();
  } finally {
    for (const key of PROXY_ENV_KEYS) {
      const value = previous[key];
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('proxy protocol defaults to HTTP and accepts normalized TLS syntax', () => {
  assert.equal(resolveProxyProtocol(undefined), 'http');
  assert.equal(resolveProxyProtocol('HTTPS:'), 'https');
  assert.throws(() => resolveProxyProtocol('socks5'), /must be "http" or "https"/);
});

test('proxy URLs preserve TLS and safely round-trip credential delimiters', () => {
  const parsed = parseProxyUrl(
    'https://user%40example:p%3Aass%40word@proxy.example:1001',
  );
  assert.deepEqual(parsed, {
    protocol: 'https',
    host: 'proxy.example',
    port: 1001,
    username: 'user@example',
    password: 'p:ass@word',
  });
  assert.equal(
    buildProxyUrl(parsed),
    'https://user%40example:p%3Aass%40word@proxy.example:1001',
  );

  const cliResolved = resolveProxy(
    'https://user%40example:p%3Aass%40word@proxy.example:1001',
  );
  assert.equal(cliResolved.source, 'cli');
  assert.equal(cliResolved.proxyConfig?.protocol, 'https');
  assert.equal(
    cliResolved.proxyUrl,
    'https://user%40example:p%3Aass%40word@proxy.example:1001',
  );
  assert.throws(() => parseProxyUrl('socks5://proxy.example:1080'), /Invalid proxy URL/);
});

test('environment resolution honors TLS and remains backward-compatible without a protocol', () => {
  withProxyEnv({
    USE_PROXY: 'true',
    PROXY_PROTOCOL: 'https',
    PROXY_HOST: 'proxy.example',
    PROXY_PORT: '1001',
    PROXY_USERNAME: 'user',
    PROXY_PASSWORD: 'pass',
  }, () => {
    const resolved = resolveProxy();
    assert.equal(resolved.source, 'env');
    assert.equal(resolved.proxyConfig?.protocol, 'https');
    assert.equal(resolved.proxyUrl, 'https://user:pass@proxy.example:1001');
  });

  withProxyEnv({
    USE_PROXY: 'true',
    PROXY_HOST: 'proxy.example',
    PROXY_PORT: '1000',
    PROXY_USERNAME: 'user',
    PROXY_PASSWORD: 'pass',
  }, () => {
    const resolved = resolveProxy();
    assert.equal(resolved.proxyConfig?.protocol, 'http');
    assert.equal(resolved.proxyUrl, 'http://user:pass@proxy.example:1000');
  });
});

test('applying a resolved proxy propagates the protocol to runtime scrapers', () => {
  withProxyEnv({}, () => {
    applyProxyToEnv({
      useProxy: true,
      proxyUrl: 'https://user:pass@proxy.example:1001',
      proxyConfig: {
        protocol: 'https',
        host: 'proxy.example',
        port: 1001,
        username: 'user',
        password: 'pass',
      },
      source: 'cli',
    });

    assert.equal(process.env.PROXY_PROTOCOL, 'https');
    assert.equal(process.env.PROXY_PORT, '1001');
  });
});

test('PROXY_COUNTRY and proxy sessions are appended to the proxy password', async () => {
  const { getProxyPasswordFromEnv, buildPlaywrightLaunchOptionsFromEnv } = await import('../src/config.js');
  const previous = { ...process.env };
  try {
    process.env.PROXY_HOST = 'proxy.example';
    process.env.PROXY_PORT = '1000';
    process.env.PROXY_USERNAME = 'user';
    process.env.PROXY_PASSWORD = 'secret';
    process.env.USE_PROXY = 'true';
    delete process.env.PROXY_COUNTRY;
    assert.equal(getProxyPasswordFromEnv(), 'secret');
    process.env.PROXY_COUNTRY = 'pl';
    assert.equal(getProxyPasswordFromEnv(), 'secret_country-PL');
    assert.equal(getProxyPasswordFromEnv('ab12'), 'secret_country-PL_session-ab12');
    const launch = buildPlaywrightLaunchOptionsFromEnv({ proxySession: 'xy' }) as any;
    assert.equal(launch.proxy.password, 'secret_country-PL_session-xy');
    process.env.PROXY_PASSWORD = 'secret_country-DE';
    assert.equal(getProxyPasswordFromEnv(), 'secret_country-DE');
  } finally {
    for (const key of ['PROXY_HOST', 'PROXY_PORT', 'PROXY_USERNAME', 'PROXY_PASSWORD', 'USE_PROXY', 'PROXY_COUNTRY']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
