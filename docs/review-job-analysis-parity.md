# Review Job Analysis Parity

Branch: `feat/end-to-end-review-jobs`

This note captures the current CLI `reviewr batch` behavior that the web
analysis job must preserve.

## Phase Order

The CLI is globally phase-ordered. It does **not** run one listing end-to-end
before moving to the next. The effective order in [src/batch.ts](/Users/vicnaum/github/booking-reviews-scraper/src/batch.ts) is:

1. details
2. reviews
3. photos
4. ai-reviews
5. ai-photos
6. triage

The web worker should keep this same order.

## Important Skip / Failure Rules

### Details

- Airbnb details require a valid Airbnb API key.
- Booking details do not.
- A details failure should **not** block the later reviews phase for that
  listing.

### Reviews

- Reviews can still run even if details failed.
- Booking reviews use `extractHotelInfo(url)` then `scrapeHotelReviews(...)`.
- Airbnb reviews use `fetchPropertyReviews(apiKey, propertyInfo)`.
- Review phase can be `partial` if fetched review count is meaningfully below
  expected count from listing details.

### Photos

- Photos require listing details.
- If details are missing, photos are skipped.
- Photos can be `partial` if downloaded count is below expected photo count.

### AI Reviews

- AI review analysis is skipped if:
  - no review file exists
  - review phase did not finish as `fetched` / `partial`
  - fetched review count is `0`
- The zero-review skip is important and already fixed in the CLI path.

### AI Photos

- AI photo analysis is skipped if:
  - no photo directory exists
  - photo directory is empty
- The photo analysis uses local downloaded files, not remote URLs.

### Triage

- Triage requires listing details.
- Triage can still run without AI review analysis and/or AI photo analysis.
- Triage consumes:
  - listing details (required)
  - ai review analysis (optional)
  - ai photo analysis (optional)
  - free-text priorities / brief

## File Contract Reused By The Web Worker

The easiest way to preserve CLI behavior is to keep the same file-oriented
contract inside a temporary worker workspace:

- `listing.json`
- `reviews.json`
- `photos/`
- `ai-reviews.json`
- `ai-photos.json`
- `triage.json`

The web job should persist structured DB outputs, but the worker can still use
the same temporary file inputs that `runAnalyze`, `runAnalyzePhotos`, and
`runTriage` already expect.

## AI Module Inputs

### `runAnalyze`

- required: `reviewsFile`
- optional: `listingFile`
- optional: `priorities`

### `runAnalyzePhotos`

- required: `photosDir`
- optional: `listingFile`
- optional: `priorities`
- currently Gemini-only

### `runTriage`

- required: `listingFile`
- optional: `aiReviewsFile`
- optional: `aiPhotosFile`
- optional: `priorities`
- currently Gemini-only

## Persistence Goals For The Web Job

The web job should persist:

- listing details JSON
- ai review analysis JSON
- ai photo analysis JSON
- triage JSON
- per-phase status
- review count
- photo count
- structured timeline events

It does **not** need to treat raw review JSON or downloaded photo files as the
primary long-term artifact, as long as the worker can recreate the CLI inputs
reliably while analysis is running.
