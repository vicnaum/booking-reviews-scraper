import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const ARTIFACT_CACHE_SCHEMA_VERSION = 1;
export const REVIEWR_CACHE_DIR_ENV = 'REVIEWR_CACHE_DIR';
export const CACHE_TTL_ENV = {
  details: 'REVIEWR_CACHE_DETAILS_TTL_DAYS',
  reviews: 'REVIEWR_CACHE_REVIEWS_TTL_DAYS',
  photos: 'REVIEWR_CACHE_PHOTOS_TTL_DAYS',
} as const;

export const DEFAULT_CACHE_TTL_DAYS = {
  details: 7,
  reviews: 30,
  photos: 180,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ScrapeArtifactKind = keyof typeof CACHE_TTL_ENV;
export type ScrapePlatform = 'airbnb' | 'booking';
export type CacheVariant = Record<string, string | number | boolean | null>;

export interface ArtifactCacheKey {
  platform: ScrapePlatform;
  listingId: string;
  artifact: ScrapeArtifactKind;
  variant?: CacheVariant;
}

export interface ArtifactCachePolicy {
  rootDir: string;
  ttlMs: Record<ScrapeArtifactKind, number>;
}

export interface ArtifactCacheMetadata {
  schemaVersion: number;
  keyHash: string;
  platform: ScrapePlatform;
  listingId: string;
  artifact: ScrapeArtifactKind;
  variant: CacheVariant;
  payloadType: 'file' | 'directory';
  cachedAt: string;
  count?: number;
  expected?: number;
}

export interface ArtifactCacheHit {
  cachedAt: string;
  ageMs: number;
  count?: number;
  expected?: number;
}

export interface ArtifactCachePublishOptions {
  count?: number;
  expected?: number;
}

export function buildDetailsCacheVariant(input: {
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  linkedRoomId?: string | null;
}): CacheVariant {
  return {
    checkIn: input.checkIn ?? null,
    checkOut: input.checkOut ?? null,
    adults: input.adults ?? null,
    linkedRoomId: input.linkedRoomId ?? null,
  };
}

export function buildPhotosCacheVariant(input: {
  platform: ScrapePlatform;
  downloadAll?: boolean;
  linkedRoomId?: string | null;
}): CacheVariant {
  if (input.platform === 'airbnb') {
    return { selection: 'all' };
  }

  const usesAllPhotos = input.downloadAll || !input.linkedRoomId;
  return {
    selection: usesAllPhotos ? 'all' : 'linked-room',
    linkedRoomId: usesAllPhotos ? null : input.linkedRoomId ?? null,
  };
}

function parseTtlDays(
  env: NodeJS.ProcessEnv,
  artifact: ScrapeArtifactKind,
): number {
  const envName = CACHE_TTL_ENV[artifact];
  const rawValue = env[envName]?.trim();
  if (!rawValue) {
    return DEFAULT_CACHE_TTL_DAYS[artifact];
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${envName} must be a non-negative number; received "${rawValue}"`);
  }

  return parsed;
}

function resolveConfiguredRoot(rawValue: string | undefined): string {
  if (!rawValue) {
    return path.join(os.homedir(), '.cache', 'reviewr', 'artifacts-v1');
  }

  if (rawValue === '~') {
    return os.homedir();
  }
  if (rawValue.startsWith(`~${path.sep}`) || rawValue.startsWith('~/')) {
    return path.join(os.homedir(), rawValue.slice(2));
  }

  return path.resolve(rawValue);
}

export function resolveArtifactCachePolicy(
  env: NodeJS.ProcessEnv = process.env,
  rootDir?: string,
): ArtifactCachePolicy {
  return {
    rootDir: resolveConfiguredRoot(rootDir ?? env[REVIEWR_CACHE_DIR_ENV]),
    ttlMs: {
      details: parseTtlDays(env, 'details') * DAY_MS,
      reviews: parseTtlDays(env, 'reviews') * DAY_MS,
      photos: parseTtlDays(env, 'photos') * DAY_MS,
    },
  };
}

function canonicalVariant(variant: CacheVariant | undefined): CacheVariant {
  return Object.fromEntries(
    Object.entries(variant ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getKeyHash(key: ArtifactCacheKey): string {
  return hashValue(JSON.stringify({
    schemaVersion: ARTIFACT_CACHE_SCHEMA_VERSION,
    platform: key.platform,
    listingId: key.listingId,
    artifact: key.artifact,
    variant: canonicalVariant(key.variant),
  }));
}

function sanitizePathSegment(value: string): string {
  const readable = value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'listing';
  return `${readable}-${hashValue(value).slice(0, 12)}`;
}

function uniqueSuffix(): string {
  return `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function copyFile(sourcePath: string, destinationPath: string): void {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_FICLONE);
}

function replaceDirectory(sourcePath: string, destinationPath: string): void {
  const parentDir = path.dirname(destinationPath);
  fs.mkdirSync(parentDir, { recursive: true });
  const stagedPath = path.join(
    parentDir,
    `.${path.basename(destinationPath)}.cache-${uniqueSuffix()}`,
  );

  try {
    fs.cpSync(sourcePath, stagedPath, {
      recursive: true,
      force: true,
      dereference: true,
      preserveTimestamps: true,
    });
    fs.rmSync(destinationPath, { recursive: true, force: true });
    fs.renameSync(stagedPath, destinationPath);
  } finally {
    fs.rmSync(stagedPath, { recursive: true, force: true });
  }
}

function replaceEntryDirectory(stagedPath: string, entryPath: string): void {
  const backupPath = `${entryPath}.old-${uniqueSuffix()}`;
  const hadExistingEntry = fs.existsSync(entryPath);

  if (hadExistingEntry) {
    fs.renameSync(entryPath, backupPath);
  }

  try {
    fs.renameSync(stagedPath, entryPath);
    fs.rmSync(backupPath, { recursive: true, force: true });
  } catch (error) {
    if (hadExistingEntry && !fs.existsSync(entryPath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, entryPath);
    }
    throw error;
  }
}

export class ArtifactCache {
  constructor(
    readonly policy: ArtifactCachePolicy,
    private readonly now: () => number = Date.now,
  ) {}

  getEntryPath(key: ArtifactCacheKey): string {
    if (!key.listingId.trim()) {
      throw new Error('Artifact cache listingId must not be empty');
    }

    return path.join(
      this.policy.rootDir,
      key.platform,
      sanitizePathSegment(key.listingId),
      key.artifact,
      getKeyHash(key),
    );
  }

  invalidate(key: ArtifactCacheKey): void {
    fs.rmSync(this.getEntryPath(key), { recursive: true, force: true });
  }

  restoreFile(key: ArtifactCacheKey, destinationPath: string): ArtifactCacheHit | null {
    const validEntry = this.readValidEntry(key, 'file');
    if (!validEntry) {
      return null;
    }

    const tempPath = `${destinationPath}.cache-${uniqueSuffix()}`;
    try {
      copyFile(path.join(validEntry.entryPath, 'payload.json'), tempPath);
      fs.renameSync(tempPath, destinationPath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }

    return validEntry.hit;
  }

  restoreDirectory(
    key: ArtifactCacheKey,
    destinationPath: string,
  ): ArtifactCacheHit | null {
    const validEntry = this.readValidEntry(key, 'directory');
    if (!validEntry) {
      return null;
    }

    replaceDirectory(path.join(validEntry.entryPath, 'payload'), destinationPath);
    return validEntry.hit;
  }

  publishFile(
    key: ArtifactCacheKey,
    sourcePath: string,
    options: ArtifactCachePublishOptions = {},
  ): ArtifactCacheMetadata | null {
    if (this.policy.ttlMs[key.artifact] === 0) {
      return null;
    }
    if (!fs.statSync(sourcePath).isFile()) {
      throw new Error(`Artifact cache source is not a file: ${sourcePath}`);
    }

    return this.publish(key, 'file', options, (stagedPath) => {
      copyFile(sourcePath, path.join(stagedPath, 'payload.json'));
    });
  }

  publishDirectory(
    key: ArtifactCacheKey,
    sourcePath: string,
    options: ArtifactCachePublishOptions = {},
  ): ArtifactCacheMetadata | null {
    if (this.policy.ttlMs[key.artifact] === 0) {
      return null;
    }
    if (!fs.statSync(sourcePath).isDirectory()) {
      throw new Error(`Artifact cache source is not a directory: ${sourcePath}`);
    }

    return this.publish(key, 'directory', options, (stagedPath) => {
      fs.cpSync(sourcePath, path.join(stagedPath, 'payload'), {
        recursive: true,
        force: true,
        dereference: true,
        preserveTimestamps: true,
      });
    });
  }

  private publish(
    key: ArtifactCacheKey,
    payloadType: ArtifactCacheMetadata['payloadType'],
    options: ArtifactCachePublishOptions,
    writePayload: (stagedPath: string) => void,
  ): ArtifactCacheMetadata {
    const entryPath = this.getEntryPath(key);
    const parentDir = path.dirname(entryPath);
    fs.mkdirSync(parentDir, { recursive: true });
    const stagedPath = fs.mkdtempSync(path.join(parentDir, '.staging-'));
    const metadata: ArtifactCacheMetadata = {
      schemaVersion: ARTIFACT_CACHE_SCHEMA_VERSION,
      keyHash: getKeyHash(key),
      platform: key.platform,
      listingId: key.listingId,
      artifact: key.artifact,
      variant: canonicalVariant(key.variant),
      payloadType,
      cachedAt: new Date(this.now()).toISOString(),
      count: options.count,
      expected: options.expected,
    };

    try {
      writePayload(stagedPath);
      fs.writeFileSync(
        path.join(stagedPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
      );
      replaceEntryDirectory(stagedPath, entryPath);
      return metadata;
    } finally {
      fs.rmSync(stagedPath, { recursive: true, force: true });
    }
  }

  private readValidEntry(
    key: ArtifactCacheKey,
    payloadType: ArtifactCacheMetadata['payloadType'],
  ): { entryPath: string; hit: ArtifactCacheHit } | null {
    if (this.policy.ttlMs[key.artifact] === 0) {
      return null;
    }

    const entryPath = this.getEntryPath(key);
    const metadataPath = path.join(entryPath, 'metadata.json');
    const payloadPath = path.join(
      entryPath,
      payloadType === 'file' ? 'payload.json' : 'payload',
    );

    try {
      const metadata = JSON.parse(
        fs.readFileSync(metadataPath, 'utf-8'),
      ) as ArtifactCacheMetadata;
      const cachedAtMs = Date.parse(metadata.cachedAt);
      const ageMs = Math.max(0, this.now() - cachedAtMs);
      const payloadStat = fs.statSync(payloadPath);
      const validPayload =
        payloadType === 'file' ? payloadStat.isFile() : payloadStat.isDirectory();
      const validMetadata =
        metadata.schemaVersion === ARTIFACT_CACHE_SCHEMA_VERSION
        && metadata.keyHash === getKeyHash(key)
        && metadata.platform === key.platform
        && metadata.listingId === key.listingId
        && metadata.artifact === key.artifact
        && metadata.payloadType === payloadType
        && Number.isFinite(cachedAtMs);

      if (!validMetadata || !validPayload || ageMs > this.policy.ttlMs[key.artifact]) {
        fs.rmSync(entryPath, { recursive: true, force: true });
        return null;
      }

      return {
        entryPath,
        hit: {
          cachedAt: metadata.cachedAt,
          ageMs,
          count: metadata.count,
          expected: metadata.expected,
        },
      };
    } catch {
      fs.rmSync(entryPath, { recursive: true, force: true });
      return null;
    }
  }
}

export function createArtifactCache(options: {
  env?: NodeJS.ProcessEnv;
  rootDir?: string;
  now?: () => number;
} = {}): ArtifactCache {
  return new ArtifactCache(
    resolveArtifactCachePolicy(options.env, options.rootDir),
    options.now,
  );
}
