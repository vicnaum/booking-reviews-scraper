import * as fs from 'node:fs';
import * as path from 'node:path';

interface SearchLogEvent {
  event: string;
  [key: string]: unknown;
}

interface CreateSearchLoggerOptions {
  kind: 'quick-search' | 'review-job-search';
  label: string;
  payload?: Record<string, unknown>;
}

export interface SearchLogger {
  readonly logId: string;
  readonly filePath: string | null;
  log(event: string, data?: Record<string, unknown>): void;
}

function makeLogId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildLogDir(): string {
  return path.resolve(
    process.cwd(),
    process.env.STAYREVIEWR_SEARCH_LOG_DIR || path.join('data', 'search-logs'),
  );
}

export function createSearchLogger(
  options: CreateSearchLoggerOptions,
): SearchLogger {
  const logId = makeLogId();

  if (process.env.STAYREVIEWR_SEARCH_LOG === 'false') {
    return {
      logId,
      filePath: null,
      log() {},
    };
  }

  const dir = buildLogDir();
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(dir, `${timestamp}-${options.kind}-${logId}.jsonl`);
  let enabled = true;

  const write = (event: string, data: Record<string, unknown> = {}) => {
    if (!enabled) {
      return;
    }

    const row: SearchLogEvent = {
      ts: new Date().toISOString(),
      kind: options.kind,
      label: options.label,
      logId,
      event,
      ...data,
    };

    try {
      fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
    } catch (error) {
      enabled = false;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[search-log] failed to append ${event}: ${message}`);
    }
  };

  write('started', options.payload);

  return {
    logId,
    filePath,
    log: write,
  };
}
