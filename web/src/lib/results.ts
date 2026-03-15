import type { ReviewJobListing } from '@/types';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function getPhotoUrl(photo: unknown): string | null {
  if (typeof photo === 'string') {
    return photo;
  }

  const record = asRecord(photo);
  if (!record) {
    return null;
  }

  return asString(record.highresUrl) ?? asString(record.url);
}

export interface ParsedRequirement {
  requirement: string;
  type: string | null;
  status: string | null;
  confidence: string | null;
  note: string | null;
}

export interface ParsedTheme {
  title: string;
  description: string | null;
  frequency: string | null;
  severity: string | null;
  evidence: string[];
}

export interface ParsedPrioritySignal {
  priority: string;
  verdict: string | null;
  evidence: string | null;
}

export interface ParsedTriage {
  fitScore: number | null;
  tier: string | null;
  tierReason: string | null;
  summary: string | null;
  bedSetup: string | null;
  priceTotal: string | null;
  pricePerNight: string | null;
  valueAssessment: string | null;
  highlights: string[];
  concerns: string[];
  dealBreakers: string[];
  requirements: ParsedRequirement[];
  scores: Array<{ key: string; value: number }>;
}

export interface ParsedAiReviews {
  overallSentiment: string | null;
  trends: string | null;
  guestDemographics: string | null;
  summaryScore: number | null;
  summaryJustification: string | null;
  strengths: ParsedTheme[];
  weaknesses: ParsedTheme[];
  redFlags: ParsedTheme[];
  dealBreakers: ParsedTheme[];
  priorities: ParsedPrioritySignal[];
}

export interface ParsedAiPhotos {
  overallImpression: string | null;
  overallCleanliness: number | null;
  overallModernity: number | null;
  highlights: string[];
  concerns: string[];
  priorities: ParsedPrioritySignal[];
  listingAccuracyScore: number | null;
  listingAccuracyDiscrepancies: string[];
}

export interface ParsedDetails {
  description: string | null;
  address: string | null;
  checkIn: string | null;
  checkOut: string | null;
  amenities: string[];
  photos: string[];
}

export interface ListingResultsSnapshot {
  triage: ParsedTriage | null;
  aiReviews: ParsedAiReviews | null;
  aiPhotos: ParsedAiPhotos | null;
  details: ParsedDetails | null;
}

export function getTierRank(tier: string | null): number {
  switch (tier) {
    case 'top_pick':
      return 0;
    case 'shortlist':
      return 1;
    case 'consider':
      return 2;
    case 'unlikely':
      return 3;
    case 'no_go':
      return 4;
    default:
      return 5;
  }
}

export function formatPoiDistance(meters: number | null): string | null {
  if (meters == null || !Number.isFinite(meters)) {
    return null;
  }

  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

export function getListingResultsSnapshot(
  listing: ReviewJobListing,
): ListingResultsSnapshot {
  return {
    triage: parseTriage(listing),
    aiReviews: parseAiReviews(listing),
    aiPhotos: parseAiPhotos(listing),
    details: parseDetails(listing),
  };
}

function parseTriage(listing: ReviewJobListing): ParsedTriage | null {
  const triage = asRecord(listing.analysis?.triage);
  if (!triage) {
    return null;
  }

  const requirements = Array.isArray(triage.requirements)
    ? triage.requirements.map((item) => {
        const record = asRecord(item);
        return {
          requirement: asString(record?.requirement) ?? 'Requirement',
          type: asString(record?.type),
          status: asString(record?.status),
          confidence: asString(record?.confidence),
          note: asString(record?.note),
        };
      })
    : [];

  const scoreRecord = asRecord(triage.scores);
  const scores = scoreRecord
    ? Object.entries(scoreRecord)
        .map(([key, value]) => {
          const numeric = asNumber(value);
          return numeric == null ? null : { key, value: numeric };
        })
        .filter((item): item is { key: string; value: number } => item != null)
    : [];

  const price = asRecord(triage.price);

  return {
    fitScore: asNumber(triage.fitScore),
    tier: asString(triage.tier),
    tierReason: asString(triage.tierReason),
    summary: asString(triage.summary),
    bedSetup: asString(triage.bedSetup),
    priceTotal: asString(price?.total),
    pricePerNight: asString(price?.perNight),
    valueAssessment: asString(price?.valueAssessment),
    highlights: asStringArray(triage.highlights),
    concerns: asStringArray(triage.concerns),
    dealBreakers: asStringArray(triage.dealBreakers),
    requirements,
    scores,
  };
}

function parseThemeList(value: unknown, mode: 'theme' | 'issue'): ParsedTheme[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      return {
        title:
          asString(mode === 'theme' ? record.theme : record.issue)
          ?? asString(record.theme)
          ?? asString(record.issue)
          ?? 'Untitled',
        description: asString(record.description),
        frequency: asString(record.frequency),
        severity: asString(record.severity),
        evidence: asStringArray(record.evidence),
      };
    })
    .filter((item): item is ParsedTheme => item != null);
}

function parsePrioritySignals(value: unknown): ParsedPrioritySignal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const priority = asString(record.priority);
      if (!priority) {
        return null;
      }

      return {
        priority,
        verdict: asString(record.verdict),
        evidence: asString(record.evidence),
      };
    })
    .filter((item): item is ParsedPrioritySignal => item != null);
}

function parseAiReviews(listing: ReviewJobListing): ParsedAiReviews | null {
  const ai = asRecord(listing.analysis?.aiReviews);
  if (!ai) {
    return null;
  }

  const summaryScore = asRecord(ai.summaryScore);

  return {
    overallSentiment: asString(ai.overallSentiment),
    trends: asString(ai.trends),
    guestDemographics: asString(ai.guestDemographics),
    summaryScore: asNumber(summaryScore?.score),
    summaryJustification: asString(summaryScore?.justification),
    strengths: parseThemeList(ai.strengths, 'theme'),
    weaknesses: parseThemeList(ai.weaknesses, 'theme'),
    redFlags: parseThemeList(ai.redFlags, 'issue'),
    dealBreakers: parseThemeList(ai.dealBreakers, 'issue'),
    priorities: parsePrioritySignals(ai.priorityAnalysis),
  };
}

function parseAiPhotos(listing: ReviewJobListing): ParsedAiPhotos | null {
  const ai = asRecord(listing.analysis?.aiPhotos);
  if (!ai) {
    return null;
  }

  const listingAccuracy = asRecord(ai.listingAccuracy);

  return {
    overallImpression: asString(ai.overallImpression),
    overallCleanliness: asNumber(ai.overallCleanliness),
    overallModernity: asNumber(ai.overallModernity),
    highlights: asStringArray(ai.highlights),
    concerns: asStringArray(ai.concerns),
    priorities: parsePrioritySignals(ai.priorityAnalysis),
    listingAccuracyScore: asNumber(listingAccuracy?.score),
    listingAccuracyDiscrepancies: asStringArray(listingAccuracy?.discrepancies),
  };
}

function parseDetails(listing: ReviewJobListing): ParsedDetails | null {
  const details = asRecord(listing.analysis?.details);
  if (!details) {
    return null;
  }

  const addressRecord = asRecord(details.address);
  const amenitiesRaw = Array.isArray(details.amenities) ? details.amenities : [];
  const roomsRaw = Array.isArray(details.rooms) ? details.rooms : [];
  const photosRaw = Array.isArray(details.photos) ? details.photos : [];

  const amenities = amenitiesRaw
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      const record = asRecord(item);
      return asString(record?.name);
    })
    .filter((item): item is string => Boolean(item));

  const photos = [
    ...photosRaw.map((item) => getPhotoUrl(item)),
    ...roomsRaw.flatMap((room) => {
      const record = asRecord(room);
      const roomPhotos = Array.isArray(record?.photos) ? record.photos : [];
      return roomPhotos.map((photo) => getPhotoUrl(photo));
    }),
    listing.photoUrl,
  ].filter((item): item is string => Boolean(item));

  const uniquePhotos = [...new Set(photos)];

  return {
    description: asString(details.description),
    address:
      asString(addressRecord?.full)
      ?? asString(details.address)
      ?? null,
    checkIn: asString(details.checkIn),
    checkOut: asString(details.checkOut),
    amenities,
    photos: uniquePhotos,
  };
}
