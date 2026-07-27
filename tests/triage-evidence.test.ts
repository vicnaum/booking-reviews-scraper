import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTriageEvidenceFingerprint,
  didTriageEvidenceMateriallyImprove,
  parseTriageEvidenceFingerprint,
} from '../src/triage-evidence.js';

function artifact(data: unknown, suffix = '') {
  return {
    data,
    content: `${JSON.stringify(data)}${suffix}`,
  };
}

test('triage evidence fingerprints record layers, artifact hashes, and core coverage', () => {
  const fingerprint = createTriageEvidenceFingerprint({
    details: artifact({
      title: 'Recovered title',
      rating: 4.9,
      reviewCount: 0,
      subRatings: { cleanliness: 4.8 },
      amenities: [{ name: 'Elevator' }],
    }),
    reviews: artifact({ themes: [] }),
  });

  assert.deepEqual(fingerprint.layers, {
    details: true,
    reviews: true,
    photos: false,
  });
  assert.deepEqual(fingerprint.detailsCoreCoverage, {
    title: true,
    rating: true,
    reviewCount: true,
    subRatings: true,
    amenities: true,
    total: 5,
  });
  assert.match(fingerprint.artifacts.detailsSha256, /^[a-f0-9]{64}$/);
  assert.match(fingerprint.artifacts.reviewsSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(fingerprint.artifacts.photosSha256, null);
  assert.deepEqual(
    parseTriageEvidenceFingerprint(fingerprint),
    fingerprint,
  );
  assert.ok(parseTriageEvidenceFingerprint({
    hash: fingerprint.hash,
    version: fingerprint.version,
    detailsCoreCoverage: {
      total: fingerprint.detailsCoreCoverage.total,
      amenities: fingerprint.detailsCoreCoverage.amenities,
      subRatings: fingerprint.detailsCoreCoverage.subRatings,
      reviewCount: fingerprint.detailsCoreCoverage.reviewCount,
      rating: fingerprint.detailsCoreCoverage.rating,
      title: fingerprint.detailsCoreCoverage.title,
    },
    artifacts: {
      photosSha256: fingerprint.artifacts.photosSha256,
      reviewsSha256: fingerprint.artifacts.reviewsSha256,
      detailsSha256: fingerprint.artifacts.detailsSha256,
    },
    layers: {
      photos: fingerprint.layers.photos,
      reviews: fingerprint.layers.reviews,
      details: fingerprint.layers.details,
    },
  }));
});

test('byte drift alone changes the fingerprint without suggesting a regrade', () => {
  const details = {
    title: 'Same coverage',
    rating: 4.8,
    reviewCount: 20,
    subRatings: { location: 4.7 },
    amenities: ['Wifi'],
    description: 'Before',
  };
  const before = createTriageEvidenceFingerprint({
    details: artifact(details),
  });
  const after = createTriageEvidenceFingerprint({
    details: artifact({ ...details, description: 'After' }, '\n'),
  });

  assert.notEqual(before.hash, after.hash);
  assert.equal(
    didTriageEvidenceMateriallyImprove(before, after),
    false,
  );
});

test('new core coverage is material but layer presence alone is not', () => {
  const sparse = createTriageEvidenceFingerprint({
    details: artifact({
      title: '',
      rating: null,
      reviewCount: null,
      subRatings: {},
      amenities: [],
    }),
  });
  const richerDetails = createTriageEvidenceFingerprint({
    details: artifact({
      title: 'Recovered',
      rating: null,
      reviewCount: 0,
      subRatings: {},
      amenities: [],
    }),
  });
  const richerLayers = createTriageEvidenceFingerprint({
    details: artifact({
      title: '',
      rating: null,
      reviewCount: null,
      subRatings: {},
      amenities: [],
    }),
    photos: artifact({ observations: [] }),
  });

  assert.equal(
    didTriageEvidenceMateriallyImprove(sparse, richerDetails),
    true,
  );
  assert.equal(
    didTriageEvidenceMateriallyImprove(sparse, richerLayers),
    false,
  );
});
