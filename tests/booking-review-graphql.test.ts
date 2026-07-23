import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildBookingReviewListVariables,
  makeBookingGraphQlRequest,
  mapBookingReviewCard,
  scrapeHotelReviews,
  shouldStopBookingReviewPagination,
} from '../src/booking/scraper.js';
import { runBatch } from '../src/batch.js';

test('Booking GraphQL retries an HTTP-200 HTML challenge and recovers', async () => {
  const responseBodies = [
    '<!doctype html><html><body>AWS WAF CAPTCHA challenge</body></html>',
    JSON.stringify({ data: { recovered: true } }),
  ];
  const requestedMaxRetries: number[] = [];
  const delays: number[] = [];

  const data = await makeBookingGraphQlRequest<{ recovered: boolean }>(
    'ReviewList',
    { input: { skip: 0 } },
    'query ReviewList { __typename }',
    {
      request: async (_url, maxRetries) => {
        requestedMaxRetries.push(maxRetries ?? 0);
        return {
          data: responseBodies.shift()!,
          status: 200,
          statusText: 'OK',
        };
      },
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    },
  );

  assert.deepEqual(data, { recovered: true });
  assert.deepEqual(requestedMaxRetries, [3, 3]);
  assert.deepEqual(delays, [1000]);
});

test('Booking GraphQL bounds invalid-JSON retries', async () => {
  let requestCount = 0;

  await assert.rejects(
    makeBookingGraphQlRequest(
      'ReviewList',
      { input: { skip: 0 } },
      'query ReviewList { __typename }',
      {
        request: async () => {
          requestCount++;
          return {
            data: '<html><body>Access denied</body></html>',
            status: 200,
            statusText: 'OK',
          };
        },
        sleep: async () => {},
        maxInvalidJsonAttempts: 2,
      },
    ),
    /returned invalid JSON \(HTML challenge response\) after 2 attempts/,
  );

  assert.equal(requestCount, 2);
});

test('Booking scraper propagates an exhausted first-page error instead of returning zero reviews', async () => {
  await assert.rejects(
    scrapeHotelReviews(
      {
        hotel_name: 'example-hotel',
        country_code: 'us',
        url: 'https://www.booking.com/hotel/us/example-hotel.en-gb.html',
      },
      undefined,
      {
        resolveHotelId: async () => 123,
        fetchPage: async () => {
          throw new Error('ReviewList page retries exhausted');
        },
      },
    ),
    /ReviewList page retries exhausted/,
  );
});

test('Booking scraper distinguishes a genuine zero-review result from an advertised empty result', async () => {
  const hotelInfo = {
    hotel_name: 'example-hotel',
    country_code: 'us',
    url: 'https://www.booking.com/hotel/us/example-hotel.en-gb.html',
  };
  const resolveHotelId = async () => 123;

  const reviews = await scrapeHotelReviews(hotelInfo, undefined, {
    resolveHotelId,
    fetchPage: async () => ({ cards: [], reviewsCount: 0 }),
  });
  assert.deepEqual(reviews, []);

  await assert.rejects(
    scrapeHotelReviews(hotelInfo, undefined, {
      resolveHotelId,
      fetchPage: async () => ({ cards: [], reviewsCount: 10 }),
    }),
    /advertised 10 reviews.*returned no approved review cards/,
  );
});

test('Booking batch records all-pages-errored as failed, never fetched zero', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewr-booking-review-error-'));
  const outputDir = path.join(tempDir, 'output');
  const urlsFile = path.join(tempDir, 'urls.txt');
  const hotelName = 'example-hotel';
  fs.writeFileSync(
    urlsFile,
    `https://www.booking.com/hotel/us/${hotelName}.en-gb.html\n`,
  );

  try {
    const result = await runBatch(
      [urlsFile],
      {
        fetchDetails: false,
        fetchReviews: true,
        fetchPhotos: false,
        aiReviews: false,
        aiPhotos: false,
        triage: false,
        aiReviewsExplicit: false,
        aiPhotosExplicit: false,
        triageExplicit: false,
        force: false,
        retryFailed: false,
        downloadPhotosAll: false,
        outputDir,
        print: false,
        artifactCache: null,
      },
      {
        scrapeBookingHotelReviews: async () => {
          throw new Error('ReviewList page retries exhausted');
        },
      },
    );

    const manifest = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'batch_manifest.json'), 'utf-8'),
    );
    const reviews = manifest.listings[`booking/${hotelName}`].reviews;

    assert.equal(reviews.status, 'failed');
    assert.equal(reviews.count, undefined);
    assert.match(reviews.error, /ReviewList page retries exhausted/);
    assert.equal(result.booking.reviews.fetched, 0);
    assert.equal(result.booking.reviews.failed, 1);
    assert.equal(
      fs.existsSync(path.join(outputDir, 'reviews', `${hotelName}_reviews.json`)),
      false,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildBookingReviewListVariables preserves the captured ReviewList input shape', () => {
  assert.deepEqual(buildBookingReviewListVariables(8_413_015, 'fr', 20), {
    input: {
      hotelId: 8_413_015,
      ufi: 0,
      hotelCountryCode: 'fr',
      sorter: 'NEWEST_FIRST',
      filters: {
        text: '',
      },
      skip: 20,
      limit: 10,
      upsortReviewUrl: '',
      searchFeatures: {
        destId: 0,
        destType: 'CITY',
      },
    },
  });
});

test('empty approved-card pages stop pagination only after the first page', () => {
  assert.equal(shouldStopBookingReviewPagination(0, 0), false);
  assert.equal(shouldStopBookingReviewPagination(1, 0), true);
  assert.equal(shouldStopBookingReviewPagination(50, 0), true);
  assert.equal(shouldStopBookingReviewPagination(1, 1), false);
});

test('mapBookingReviewCard preserves the legacy review artifact contract', () => {
  const review = mapBookingReviewCard(
    {
      reviewUrl: 'review-id',
      guestDetails: {
        username: '  Victor  ',
        countryName: 'Poland',
        guestTypeTranslation: 'Solo traveller',
      },
      bookingDetails: {
        customerType: 'SOLO_TRAVELLERS',
        roomType: {
          name: 'One-Bedroom Apartment',
        },
        numNights: 1,
      },
      reviewedDate: 1_700_000_000,
      helpfulVotesCount: 2,
      reviewScore: 9,
      textDetails: {
        title: 'A good stay',
        positiveText: 'Quiet and clean!',
        negativeText: 'No lift',
        lang: 'en',
      },
      partnerReply: {
        reply: '  Thank you.  ',
      },
      isApproved: true,
    },
    'sample-hotel',
  );

  assert.deepEqual(review, {
    hotel_name: 'sample-hotel',
    username: 'Victor',
    user_country: 'Poland',
    room_view: 'One-Bedroom Apartment',
    stay_duration: '1 night',
    stay_type: 'Solo traveller',
    review_post_date: '2023-11-14 22:13:20',
    review_title: 'A good stay',
    rating: 9,
    original_lang: 'en',
    review_text_liked: 'Quiet and clean!',
    review_text_disliked: 'No lift',
    full_review: 'title: A good stay. liked: Quiet and clean! disliked: No lift.',
    en_full_review: 'title: A good stay. liked: Quiet and clean! disliked: No lift.',
    found_helpful: 2,
    found_unhelpful: 0,
    owner_resp_text: 'Thank you.',
  });
});

test('mapBookingReviewCard handles missing text and enum fallback safely', () => {
  const review = mapBookingReviewCard(
    {
      bookingDetails: {
        customerType: 'GROUP_OF_FRIENDS',
        numNights: 0,
      },
      textDetails: {
        positiveText: 'There are no comments available for this review',
        lang: 'xu',
      },
      helpfulVotesCount: -3,
    },
    'sample-hotel',
  );

  assert.equal(review.stay_type, 'Group Of Friends');
  assert.equal(review.stay_duration, null);
  assert.equal(review.review_text_liked, null);
  assert.equal(review.full_review, null);
  assert.equal(review.en_full_review, null);
  assert.equal(review.found_helpful, 0);
});
