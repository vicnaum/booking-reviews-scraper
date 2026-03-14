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
