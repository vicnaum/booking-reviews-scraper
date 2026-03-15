import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';

export interface JsonlFileLogger {
  readonly filePath: string | null;
  write(row: Record<string, unknown>): void;
  flush(): Promise<void>;
}

interface CreateJsonlFileLoggerOptions {
  filePath: string | null;
  onError(message: string): void;
}

export function createJsonlFileLogger(
  options: CreateJsonlFileLoggerOptions,
): JsonlFileLogger {
  const { filePath, onError } = options;

  if (!filePath) {
    return {
      filePath: null,
      write() {},
      async flush() {},
    };
  }

  let enabled = true;
  let queue: Promise<void> = mkdir(path.dirname(filePath), { recursive: true }).then(() => {});

  return {
    filePath,
    write(row: Record<string, unknown>) {
      if (!enabled) {
        return;
      }

      queue = queue
        .catch(() => {})
        .then(() => appendFile(filePath, `${JSON.stringify(row)}\n`))
        .catch((error) => {
          enabled = false;
          const message = error instanceof Error ? error.message : String(error);
          onError(message);
        });
    },
    async flush() {
      await queue.catch(() => {});
    },
  };
}
