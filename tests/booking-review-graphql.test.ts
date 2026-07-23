import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBookingReviewListVariables,
  mapBookingReviewCard,
  shouldStopBookingReviewPagination,
} from '../src/booking/scraper.js';

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
