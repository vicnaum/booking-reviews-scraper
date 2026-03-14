# Pricing Audit

Updated: 2026-03-14

## Goal

Make nightly-vs-total semantics explicit across search parsing, persistence, filtering, and UI rendering so the same number never silently changes meaning.

## Canonical Model

Search results now carry explicit pricing facts in [src/search/types.ts](../src/search/types.ts) and [web/src/types.ts](../web/src/types.ts):

- `pricing.nightly`
- `pricing.total`
- `pricing.display`

Each value stores:

- `amount`
- `currency`
- `source`

`pricing.display` also stores `basis` (`night`, `stay`, `unknown`).

Source meanings:

- `upstream`: upstream explicitly labeled this basis
- `derived`: we computed it from another explicit value
- `displayed`: we only had a shown/display amount

## Airbnb Findings

Code paths:

- API search parser: [src/airbnb/search.ts](../src/airbnb/search.ts)
- SSR search parser: [src/airbnb/search.ts](../src/airbnb/search.ts)
- Airbnb pricing helpers: [src/airbnb/pricing.ts](../src/airbnb/pricing.ts)

Live `explore_tabs` evidence for a dated London search:

- `pricing_quote.structured_stay_display_price.primary_line.qualifier = "total"`
- `pricing_quote.rate.amount = 1414`
- price breakdown included:
  - `9 nights x $167.53`
  - `Total = $1,413.21`

Conclusion:

- Airbnb search results in the observed dated search path are total-first.
- The old parser incorrectly treated that primary amount as nightly.
- The new parser extracts:
  - nightly from the `N nights x X` line
  - total from the `Total` line
  - display basis from `primary_line.qualifier`

SSR search showed the same structure:

- `structuredDisplayPrice.primaryLine.qualifier = "total"`
- `structuredDisplayPrice.explanationData.priceDetails` contained both nightly breakdown and total

## Booking Findings

Code paths:

- GraphQL search parser: [src/booking/search.ts](../src/booking/search.ts)
- SSR search parser: [src/booking/search.ts](../src/booking/search.ts)
- Booking pricing helpers: [src/booking/pricing.ts](../src/booking/pricing.ts)
- Detail scraper: [src/booking/listing.ts](../src/booking/listing.ts)

Live Booking detail evidence for `park-avenue-baker-street`:

- room rows showed totals like `8,455 zł`
- there was no separate per-night value in the observed DOM row

Repo/internal evidence for GraphQL search:

- search uses `priceDisplayInfoIrene.displayPrice.amountPerStay`
- that is a stay-total amount
- nightly is therefore derived when dates are available

Conclusion:

- Booking search is total-first in the primary GraphQL path.
- SSR fallback card prices should not be treated as nightly by default.
- The new parser stores:
  - total as `upstream` for GraphQL
  - nightly as `derived` from total and stay length
  - SSR card totals as `displayed` stay totals

## Web Rules

Web price resolution now lives in [web/src/lib/pricing.ts](../web/src/lib/pricing.ts).

Rules:

- `Total` mode prefers explicit total, then derived total, then displayed stay-total.
- `Per night` mode prefers explicit nightly, then derived nightly from total, then displayed nightly.
- Derived or displayed values are shown with `~`.
- Cards always say `total` or `per night` explicitly.
- Filters use the same resolver as the UI, so display and filtering no longer drift.

## Regression Tests

- Airbnb parser fixtures: [tests/airbnb-pricing.test.ts](../tests/airbnb-pricing.test.ts)
- Booking parser fixtures: [tests/booking-pricing.test.ts](../tests/booking-pricing.test.ts)
- Web display/filter resolver tests: [web/src/lib/pricing.test.ts](../web/src/lib/pricing.test.ts)

These tests encode the exact cases that previously broke:

- Airbnb total-first search results
- Booking total-only search results
- displayed-only fallbacks
- derived nightly/total conversions
