# Review Job Roadmap

Branch: `feat/end-to-end-review-jobs`

## Goal

Evolve StayReviewr from an ephemeral search UI plus CLI handoff into a
persistent, web-native workflow:

1. User searches a city and refines the area on the map.
2. User runs a combined full search across Airbnb and Booking.
3. That full search creates a persistent job and redirects to `/jobs/[jobId]`.
4. The job stores the full search context:
   - trip dates
   - guests
   - filters
   - map center / zoom / bounds
   - POI
   - selected geometry mode
   - selected area
   - fetched listings
5. User enters optional analysis preferences and starts a background analysis run.
6. The job shows live progress and can be reopened later by URL.
7. Final results are rendered natively in the web app.

## Principles

- Do not stretch `SearchJob` into the final product model.
- Introduce a new root model: `ReviewJob`.
- Treat search as phase 1 of the job, analysis as phase 2.
- Keep CLI modules as the shared engine, but stop depending on CLI UX/files.
- Persist everything needed to reopen a job without the browser window staying open.

## Milestone 1: Persistent Combined Search Jobs

Outcome:
- Platform switch removed from landing and map.
- Quick search merges Airbnb + Booking into one result set.
- Full search creates a persistent `ReviewJob`.
- User is redirected to `/jobs/[jobId]`.
- `/jobs/[jobId]` restores the saved map context and persisted listings.

Scope:
- Add `ReviewJob`, `ReviewJobListing`, `ReviewJobEvent`.
- Save `ownerKey`, trip params, filters, POI, geometry, map center/zoom/bounds.
- Add combined full-search worker job.
- Build a first job workspace page.

## Milestone 2: Analysis Jobs

Outcome:
- User can optionally enter a free-form prompt/preferences block on the job page.
- User clicks `Analyze`.
- Backend runs the full pipeline in the background:
  - listing details
  - reviews
  - photos
  - AI review analysis
  - AI photo analysis
  - triage

Scope:
- Add analysis lifecycle fields to `ReviewJob`.
- Reuse the shared engine behind:
  - `src/batch.ts`
  - `src/analyze.ts`
  - `src/analyze-photos.ts`
  - `src/triage.ts`
- Persist structured progress and outputs instead of writing files as the primary artifact.

## Milestone 3: Progress and Results UX

Outcome:
- Job page shows live progress and phase history.
- Results page shows map + ranking + listing drill-down/comparison.
- Job can be reopened later and still shows status or final results.

Scope:
- Persist structured `ReviewJobEvent` rows.
- Start with polling; add SSE after the event model is stable.
- Recreate the best parts of the current static report in the app.

## Milestone 4: Temporary Job History

Outcome:
- Landing page shows recent jobs for the current browser.

Scope:
- Use a temporary browser-scoped `ownerKey`.
- Show recent jobs before full auth exists.
- Replace this later with real authentication.

## Suggested Build Order

1. Schema and backend foundation for `ReviewJob`.
2. Combined quick search across both platforms.
3. Full search -> create job -> redirect to `/jobs/[jobId]`.
4. Job workspace rendering persisted results only.
5. Analysis queue and persisted progress.
6. Results page and richer history/dashboard UX.
