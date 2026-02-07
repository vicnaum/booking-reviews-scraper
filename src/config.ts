// src/config.ts
//
// Proxy auth resolution & persistence for reviewr CLI
// Priority: CLI flag → env vars / local .env → ~/.config/reviewr/.env → none

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'reviewr');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), '.env');
}

/**
 * Parse a proxy URL like http://user:pass@host:port into components
 */
export function parseProxyUrl(url: string): ProxyConfig {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 0,
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
  } catch {
    throw new Error(`Invalid proxy URL: ${url}`);
  }
}

/**
 * Save proxy config to ~/.config/reviewr/.env
 */
export function saveProxy(proxyUrl: string): void {
  const config = parseProxyUrl(proxyUrl);
  const configDir = getConfigDir();

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const envContent = [
    'USE_PROXY=true',
    `PROXY_HOST=${config.host}`,
    `PROXY_PORT=${config.port}`,
    `PROXY_USERNAME=${config.username}`,
    `PROXY_PASSWORD=${config.password}`,
  ].join('\n') + '\n';

  fs.writeFileSync(getConfigPath(), envContent, 'utf-8');
  console.log(`Proxy config saved to ${getConfigPath()}`);
}

/**
 * Load env vars from a .env file (simple key=value parser)
 */
function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};

  const content = fs.readFileSync(filePath, 'utf-8');
  const vars: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }

  return vars;
}

export interface ResolvedProxy {
  useProxy: boolean;
  proxyUrl: string | null;
  proxyConfig: ProxyConfig | null;
  source: 'cli' | 'env' | 'local-env' | 'global-config' | 'none';
}

/**
 * Resolve proxy config from multiple sources (priority order):
 * 1. CLI --proxy flag
 * 2. Environment variables (PROXY_HOST etc.)
 * 3. Local .env file
 * 4. Global config (~/.config/reviewr/.env)
 * 5. No proxy
 */
export function resolveProxy(cliProxyUrl?: string): ResolvedProxy {
  // 1. CLI flag
  if (cliProxyUrl) {
    const config = parseProxyUrl(cliProxyUrl);
    const url = `http://${config.username}:${config.password}@${config.host}:${config.port}`;
    return { useProxy: true, proxyUrl: url, proxyConfig: config, source: 'cli' };
  }

  // 2. Environment variables (already loaded by dotenv or shell)
  if (process.env.PROXY_HOST && process.env.PROXY_HOST !== '') {
    const config: ProxyConfig = {
      host: process.env.PROXY_HOST,
      port: parseInt(process.env.PROXY_PORT || '0'),
      username: process.env.PROXY_USERNAME || '',
      password: process.env.PROXY_PASSWORD || '',
    };
    const useProxy = process.env.USE_PROXY !== 'false';
    if (useProxy) {
      const url = `http://${config.username}:${config.password}@${config.host}:${config.port}`;
      return { useProxy: true, proxyUrl: url, proxyConfig: config, source: 'env' };
    }
  }

  // 3. Local .env file
  const localEnv = loadEnvFile('.env');
  if (localEnv.PROXY_HOST) {
    const config: ProxyConfig = {
      host: localEnv.PROXY_HOST,
      port: parseInt(localEnv.PROXY_PORT || '0'),
      username: localEnv.PROXY_USERNAME || '',
      password: localEnv.PROXY_PASSWORD || '',
    };
    const useProxy = localEnv.USE_PROXY !== 'false';
    if (useProxy) {
      const url = `http://${config.username}:${config.password}@${config.host}:${config.port}`;
      return { useProxy: true, proxyUrl: url, proxyConfig: config, source: 'local-env' };
    }
  }

  // 4. Global config
  const globalEnv = loadEnvFile(getConfigPath());
  if (globalEnv.PROXY_HOST) {
    const config: ProxyConfig = {
      host: globalEnv.PROXY_HOST,
      port: parseInt(globalEnv.PROXY_PORT || '0'),
      username: globalEnv.PROXY_USERNAME || '',
      password: globalEnv.PROXY_PASSWORD || '',
    };
    const useProxy = globalEnv.USE_PROXY !== 'false';
    if (useProxy) {
      const url = `http://${config.username}:${config.password}@${config.host}:${config.port}`;
      return { useProxy: true, proxyUrl: url, proxyConfig: config, source: 'global-config' };
    }
  }

  // 5. No proxy
  return { useProxy: false, proxyUrl: null, proxyConfig: null, source: 'none' };
}

/**
 * Show current proxy auth status
 */
export function showAuthStatus(): void {
  const resolved = resolveProxy();

  console.log('Proxy configuration status:\n');

  if (!resolved.useProxy) {
    console.log('  Status: No proxy configured');
    console.log('');
    console.log('  To configure a proxy:');
    console.log('    reviewr auth http://user:pass@host:port');
    return;
  }

  const sourceLabels: Record<string, string> = {
    'cli': 'CLI flag (--proxy)',
    'env': 'Environment variables',
    'local-env': 'Local .env file',
    'global-config': `Global config (${getConfigPath()})`,
  };

  console.log(`  Status: Proxy configured`);
  console.log(`  Source: ${sourceLabels[resolved.source] || resolved.source}`);
  console.log(`  Host: ${resolved.proxyConfig!.host}:${resolved.proxyConfig!.port}`);
  console.log(`  User: ${resolved.proxyConfig!.username}`);
}

/**
 * Apply resolved proxy config to process.env so existing scripts pick it up
 */
export function applyProxyToEnv(resolved: ResolvedProxy): void {
  if (resolved.useProxy && resolved.proxyConfig) {
    process.env.USE_PROXY = 'true';
    process.env.PROXY_HOST = resolved.proxyConfig.host;
    process.env.PROXY_PORT = String(resolved.proxyConfig.port);
    process.env.PROXY_USERNAME = resolved.proxyConfig.username;
    process.env.PROXY_PASSWORD = resolved.proxyConfig.password;
  } else {
    process.env.USE_PROXY = 'false';
  }
}
