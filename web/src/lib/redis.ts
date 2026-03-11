import type { ConnectionOptions } from 'bullmq';

const globalForRedis = globalThis as unknown as {
  bullConnectionOptions?: ConnectionOptions;
};

function buildRedisConnectionOptions(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const url = new URL(redisUrl);
  const useTls = url.protocol === 'rediss:';
  const db = url.pathname ? Number(url.pathname.slice(1)) || 0 : 0;

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : useTls ? 6380 : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db,
    maxRetriesPerRequest: null,
    ...(useTls ? { tls: {} } : {}),
  };
}

export function getRedisConnectionOptions(): ConnectionOptions {
  if (!globalForRedis.bullConnectionOptions) {
    globalForRedis.bullConnectionOptions = buildRedisConnectionOptions();
  }

  return globalForRedis.bullConnectionOptions;
}
