import test from 'node:test';
import assert from 'node:assert/strict';

import { addListingsToReviewJob } from '../src/review-job-client.js';

test('review job client sends normalized URLs with owner authentication', async () => {
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  const result = await addListingsToReviewJob({
    jobId: 'job with spaces',
    ownerKey: 'owner-key',
    baseUrl: 'http://127.0.0.1:3000',
    urls: [
      'https://www.airbnb.com/rooms/123?source=map',
      'https://airbnb.co.uk/rooms/123',
      'https://www.booking.com/hotel/us/hotel-hugo.html',
    ],
    fetchImpl: (async (
      input: URL | RequestInfo,
      init?: RequestInit,
    ) => {
      requestedUrl = input.toString();
      requestedInit = init;
      return new Response(JSON.stringify({
        jobId: 'job with spaces',
        status: 'queued',
        addedCount: 2,
        duplicateCount: 0,
        listingCount: 2,
        message: 'Queued analysis for 2 newly added listings.',
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });

  assert.equal(
    requestedUrl,
    'http://127.0.0.1:3000/api/jobs/job%20with%20spaces/listings',
  );
  assert.equal(
    (requestedInit?.headers as Record<string, string>).Cookie,
    'stayreviewr_owner=owner-key',
  );
  assert.deepEqual(
    JSON.parse(requestedInit?.body as string),
    {
      urls: [
        'https://www.airbnb.com/rooms/123',
        'https://www.booking.com/hotel/us/hotel-hugo.en-gb.html',
      ],
    },
  );
  assert.equal(result.status, 'queued');
  assert.equal(result.addedCount, 2);
});

test('review job client surfaces duplicate no-op and API errors', async () => {
  const unchanged = await addListingsToReviewJob({
    jobId: 'job_1',
    ownerKey: 'owner_1',
    urls: ['https://www.airbnb.com/rooms/123'],
    fetchImpl: (async () => new Response(JSON.stringify({
      jobId: 'job_1',
      status: 'unchanged',
      addedCount: 0,
      duplicateCount: 1,
      listingCount: 0,
      message: 'That listing is already in this job. Nothing was queued.',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch,
  });
  assert.equal(unchanged.status, 'unchanged');
  assert.match(unchanged.message, /already in this job/);

  await assert.rejects(
    addListingsToReviewJob({
      jobId: 'job_1',
      ownerKey: 'wrong',
      urls: ['https://www.airbnb.com/rooms/123'],
      fetchImpl: (async () => new Response(JSON.stringify({
        error: 'Review job not found',
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
    }),
    /Review job not found/,
  );
});

test('review job client validates owner key and URLs before HTTP', async () => {
  await assert.rejects(
    addListingsToReviewJob({
      jobId: 'job_1',
      ownerKey: '',
      urls: ['https://www.airbnb.com/rooms/123'],
    }),
    /owner key is required/i,
  );

  await assert.rejects(
    addListingsToReviewJob({
      jobId: 'job_1',
      ownerKey: 'owner_1',
      urls: ['https://example.com/not-a-listing'],
    }),
    /Invalid listing URL/,
  );
});
