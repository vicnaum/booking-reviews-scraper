import * as path from 'node:path';
import { createJsonlFileLogger } from '@cli/logging/jsonl.js';

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
  flush(): Promise<void>;
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
      async flush() {},
    };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(
    buildLogDir(),
    `${timestamp}-${options.kind}-${logId}.jsonl`,
  );
  const logger = createJsonlFileLogger({
    filePath,
    onError(message) {
      console.error(`[search-log] failed to append row: ${message}`);
    },
  });

  const write = (event: string, data: Record<string, unknown> = {}) => {
    const row: SearchLogEvent = {
      ts: new Date().toISOString(),
      kind: options.kind,
      label: options.label,
      logId,
      event,
      ...data,
    };
    logger.write(row);
  };

  write('started', options.payload);

  return {
    logId,
    filePath: logger.filePath,
    log: write,
    flush: () => logger.flush(),
  };
}
