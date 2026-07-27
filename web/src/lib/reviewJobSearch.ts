export interface ReviewJobSearchPlatformFailure {
  platform: 'airbnb' | 'booking';
  message: string;
}

export interface ReviewJobSearchSummary {
  canPersistResults: boolean;
  completedEventLevel: 'info' | 'warning';
  completedEventMessage: string;
  failureMessage: string | null;
}

export type ReviewJobSearchPlatform = 'airbnb' | 'booking';
export type ReviewJobSearchStage =
  | 'starting'
  | 'searching'
  | 'completed'
  | 'failed';

export interface ReviewJobSearchProgressState {
  currentPhase: string;
  progress: number;
}

const PLATFORM_PROGRESS = {
  airbnb: {
    starting: 0.05,
    scanningBase: 0.05,
    scanningSpan: 0.4,
    completed: 0.48,
  },
  booking: {
    starting: 0.52,
    scanningBase: 0.55,
    scanningSpan: 0.4,
    completed: 0.95,
  },
} as const;

function boundedUnknownWorkProgress(
  base: number,
  span: number,
  completedUnits: number,
): number {
  const units = Math.max(0, completedUnits);
  // Exhaustive searches discover their own adaptive cells, so the final page
  // count is unknowable up front. This curve moves within the active platform
  // segment without ever claiming that the segment is complete.
  return base + span * (units / (units + 8));
}

export function getReviewJobSearchProgress(input: {
  platform: ReviewJobSearchPlatform;
  stage: ReviewJobSearchStage;
  platformPages?: number;
}): ReviewJobSearchProgressState {
  const segment = PLATFORM_PROGRESS[input.platform];

  if (input.stage === 'starting') {
    return {
      currentPhase:
        input.platform === 'booking'
          ? 'search:booking:bootstrap'
          : 'search:airbnb',
      progress: segment.starting,
    };
  }

  if (input.stage === 'completed' || input.stage === 'failed') {
    return {
      currentPhase: `search:${input.platform}:${input.stage}`,
      progress: segment.completed,
    };
  }

  return {
    currentPhase: `search:${input.platform}`,
    progress: Math.min(
      segment.completed - 0.001,
      boundedUnknownWorkProgress(
        segment.scanningBase,
        segment.scanningSpan,
        input.platformPages ?? 0,
      ),
    ),
  };
}

export function summarizeReviewJobSearchOutcome(input: {
  successfulPlatforms: Array<'airbnb' | 'booking'>;
  warnings: ReviewJobSearchPlatformFailure[];
}): ReviewJobSearchSummary {
  const { successfulPlatforms, warnings } = input;

  if (successfulPlatforms.length === 0) {
    if (warnings.length === 0) {
      return {
        canPersistResults: false,
        completedEventLevel: 'warning',
        completedEventMessage: 'Combined full search completed with no successful platforms',
        failureMessage: 'Combined full search finished without any successful platform search',
      };
    }

    return {
      canPersistResults: false,
      completedEventLevel: 'warning',
      completedEventMessage: 'Combined full search failed on every platform',
      failureMessage: warnings
        .map((warning) => `${warning.platform}: ${warning.message}`)
        .join('; '),
    };
  }

  if (warnings.length > 0) {
    return {
      canPersistResults: true,
      completedEventLevel: 'warning',
      completedEventMessage: 'Combined full search completed with warnings',
      failureMessage: null,
    };
  }

  return {
    canPersistResults: true,
    completedEventLevel: 'info',
    completedEventMessage: 'Combined full search completed',
    failureMessage: null,
  };
}
