// src/report.ts
//
// Generates a self-contained HTML report from triage results.
// Usage: reviewr report -o data/rome

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

export interface ReportOptions {
  outputDir: string;
  outputFile?: string;
}

interface ManifestEntry {
  platform: string;
  id: string;
  url: string;
  details: { status: string; file: string };
  reviews?: { status: string; file: string; count?: number };
  photos?: { status: string; dir: string; count?: number };
  triage?: { status: string; file: string };
  aiReviews?: { status: string; file: string };
}

interface TriageData {
  fitScore: number;
  tier: string;
  tierReason: string;
  requirements: Array<{
    requirement: string;
    type: string;
    status: string;
    confidence: string;
    note: string;
  }>;
  scores: Record<string, number>;
  bedSetup: string;
  price: { total: string; perNight: string; valueAssessment: string };
  highlights: string[];
  concerns: string[];
  dealBreakers: string[];
  summary: string;
}

interface ListingRow {
  id: string;
  platform: string;
  url: string;
  title: string;
  tier: string;
  fitScore: number;
  tierReason: string;
  priceTotal: string;
  pricePerNight: string;
  valueAssessment: string;
  bedSetup: string;
  scores: Record<string, number>;
  requirements: TriageData['requirements'];
  highlights: string[];
  concerns: string[];
  dealBreakers: string[];
  summary: string;
  photos: string[];
  rating: number | null;
  reviewCount: number | null;
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
  capacity: number | null;
  checkInTime: string;
  checkOutTime: string;
  hasParking: boolean;
  hasWifi: boolean;
  hasElevator: boolean;
  hasAC: boolean;
  hasBalcony: boolean;
  lat: number | null;
  lng: number | null;
  // AI review data
  aiOverallSentiment: string;
  aiStrengths: Array<{ theme: string; description: string; evidence: string[]; frequency: string }>;
  aiWeaknesses: Array<{ theme: string; description: string; evidence: string[]; severity: string; frequency: string }>;
  aiRedFlags: Array<{ issue: string; description: string; evidence: string[]; frequency: string }>;
  aiDealBreakers: Array<{ issue: string; description: string; evidence: string[]; frequency: string }>;
  aiTrends: string;
  aiGuestDemographics: string;
  aiSummaryScore: { score: number; justification: string } | null;
  // Q&A entries
  qaEntries: Array<{ question: string; answer: string; confidence: string; evidence: string[]; askedAt: string }>;
}

function readJSON(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function getPhotos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();
}

export async function generateReport(options: ReportOptions): Promise<string> {
  const outputDir = resolve(options.outputDir);
  const manifestPath = join(outputDir, 'batch_manifest.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest = readJSON(manifestPath);
  const listings: Record<string, ManifestEntry> = manifest.listings;
  const rows: ListingRow[] = [];

  for (const [key, entry] of Object.entries(listings)) {
    if (entry.triage?.status !== 'fetched') continue;

    const triagePath = join(outputDir, entry.triage.file);
    if (!existsSync(triagePath)) continue;

    const triage: TriageData = readJSON(triagePath);

    // Read listing for details
    let title = entry.id;
    let rating: number | null = null;
    let reviewCount: number | null = null;
    let bedrooms: number | null = null;
    let beds: number | null = null;
    let bathrooms: number | null = null;
    let capacity: number | null = null;
    let checkInTime = '';
    let checkOutTime = '';
    let hasParking = false, hasWifi = false, hasElevator = false, hasAC = false, hasBalcony = false;
    let lat: number | null = null;
    let lng: number | null = null;
    if (entry.details?.status === 'fetched') {
      const listingPath = join(outputDir, entry.details.file);
      if (existsSync(listingPath)) {
        const listing = readJSON(listingPath);
        title = listing.title || listing.name || entry.id;
        rating = listing.rating ?? null;
        reviewCount = listing.reviewCount ?? null;
        bedrooms = listing.bedrooms ?? null;
        beds = listing.beds ?? null;
        bathrooms = listing.bathrooms ?? null;
        capacity = listing.capacity ?? null;
        checkInTime = listing.checkIn || '';
        checkOutTime = listing.checkOut || '';
        // Parse amenities
        const amenities: any[] = listing.amenities || [];
        const amenStr = amenities.map((a: any) => typeof a === 'string' ? a : a.name || '').join('|').toLowerCase();
        hasParking = /parking|garage/i.test(amenStr);
        hasWifi = /wifi|wi-fi|internet/i.test(amenStr);
        hasElevator = /elevator|lift/i.test(amenStr);
        hasAC = /air.?condition|a\/c|\bac\b|cooling/i.test(amenStr);
        hasBalcony = /balcon|terrace|patio/i.test(amenStr);
        lat = listing.coordinates?.lat ?? null;
        lng = listing.coordinates?.lng ?? null;
      }
    }

    // Collect photo filenames
    const photosDir = entry.photos?.dir ? join(outputDir, entry.photos.dir) : '';
    const photos = photosDir ? getPhotos(photosDir).map(f => `${entry.photos!.dir}/${f}`) : [];

    // Load AI review data
    let aiOverallSentiment = '', aiStrengths: any[] = [], aiWeaknesses: any[] = [], aiRedFlags: any[] = [], aiDealBreakersAI: any[] = [];
    let aiTrends = '', aiGuestDemographics = '', aiSummaryScore: any = null;
    if (entry.aiReviews?.status === 'fetched') {
      const aiPath = join(outputDir, entry.aiReviews.file);
      if (existsSync(aiPath)) {
        const ai = readJSON(aiPath);
        aiOverallSentiment = ai.overallSentiment || '';
        aiStrengths = ai.strengths || [];
        aiWeaknesses = ai.weaknesses || [];
        aiRedFlags = ai.redFlags || [];
        aiDealBreakersAI = ai.dealBreakers || [];
        aiTrends = ai.trends || '';
        aiGuestDemographics = ai.guestDemographics || '';
        aiSummaryScore = ai.summaryScore || null;
      }
    }

    rows.push({
      id: entry.id,
      platform: entry.platform,
      url: entry.url,
      title,
      tier: triage.tier,
      fitScore: triage.fitScore,
      tierReason: triage.tierReason,
      priceTotal: triage.price?.total || '—',
      pricePerNight: triage.price?.perNight || '—',
      valueAssessment: triage.price?.valueAssessment || 'unknown',
      bedSetup: triage.bedSetup || '—',
      scores: triage.scores || {},
      requirements: triage.requirements || [],
      highlights: triage.highlights || [],
      concerns: triage.concerns || [],
      dealBreakers: triage.dealBreakers || [],
      summary: triage.summary || '',
      photos,
      lat,
      lng,
      rating,
      reviewCount,
      bedrooms,
      beds,
      bathrooms,
      capacity,
      checkInTime,
      checkOutTime,
      hasParking,
      hasWifi,
      hasElevator,
      hasAC,
      hasBalcony,
      aiOverallSentiment,
      aiStrengths,
      aiWeaknesses,
      aiRedFlags,
      aiDealBreakers: aiDealBreakersAI,
      aiTrends,
      aiGuestDemographics,
      aiSummaryScore,
      qaEntries: [], // populated after queries are loaded
    });
  }

  rows.sort((a, b) => b.fitScore - a.fitScore);

  // Load or create picks.json
  const picksPath = join(outputDir, 'picks.json');
  let picks: { liked: string[]; hidden: string[] } = { liked: [], hidden: [] };
  const extractIds = (arr: any[]): string[] =>
    arr.map((item: any) => typeof item === 'string' ? item : item?.id).filter(Boolean);
  if (existsSync(picksPath)) {
    try {
      const saved = readJSON(picksPath);
      picks.liked = extractIds(saved.liked || []);
      picks.hidden = extractIds(saved.hidden || []);
    } catch {}
  } else {
    writeFileSync(picksPath, JSON.stringify(picks, null, 2), 'utf-8');
    console.log(`Created ${picksPath}`);
  }

  // Load Q&A queries
  const queriesDir = join(outputDir, 'queries');
  const qaByListing: Record<string, Array<{ question: string; answer: string; confidence: string; evidence: string[]; askedAt: string }>> = {};
  if (existsSync(queriesDir)) {
    for (const file of readdirSync(queriesDir).filter(f => f.endsWith('.json'))) {
      try {
        const q = readJSON(join(queriesDir, file));
        if (q.question && Array.isArray(q.answers)) {
          for (const ans of q.answers) {
            if (!ans.id) continue;
            if (!qaByListing[ans.id]) qaByListing[ans.id] = [];
            qaByListing[ans.id].push({
              question: q.question,
              answer: ans.answer,
              confidence: ans.confidence || 'medium',
              evidence: ans.evidence || [],
              askedAt: q.askedAt || '',
            });
          }
        }
      } catch {}
    }
  }
  for (const row of rows) {
    row.qaEntries = qaByListing[row.id] || [];
  }

  const html = buildHTML(rows, manifest.dates, picks);
  const outFile = options.outputFile || join(outputDir, 'report.html');
  writeFileSync(outFile, html, 'utf-8');
  console.log(`Generated report with ${rows.length} listings`);
  return outFile;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHTML(rows: ListingRow[], dates?: { checkIn: string; checkOut: string; adults: number }, picks?: { liked: string[]; hidden: string[] }): string {
  const dataJSON = JSON.stringify(rows);
  const picksJSON = JSON.stringify(picks || { liked: [], hidden: [] });
  const tierOrder = ['top_pick', 'shortlist', 'consider', 'unlikely', 'no_go'];
  const tierCounts: Record<string, number> = {};
  for (const t of tierOrder) tierCounts[t] = 0;
  for (const r of rows) tierCounts[r.tier] = (tierCounts[r.tier] || 0) + 1;

  const topPicks = rows.filter(r => r.tier === 'top_pick');
  const heroRows = topPicks.length >= 3 ? topPicks : rows.slice(0, 5);

  const dateLabel = dates ? `${dates.checkIn} → ${dates.checkOut} · ${dates.adults} guests` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Listing Report — ${rows.length} properties</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
${getCSS()}
</style>
</head>
<body>

<header>
  <h1>Listing Report</h1>
  <p class="subtitle">${rows.length} listings triaged${dateLabel ? ` · ${esc(dateLabel)}` : ''}</p>
</header>

<!-- TOP PICKS -->
<section id="top-picks">
  <h2>Top Picks</h2>
  <div class="hero-grid">
${heroRows.map(r => heroCard(r)).join('\n')}
  </div>
</section>

<!-- TIER FILTERS -->
<section id="filters">
${tierOrder.map(t => `  <button class="tier-btn active" data-tier="${t}"><span class="tier-dot tier-${t}"></span>${t.replace('_', ' ')} <span class="count">${tierCounts[t]}</span></button>`).join('\n')}
</section>

<!-- LIKED TABLE -->
<section id="liked-section" style="display:none">
<h2 class="section-title liked-title">&#9829; Liked</h2>
<table id="liked-table">
<thead>
<tr>
  <th style="width:36px"></th>
  <th class="sortable" data-sort="rank">#</th>
  <th>Photo</th>
  <th class="sortable" data-sort="title">Title</th>
  <th class="sortable" data-sort="tier">Tier</th>
  <th class="sortable active-sort" data-sort="fitScore">Score</th>
  <th class="sortable" data-sort="price">Total</th>
  <th>Info</th>
  <th>Scores</th>
  <th>Requirements</th>
  <th>Issues</th>
  <th style="width:36px"></th>
</tr>
</thead>
<tbody id="liked-body">
</tbody>
</table>
</section>

<!-- MAP -->
<section id="map-section">
  <h2 class="section-title">Map</h2>
  <div id="map-resize-top" class="map-resize-handle" title="Drag to resize map"><span>⋯</span></div>
  <div id="map" style="height:500px;border-radius:0;border:1px solid var(--border);border-top:none;border-bottom:none;margin:0 32px"></div>
  <div id="map-resize-bottom" class="map-resize-handle" title="Drag to resize map"><span>⋯</span></div>
</section>

<!-- TABLE -->
<section id="table-section">
<h2 class="section-title">All Listings</h2>
<table id="listings-table">
<thead>
<tr>
  <th style="width:36px"></th>
  <th class="sortable" data-sort="rank">#</th>
  <th>Photo</th>
  <th class="sortable" data-sort="title">Title</th>
  <th class="sortable" data-sort="tier">Tier</th>
  <th class="sortable active-sort" data-sort="fitScore">Score</th>
  <th class="sortable" data-sort="price">Total</th>
  <th>Info</th>
  <th>Scores</th>
  <th>Requirements</th>
  <th>Issues</th>
  <th style="width:36px"></th>
</tr>
</thead>
<tbody id="table-body">
</tbody>
</table>
</section>

<div id="export-bar">
  <div class="bar-counts">
    <div class="bar-count">Liked: <span id="liked-count">0</span></div>
    <div class="bar-count">Hidden: <span id="hidden-count">0</span></div>
  </div>
  <button class="show-hidden-btn" id="toggle-hidden-btn" onclick="toggleShowHidden()">Show hidden</button>
  <button onclick="savePicks()">Save picks.json</button>
  <button onclick="copyList('liked')">Copy liked</button>
  <button onclick="copyList('hidden')">Copy hidden</button>
  <button onclick="copyList('all')">Copy all</button>
</div>
<div class="toast" id="toast"></div>

<script>
const DATA = ${dataJSON};
const INITIAL_PICKS = ${picksJSON};
${getJS()}
</script>
</body>
</html>`;
}

function heroCard(r: ListingRow): string {
  const photo = r.photos[0] || '';
  const reqDots = r.requirements.map(req =>
    `<span class="req-dot status-${req.status}" title="${esc(req.requirement)}: ${req.status}"></span>`
  ).join('');

  return `    <div class="hero-card" data-id="${esc(r.id)}" onclick="scrollToRow('${esc(r.id)}')">
      ${photo ? `<img class="hero-photo" src="${esc(photo)}" alt="${esc(r.title)}" loading="lazy">` : '<div class="hero-photo no-photo"></div>'}
      <div class="hero-body">
        <div class="hero-badges"><span class="score-badge">${r.fitScore}</span><span class="tier-badge tier-${r.tier}">${r.tier.replace('_', ' ')}</span></div>
        <h3><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></h3>
        <div class="hero-meta">${esc(r.priceTotal)} · ${r.bedrooms ?? '?'}BR ${r.beds ?? '?'}beds · ${esc(r.bedSetup.substring(0, 60))}</div>
        <p class="hero-summary">${esc(r.summary.substring(0, 160))}${r.summary.length > 160 ? '…' : ''}</p>
        <div class="req-dots">${reqDots}</div>
      </div>
    </div>`;
}

function getCSS(): string {
  return `
:root {
  --top_pick: #22c55e; --shortlist: #3b82f6; --consider: #f59e0b; --unlikely: #ef4444; --no_go: #6b7280;
  --met: #22c55e; --partial: #f59e0b; --unmet: #ef4444; --unknown: #9ca3af;
  --bg: #f8fafc; --card: #ffffff; --border: #e2e8f0; --text: #1e293b; --muted: #64748b;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.5; }
header { padding: 24px 32px 8px; }
header h1 { font-size: 24px; font-weight: 700; }
.subtitle { color: var(--muted); font-size: 14px; margin-top: 4px; }

/* HERO */
#top-picks { padding: 16px 32px; }
#top-picks h2 { font-size: 18px; margin-bottom: 12px; }
.hero-grid { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px; }
.hero-card { min-width: 280px; max-width: 320px; background: var(--card); border-radius: 12px; border: 1px solid var(--border); overflow: hidden; cursor: pointer; transition: box-shadow .15s; flex-shrink: 0; }
.hero-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.1); }
.hero-photo { width: 100%; height: 180px; object-fit: cover; display: block; background: #e2e8f0; }
.no-photo { height: 180px; background: #cbd5e1; }
.hero-body { padding: 12px 16px; }
.hero-badges { display: flex; gap: 6px; margin-bottom: 6px; }
.score-badge { background: var(--text); color: #fff; font-weight: 700; font-size: 13px; padding: 2px 8px; border-radius: 6px; }
.tier-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px; color: #fff; text-transform: capitalize; }
.tier-top_pick { background: var(--top_pick); } .tier-shortlist { background: var(--shortlist); }
.tier-consider { background: var(--consider); } .tier-unlikely { background: var(--unlikely); }
.tier-no_go { background: var(--no_go); }
.hero-body h3 { font-size: 14px; margin-bottom: 4px; }
.hero-body h3 a { color: inherit; text-decoration: none; }
.hero-body h3 a:hover { text-decoration: underline; }
.hero-meta { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.hero-summary { font-size: 12px; color: var(--muted); margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.req-dots { display: flex; gap: 3px; flex-wrap: wrap; }
.req-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.status-met { background: var(--met); } .status-partial { background: var(--partial); }
.status-unmet { background: var(--unmet); } .status-unknown { background: var(--unknown); }

/* FILTERS */
#filters { padding: 12px 32px; display: flex; gap: 8px; flex-wrap: wrap; position: sticky; top: 0; background: var(--bg); z-index: 20; border-bottom: 1px solid var(--border); }
.tier-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; border: 1.5px solid var(--border); background: var(--card); font-size: 13px; font-weight: 500; cursor: pointer; transition: all .15s; text-transform: capitalize; }
.tier-btn.active { border-color: var(--text); background: var(--text); color: #fff; }
.tier-btn .count { font-size: 11px; opacity: .7; }
.tier-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.tier-dot.tier-top_pick { background: var(--top_pick); } .tier-dot.tier-shortlist { background: var(--shortlist); }
.tier-dot.tier-consider { background: var(--consider); } .tier-dot.tier-unlikely { background: var(--unlikely); }
.tier-dot.tier-no_go { background: var(--no_go); }
.tier-btn.active .tier-dot { box-shadow: 0 0 0 2px rgba(255,255,255,.5); }

/* SECTION TITLES */
.section-title { padding: 16px 32px 8px; margin: 0; font-size: 18px; font-weight: 700; color: var(--text); }
.liked-title { color: #ef4444; }

/* LIKED TABLE */
#liked-section { padding: 0 0 16px; border-bottom: 2px solid #fecaca; margin-bottom: 8px; }
#liked-section table { margin: 0 32px; width: calc(100% - 64px); }
#liked-section tr.listing-row { background: #fef2f2; }
#liked-section tr.listing-row:hover { background: #fee2e2; }

/* TABLE */
#table-section { padding: 0 32px 32px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { background: var(--text); color: #fff; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 12px; white-space: nowrap; user-select: none; }
th.sortable { cursor: pointer; }
th.sortable:hover { background: #334155; }
th.active-sort::after { content: ' ▼'; font-size: 10px; }
th.active-sort.asc::after { content: ' ▲'; }
td { padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
tr.listing-row { cursor: pointer; transition: background .1s; }
tr.listing-row:hover { background: #f1f5f9; }
tr.listing-row.expanded { background: #e8f0fe; }
.thumb { width: 144px; height: 96px; object-fit: cover; border-radius: 6px; display: block; background: #e2e8f0; }
.platform-badge { font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px; text-transform: uppercase; }
.platform-airbnb { background: #ff5a5f; color: #fff; }
.platform-booking { background: #003580; color: #fff; }
.mini-scores { display: flex; gap: 2px; }
.mini-bar { width: 6px; height: 24px; border-radius: 2px; display: inline-block; position: relative; }
.mini-bar-fill { position: absolute; bottom: 0; width: 100%; border-radius: 2px; background: currentColor; }
.issues-badge { background: var(--unmet); color: #fff; font-weight: 700; font-size: 11px; padding: 1px 7px; border-radius: 8px; }
.info-icons { display: flex; gap: 6px; font-size: 11px; color: var(--muted); white-space: nowrap; }
.info-icons span { display: inline-flex; align-items: center; gap: 2px; }
.info-icons svg { width: 13px; height: 13px; flex-shrink: 0; }
.amen-icons { display: flex; gap: 4px; }
.amen-icons svg { width: 14px; height: 14px; opacity: .2; }
.amen-icons svg.on { opacity: 1; color: var(--text); }
.prop-info { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 12px; margin-bottom: 12px; }
.prop-info .pi { display: flex; align-items: center; gap: 4px; color: var(--muted); }
.prop-info .pi b { color: var(--text); font-weight: 600; }
.act-btn { background: none; border: none; cursor: pointer; font-size: 16px; padding: 2px 6px; border-radius: 4px; transition: all .15s; line-height: 1; }
.like-btn { color: #d1d5db; }
.like-btn:hover { color: #ef4444; }
.like-btn.liked { color: #ef4444; }
.hide-btn { color: #d1d5db; }
.hide-btn:hover { color: #64748b; }
tr.listing-row.is-liked { background: #fef2f2; }
tr.listing-row.is-liked:hover { background: #fee2e2; }

/* EXPORT BAR */
#export-bar { position: sticky; bottom: 0; background: var(--card); border-top: 1px solid var(--border); padding: 10px 32px; display: flex; align-items: center; gap: 16px; z-index: 20; box-shadow: 0 -2px 8px rgba(0,0,0,.06); font-size: 13px; }
#export-bar .bar-counts { display: flex; gap: 16px; flex: 1; }
#export-bar .bar-count { display: flex; align-items: center; gap: 4px; }
#export-bar .bar-count span { font-weight: 600; }
#export-bar button { padding: 6px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); font-size: 12px; font-weight: 500; cursor: pointer; transition: all .15s; }
#export-bar button:hover { background: var(--text); color: #fff; }
#export-bar .show-hidden-btn { font-size: 12px; color: var(--muted); cursor: pointer; background: none; border: none; text-decoration: underline; }
.toast { position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%); background: var(--text); color: #fff; padding: 8px 20px; border-radius: 8px; font-size: 13px; z-index: 100; opacity: 0; transition: opacity .3s; pointer-events: none; }
.toast.show { opacity: 1; }

/* DETAIL PANEL */
tr.detail-row td { padding: 0; }
.detail-panel { display: flex; gap: 24px; padding: 20px 16px; background: #fafbfc; border: 1px solid var(--border); border-top: none; }
.detail-left { flex: 0 0 540px; }
.detail-right { flex: 1; min-width: 300px; }
.gallery-main { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 8px; display: block; background: #e2e8f0; }
.gallery-counter { font-size: 12px; color: var(--muted); text-align: center; margin: 6px 0; }
.thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 4px; margin-top: 6px; max-height: 280px; overflow-y: auto; }
.thumb-grid img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 4px; cursor: pointer; transition: border-color .15s; border: 2px solid transparent; }
.thumb-grid img.active { border-color: var(--shortlist); }
.detail-section { margin-bottom: 16px; }
.detail-section h4 { font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
.req-table { width: 100%; font-size: 12px; border-collapse: collapse; }
.req-table td { padding: 4px 8px; border-bottom: 1px solid var(--border); }
.req-table .req-status { font-weight: 600; text-transform: capitalize; }
.score-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.score-label { font-size: 12px; width: 100px; text-align: right; color: var(--muted); }
.score-track { flex: 1; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
.score-fill { height: 100%; border-radius: 4px; transition: width .3s; }
.score-val { font-size: 12px; font-weight: 600; width: 24px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 4px; }
.tag { font-size: 11px; padding: 2px 8px; border-radius: 12px; }
.tag-green { background: #dcfce7; color: #166534; }
.tag-orange { background: #fef3c7; color: #92400e; }
.tag-red { background: #fee2e2; color: #991b1b; }
.summary-text { font-size: 13px; line-height: 1.6; color: var(--text); }
.detail-links { font-size: 12px; display: flex; gap: 12px; margin-top: 8px; }
.detail-links a { color: var(--shortlist); }

/* AI REVIEW SECTIONS */
.ai-theme { margin-bottom: 10px; padding: 8px 12px; background: #fff; border-radius: 8px; border: 1px solid var(--border); }
.ai-theme-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.ai-theme-name { font-weight: 600; font-size: 13px; }
.ai-theme-freq { font-size: 10px; color: var(--muted); }
.ai-theme-severity { font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
.severity-low { background: #fef3c7; color: #92400e; }
.severity-medium { background: #fee2e2; color: #991b1b; }
.severity-high { background: #fca5a5; color: #7f1d1d; }
.ai-theme-desc { font-size: 12px; color: var(--text); margin-bottom: 4px; }
.ai-evidence { font-size: 11px; color: var(--muted); font-style: italic; line-height: 1.4; }
.ai-evidence::before { content: '"'; }
.ai-evidence::after { content: '"'; }
.ai-evidence-list { display: flex; flex-direction: column; gap: 2px; }
.ai-meta-row { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; margin-bottom: 12px; }
.ai-meta-item { display: flex; align-items: center; gap: 4px; }
.ai-meta-label { color: var(--muted); }
.ai-meta-value { font-weight: 600; }
.ai-score-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 12px; font-weight: 700; font-size: 13px; color: #fff; }

/* ROOM CARDS */
.room-card { display: flex; gap: 12px; padding: 8px 12px; background: #fff; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 6px; font-size: 12px; }
.room-type { font-weight: 600; font-size: 12px; text-transform: capitalize; min-width: 80px; }
.room-detail { flex: 1; color: var(--text); line-height: 1.5; }
.room-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.room-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
.cond-renovated { background: #dcfce7; color: #166534; }
.cond-modern { background: #dcfce7; color: #166534; }
.cond-good { background: #dbeafe; color: #1e40af; }
.cond-mixed { background: #fef3c7; color: #92400e; }
.cond-dated { background: #fee2e2; color: #991b1b; }
.cond-poor { background: #fca5a5; color: #7f1d1d; }

/* DETAIL TABS */
.detail-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 12px; }
.detail-tab { padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; color: var(--muted); transition: all .15s; }
.detail-tab:hover { color: var(--text); }
.detail-tab.active { color: var(--text); border-bottom-color: var(--shortlist); }
.tab-content { display: none; }
.tab-content.active { display: block; }

/* Q&A CARDS */
.qa-card { margin-bottom: 12px; padding: 10px 14px; background: #fff; border-radius: 8px; border: 1px solid var(--border); }
.qa-question { font-weight: 600; font-size: 13px; margin-bottom: 6px; color: var(--text); }
.qa-answer { font-size: 12px; line-height: 1.6; color: var(--text); margin-bottom: 6px; }
.qa-meta { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--muted); }
.qa-confidence { font-weight: 600; padding: 1px 6px; border-radius: 8px; font-size: 10px; }
.qa-conf-high { background: #dcfce7; color: #166534; }
.qa-conf-medium { background: #fef3c7; color: #92400e; }
.qa-conf-low { background: #fee2e2; color: #991b1b; }
.qa-evidence-list { margin-top: 4px; }
.qa-evidence-item { font-size: 11px; color: var(--muted); font-style: italic; line-height: 1.4; }
.qa-evidence-item::before { content: '"'; }
.qa-evidence-item::after { content: '"'; }

/* MAP */
#map-section { padding: 16px 0; }
.map-resize-handle { margin: 0 32px; height: 14px; background: var(--card); border: 1px solid var(--border); cursor: ns-resize; display: flex; align-items: center; justify-content: center; user-select: none; color: var(--muted); font-size: 16px; letter-spacing: 2px; transition: background .15s; }
.map-resize-handle:hover { background: #e2e8f0; }
.map-resize-handle:active { background: #cbd5e1; }
#map-resize-top { border-radius: 12px 12px 0 0; border-bottom: none; }
#map-resize-bottom { border-radius: 0 0 12px 12px; border-top: none; }

/* MAP MARKERS */
.map-marker { background: none; border: none; }
.marker-card { width: 64px; background: var(--card); border-radius: 8px; border: 2px solid var(--border); box-shadow: 0 2px 8px rgba(0,0,0,.15); overflow: hidden; cursor: pointer; transition: all .15s; position: relative; }
.marker-card:hover { transform: scale(1.1); z-index: 1000 !important; }
.marker-card.liked { border-color: #ef4444; }
.marker-card.active { border-color: var(--shortlist); box-shadow: 0 2px 12px rgba(59,130,246,.4); }
.marker-card .marker-photo { width: 100%; height: 44px; object-fit: cover; display: block; background: #e2e8f0; }
.marker-card .marker-price { font-size: 9px; font-weight: 700; text-align: center; padding: 2px 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
.marker-card .marker-dot { position: absolute; top: 3px; right: 3px; width: 8px; height: 8px; border-radius: 50%; border: 1px solid #fff; }

@media (max-width: 900px) {
  .detail-panel { flex-direction: column; }
  .detail-left { flex: none; width: 100%; }
  .hero-grid { gap: 12px; }
  .hero-card { min-width: 240px; }
  header, #top-picks, #filters, #table-section { padding-left: 16px; padding-right: 16px; }
}
`;
}

function getJS(): string {
  return `
(function() {
  const TIER_COLORS = {top_pick:'#22c55e',shortlist:'#3b82f6',consider:'#f59e0b',unlikely:'#ef4444',no_go:'#6b7280'};
  const STATUS_COLORS = {met:'#22c55e',partial:'#f59e0b',unmet:'#ef4444',unknown:'#9ca3af'};
  const SCORE_KEYS = ['fit','location','sleepQuality','cleanliness','modernity','valueForMoney'];
  const SCORE_LABELS = {fit:'Fit',location:'Location',sleepQuality:'Sleep',cleanliness:'Clean',modernity:'Modern',valueForMoney:'Value'};
  const IC = {
    bedroom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20H2"/><path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/><path d="M11 4H8a2 2 0 0 0-2 2v14"/><path d="M14 12h.01"/><path d="M22 20h-3"/></svg>',
    bed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/></svg>',
    bath: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="M2 12h20"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/></svg>',
    guest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    parking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/></svg>',
    elevator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1l0-14"/><path d="M10 10l2-2l2 2"/><path d="M10 14l2 2l2-2"/></svg>',
    ac: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="m17 3-3 6 1.5 3"/><path d="M2 12h6.5L10 9"/><path d="m20 10-1.5 2 1.5 2"/><path d="M22 12h-6.5L14 15"/><path d="m4 10 1.5 2L4 14"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/></svg>',
    balcony: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  };

  let sortKey = 'fitScore';
  let sortAsc = false;
  let activeTiers = new Set(['top_pick','shortlist','consider','unlikely','no_go']);
  let expandedId = null;
  const galleries = {};

  // Like/Hide state — localStorage overrides file picks, file picks seed initial state
  const STORAGE_KEY = 'reviewr_picks';
  let likedIds = new Set(INITIAL_PICKS.liked || []);
  let hiddenIds = new Set(INITIAL_PICKS.hidden || []);
  let showHidden = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) {
      if (saved.liked) likedIds = new Set(saved.liked);
      if (saved.hidden) hiddenIds = new Set(saved.hidden);
    }
  } catch {}
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ liked: [...likedIds], hidden: [...hiddenIds] }));
    updateCounts();
  }
  function updateCounts() {
    const lc = document.getElementById('liked-count');
    const hc = document.getElementById('hidden-count');
    if (lc) lc.textContent = String(likedIds.size);
    if (hc) hc.textContent = String(hiddenIds.size);
  }

  function buildRow(r, i) {
    const photo = r.photos[0] || '';
    const thumbHtml = photo ? '<img class="thumb" src="' + esc(photo) + '" loading="lazy" alt="">' : '<div class="thumb"></div>';
    const tierBadge = '<span class="tier-badge tier-' + r.tier + '">' + r.tier.replace('_',' ') + '</span>';
    const platBadge = '<span class="platform-badge platform-' + r.platform + '">' + r.platform + '</span>';

    // Mini score bars
    let scoreBars = '<div class="mini-scores" title="' + SCORE_KEYS.map(k => SCORE_LABELS[k]+': '+(r.scores[k]??'-')).join(', ') + '">';
    SCORE_KEYS.forEach(k => {
      const v = r.scores[k] ?? 0;
      const pct = (v / 10 * 100);
      const color = v >= 7 ? '#22c55e' : v >= 4 ? '#f59e0b' : '#ef4444';
      scoreBars += '<div class="mini-bar" style="background:#e2e8f0"><div class="mini-bar-fill" style="height:'+pct+'%;color:'+color+';background:'+color+'"></div></div>';
    });
    scoreBars += '</div>';

    // Requirement dots
    let reqDots = r.requirements.map(req =>
      '<span class="req-dot status-' + req.status + '" title="' + esc(req.requirement) + ': ' + req.status + '"></span>'
    ).join('');

    const issues = r.dealBreakers.length;
    const issuesHtml = issues > 0 ? '<span class="issues-badge">' + issues + '</span>' : '<span style="color:#9ca3af">0</span>';

    const isLiked = likedIds.has(r.id);
    const isHidden = hiddenIds.has(r.id);
    let html = '<tr class="listing-row' + (expandedId === r.id ? ' expanded' : '') + (isLiked ? ' is-liked' : '') + '" data-id="' + esc(r.id) + '"' + (isHidden ? ' style="opacity:.4"' : '') + '>';
    html += '<td><button class="act-btn like-btn' + (isLiked ? ' liked' : '') + '" onclick="toggleLike(event,\\''+esc(r.id)+'\\')">&#9829;</button></td>';
    html += '<td>' + (i+1) + '</td>';
    html += '<td>' + thumbHtml + '</td>';
    html += '<td>' + platBadge + ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + esc(r.title) + '</a></td>';
    html += '<td>' + tierBadge + '</td>';
    html += '<td><strong>' + r.fitScore + '</strong></td>';
    html += '<td>' + esc(r.priceTotal) + '</td>';

    // Info icons: bedrooms, beds, bathrooms + amenity flags
    let info = '<div class="info-icons">';
    if (r.bedrooms != null) info += '<span title="Bedrooms">'+IC.bedroom+r.bedrooms+'</span>';
    if (r.beds != null) info += '<span title="Beds">'+IC.bed+r.beds+'</span>';
    if (r.bathrooms != null) info += '<span title="Bathrooms">'+IC.bath+r.bathrooms+'</span>';
    if (r.capacity != null) info += '<span title="Guests">'+IC.guest+r.capacity+'</span>';
    info += '</div>';
    info += '<div class="amen-icons">';
    info += '<span title="Parking">'+IC.parking.replace('<svg','<svg class="'+(r.hasParking?'on':'')+'"')+'</span>';
    info += '<span title="Wifi">'+IC.wifi.replace('<svg','<svg class="'+(r.hasWifi?'on':'')+'"')+'</span>';
    info += '<span title="Elevator">'+IC.elevator.replace('<svg','<svg class="'+(r.hasElevator?'on':'')+'"')+'</span>';
    info += '<span title="AC">'+IC.ac.replace('<svg','<svg class="'+(r.hasAC?'on':'')+'"')+'</span>';
    info += '<span title="Balcony">'+IC.balcony.replace('<svg','<svg class="'+(r.hasBalcony?'on':'')+'"')+'</span>';
    info += '</div>';
    html += '<td>' + info + '</td>';
    html += '<td>' + scoreBars + '</td>';
    html += '<td><div class="req-dots">' + reqDots + '</div></td>';
    html += '<td>' + issuesHtml + '</td>';
    html += '<td><button class="act-btn hide-btn" onclick="toggleHide(event,\\''+esc(r.id)+'\\')">&#10005;</button></td>';
    html += '</tr>';

    if (expandedId === r.id) {
      html += '<tr class="detail-row"><td colspan="12">' + buildDetail(r) + '</td></tr>';
    }
    return html;
  }

  function render() {
    const tbody = document.getElementById('table-body');
    const likedBody = document.getElementById('liked-body');
    const likedSection = document.getElementById('liked-section');
    const filtered = [...DATA].filter(r => activeTiers.has(r.tier) && (showHidden || !hiddenIds.has(r.id)));
    filtered.sort((a,b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (sortKey === 'price') { va = parsePrice(a.priceTotal); vb = parsePrice(b.priceTotal); }
      if (sortKey === 'tier') { va = tierRank(a.tier); vb = tierRank(b.tier); }
      if (sortKey === 'title') { return sortAsc ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title); }
      if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
      return 0;
    });

    // Split into liked and rest
    const liked = filtered.filter(r => likedIds.has(r.id));
    const rest = filtered.filter(r => !likedIds.has(r.id));

    // Render liked table
    let likedHtml = '';
    liked.forEach((r, i) => { likedHtml += buildRow(r, i); });
    likedBody.innerHTML = likedHtml;
    likedSection.style.display = liked.length > 0 ? '' : 'none';

    // Render main table
    let html = '';
    rest.forEach((r, i) => { html += buildRow(r, i); });
    tbody.innerHTML = html;

    bindRowClicks();
    updateCounts();
    updateMapMarkers();
  }

  function buildThemeCard(t, type) {
    const sevClass = t.severity ? ' severity-' + t.severity : '';
    const sevBadge = t.severity ? '<span class="ai-theme-severity' + sevClass + '">' + t.severity + '</span>' : '';
    const evidence = (t.evidence || []).map(e => '<div class="ai-evidence">' + esc(e) + '</div>').join('');
    return '<div class="ai-theme">'
      + '<div class="ai-theme-header"><span class="ai-theme-name">' + esc(t.theme || t.issue || '') + '</span>' + sevBadge + '<span class="ai-theme-freq">' + esc(t.frequency || '') + '</span></div>'
      + '<div class="ai-theme-desc">' + esc(t.description || '') + '</div>'
      + (evidence ? '<div class="ai-evidence-list">' + evidence + '</div>' : '')
      + '</div>';
  }

  function scoreColor(v) { return v >= 7 ? '#22c55e' : v >= 4 ? '#f59e0b' : '#ef4444'; }

  function buildDetail(r) {
    const photoCount = r.photos.length;
    const mainSrc = photoCount > 0 ? r.photos[0] : '';
    const tid = esc(r.id);

    let thumbs = '';
    r.photos.forEach((p, i) => {
      thumbs += '<img src="' + esc(p) + '" class="' + (i===0?'active':'') + '" loading="lazy" onmouseenter="setPhoto(\\''+tid+'\\','+i+')" alt="">';
    });

    // --- TAB: Triage ---
    let reqRows = '';
    r.requirements.forEach(req => {
      reqRows += '<tr><td><span class="req-dot status-'+req.status+'" style="vertical-align:middle"></span></td>';
      reqRows += '<td>'+esc(req.requirement)+'</td>';
      reqRows += '<td style="font-size:10px;color:var(--muted)">'+req.type.replace('_',' ')+'</td>';
      reqRows += '<td class="req-status" style="color:'+STATUS_COLORS[req.status]+'">'+req.status+'</td>';
      reqRows += '<td style="font-size:10px">'+req.confidence+'</td>';
      reqRows += '<td style="font-size:11px">'+esc(req.note)+'</td></tr>';
    });

    let scoreBars = '';
    SCORE_KEYS.forEach(k => {
      const v = r.scores[k] ?? 0;
      const pct = v / 10 * 100;
      const color = scoreColor(v);
      scoreBars += '<div class="score-bar-row"><span class="score-label">'+SCORE_LABELS[k]+'</span><div class="score-track"><div class="score-fill" style="width:'+pct+'%;background:'+color+'"></div></div><span class="score-val">'+v+'</span></div>';
    });

    const highlights = r.highlights.map(h => '<span class="tag tag-green">'+esc(h)+'</span>').join('');
    const concerns = r.concerns.map(c => '<span class="tag tag-orange">'+esc(c)+'</span>').join('');
    const dealBreakers = r.dealBreakers.map(d => '<span class="tag tag-red">'+esc(d)+'</span>').join('');

    let tabTriage = '<div class="prop-info">'
      + '<div class="pi">Price: <b>' + esc(r.priceTotal) + '</b> (' + esc(r.pricePerNight) + '/n)</div>'
      + (r.bedrooms != null ? '<div class="pi">Bedrooms: <b>' + r.bedrooms + '</b></div>' : '')
      + (r.beds != null ? '<div class="pi">Beds: <b>' + r.beds + '</b></div>' : '')
      + (r.bathrooms != null ? '<div class="pi">Baths: <b>' + r.bathrooms + '</b></div>' : '')
      + (r.capacity != null ? '<div class="pi">Guests: <b>' + r.capacity + '</b></div>' : '')
      + (r.checkInTime ? '<div class="pi">Check-in: <b>' + esc(r.checkInTime) + '</b></div>' : '')
      + (r.checkOutTime ? '<div class="pi">Check-out: <b>' + esc(r.checkOutTime) + '</b></div>' : '')
      + (r.hasParking ? '<div class="pi">Parking: <b>Yes</b></div>' : '')
      + (r.hasElevator ? '<div class="pi">Elevator: <b>Yes</b></div>' : '')
      + (r.hasBalcony ? '<div class="pi">Balcony/Terrace: <b>Yes</b></div>' : '')
      + '</div>'
      + '<div class="detail-section" style="margin-bottom:8px"><p style="font-size:12px;color:var(--muted)">' + esc(r.bedSetup) + '</p></div>'
      + '<div class="detail-section"><h4>Requirements</h4><table class="req-table">' + reqRows + '</table></div>'
      + '<div class="detail-section"><h4>Scores</h4>' + scoreBars + '</div>'
      + (highlights ? '<div class="detail-section"><h4>Highlights</h4><div class="tag-list">' + highlights + '</div></div>' : '')
      + (concerns ? '<div class="detail-section"><h4>Concerns</h4><div class="tag-list">' + concerns + '</div></div>' : '')
      + (dealBreakers ? '<div class="detail-section"><h4>Deal Breakers</h4><div class="tag-list">' + dealBreakers + '</div></div>' : '')
      + '<div class="detail-section"><h4>Summary</h4><p class="summary-text">' + esc(r.summary) + '</p></div>';

    // --- TAB: Reviews (AI) ---
    let tabReviews = '';
    const hasAiReviews = r.aiStrengths.length > 0 || r.aiWeaknesses.length > 0;
    if (hasAiReviews) {
      // AI summary score
      if (r.aiSummaryScore) {
        const sc = r.aiSummaryScore.score;
        tabReviews += '<div class="ai-meta-row">'
          + '<div class="ai-meta-item"><span class="ai-score-pill" style="background:'+scoreColor(sc)+'">'+sc+'/10</span></div>'
          + '<div class="ai-meta-item" style="flex:1"><span class="summary-text">' + esc(r.aiSummaryScore.justification) + '</span></div>'
          + '</div>';
      }

      // Overall sentiment
      if (r.aiOverallSentiment) {
        tabReviews += '<div class="detail-section"><h4>Overall Sentiment</h4><p class="summary-text">' + esc(r.aiOverallSentiment) + '</p></div>';
      }

      // Strengths
      if (r.aiStrengths.length > 0) {
        tabReviews += '<div class="detail-section"><h4>Strengths</h4>';
        r.aiStrengths.forEach(s => { tabReviews += buildThemeCard(s, 'strength'); });
        tabReviews += '</div>';
      }

      // Weaknesses
      if (r.aiWeaknesses.length > 0) {
        tabReviews += '<div class="detail-section"><h4>Weaknesses</h4>';
        r.aiWeaknesses.forEach(w => { tabReviews += buildThemeCard(w, 'weakness'); });
        tabReviews += '</div>';
      }

      // Red flags
      if (r.aiRedFlags.length > 0) {
        tabReviews += '<div class="detail-section"><h4>Red Flags</h4>';
        r.aiRedFlags.forEach(f => { tabReviews += buildThemeCard(f, 'redflag'); });
        tabReviews += '</div>';
      }

      // AI Deal breakers
      if (r.aiDealBreakers.length > 0) {
        tabReviews += '<div class="detail-section"><h4>Deal Breakers (from reviews)</h4>';
        r.aiDealBreakers.forEach(d => { tabReviews += buildThemeCard(d, 'dealbreaker'); });
        tabReviews += '</div>';
      }

      // Demographics & Trends
      if (r.aiGuestDemographics || r.aiTrends) {
        tabReviews += '<div class="detail-section"><h4>Guest Profile & Trends</h4>';
        if (r.aiGuestDemographics) tabReviews += '<p class="summary-text" style="margin-bottom:4px">' + esc(r.aiGuestDemographics) + '</p>';
        if (r.aiTrends) tabReviews += '<p class="summary-text" style="color:var(--muted);font-style:italic">' + esc(r.aiTrends) + '</p>';
        tabReviews += '</div>';
      }
    } else {
      tabReviews = '<p style="color:var(--muted);font-size:13px">No AI review analysis available for this listing.</p>';
    }

    // --- TAB: Q&A ---
    let tabQA = '';
    if (r.qaEntries && r.qaEntries.length > 0) {
      r.qaEntries.forEach(qa => {
        const confClass = 'qa-conf-' + (qa.confidence || 'medium');
        const evidence = (qa.evidence || []).map(e => '<div class="qa-evidence-item">' + esc(e) + '</div>').join('');
        tabQA += '<div class="qa-card">'
          + '<div class="qa-question">' + esc(qa.question) + '</div>'
          + '<div class="qa-answer">' + esc(qa.answer) + '</div>'
          + (evidence ? '<div class="qa-evidence-list">' + evidence + '</div>' : '')
          + '<div class="qa-meta"><span class="qa-confidence ' + confClass + '">' + esc(qa.confidence || 'medium') + '</span>'
          + (qa.askedAt ? '<span>' + esc(qa.askedAt.split('T')[0]) + '</span>' : '')
          + '</div></div>';
      });
    }

    // Build tabs
    const tabs = [
      { key: 'triage', label: 'Triage', content: tabTriage },
      { key: 'reviews', label: 'Reviews AI', content: tabReviews },
    ];
    if (r.qaEntries && r.qaEntries.length > 0) {
      tabs.push({ key: 'qa', label: 'Q&A (' + r.qaEntries.length + ')', content: tabQA });
    }

    let tabBar = '<div class="detail-tabs">';
    let tabPanels = '';
    tabs.forEach((t, i) => {
      tabBar += '<div class="detail-tab' + (i===0?' active':'') + '" data-tab="'+t.key+'-'+tid+'" onclick="switchTab(this,\\''+t.key+'-'+tid+'\\')">'+t.label+'</div>';
      tabPanels += '<div class="tab-content' + (i===0?' active':'') + '" id="tab-'+t.key+'-'+tid+'">' + t.content + '</div>';
    });
    tabBar += '</div>';

    return '<div class="detail-panel">'
      + '<div class="detail-left">'
      + (mainSrc ? '<img class="gallery-main" id="gallery-img-'+tid+'" src="'+esc(mainSrc)+'" alt="">' : '<div class="gallery-main" style="display:flex;align-items:center;justify-content:center;color:var(--muted)">No photos</div>')
      + '<div class="gallery-counter" id="gallery-counter-'+tid+'">'+(photoCount > 0 ? '1 / '+photoCount : '')+'</div>'
      + '<div class="thumb-grid" id="thumb-strip-'+tid+'">' + thumbs + '</div>'
      + '</div>'
      + '<div class="detail-right">'
      + tabBar + tabPanels
      + '<div class="detail-links"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">Source ↗</a></div>'
      + '</div></div>';
  }

  function bindRowClicks() {
    document.querySelectorAll('tr.listing-row').forEach(tr => {
      tr.onclick = function(e) {
        if (e.target.tagName === 'A') return;
        const id = this.dataset.id;
        expandedId = expandedId === id ? null : id;
        if (expandedId) galleries[id] = 0;
        render();
        if (expandedId) {
          const row = document.querySelector('tr.detail-row');
          if (row) row.scrollIntoView({behavior:'smooth', block:'nearest'});
        }
      };
    });
  }

  // Tab switching
  window.switchTab = function(el, tabKey) {
    const panel = el.closest('.detail-panel') || el.closest('.detail-right');
    if (!panel) return;
    panel.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
    panel.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    const target = document.getElementById('tab-' + tabKey);
    if (target) target.classList.add('active');
  };

  // Gallery navigation
  window.navPhoto = function(id, dir) {
    const r = DATA.find(d => d.id === id);
    if (!r || r.photos.length === 0) return;
    let idx = (galleries[id] || 0) + dir;
    if (idx < 0) idx = r.photos.length - 1;
    if (idx >= r.photos.length) idx = 0;
    setPhotoIdx(id, idx, r);
  };
  window.setPhoto = function(id, idx) {
    const r = DATA.find(d => d.id === id);
    if (r) setPhotoIdx(id, idx, r);
  };
  function setPhotoIdx(id, idx, r) {
    galleries[id] = idx;
    const img = document.getElementById('gallery-img-'+id);
    if (img) img.src = r.photos[idx];
    const counter = document.getElementById('gallery-counter-'+id);
    if (counter) counter.textContent = (idx+1) + ' / ' + r.photos.length;
    const strip = document.getElementById('thumb-strip-'+id);
    if (strip) {
      strip.querySelectorAll('img').forEach((t,i) => t.classList.toggle('active', i===idx));
      const activeThumb = strip.children[idx];
      if (activeThumb) activeThumb.scrollIntoView({behavior:'smooth', block:'nearest', inline:'center'});
    }
  }

  // Sorting
  document.querySelectorAll('th.sortable').forEach(th => {
    th.onclick = function() {
      const key = this.dataset.sort;
      if (key === sortKey) { sortAsc = !sortAsc; }
      else { sortKey = key; sortAsc = false; }
      document.querySelectorAll('th.sortable').forEach(t => { t.classList.remove('active-sort','asc'); });
      this.classList.add('active-sort');
      if (sortAsc) this.classList.add('asc');
      render();
    };
  });

  // Tier filters
  document.querySelectorAll('.tier-btn').forEach(btn => {
    btn.onclick = function() {
      const tier = this.dataset.tier;
      if (activeTiers.has(tier)) activeTiers.delete(tier); else activeTiers.add(tier);
      this.classList.toggle('active');
      render();
    };
  });

  // Scroll to row from hero card
  window.scrollToRow = function(id) {
    expandedId = id;
    galleries[id] = 0;
    render();
    const row = document.querySelector('tr.listing-row[data-id="'+id+'"]');
    if (row) row.scrollIntoView({behavior:'smooth', block:'start'});
  };

  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (!expandedId) return;
    if (e.key === 'Escape') { expandedId = null; render(); }
  });

  // Like / Hide / Export
  window.toggleLike = function(e, id) {
    e.stopPropagation();
    if (likedIds.has(id)) { likedIds.delete(id); }
    else { likedIds.add(id); hiddenIds.delete(id); }
    saveState(); render();
  };
  window.toggleHide = function(e, id) {
    e.stopPropagation();
    if (hiddenIds.has(id)) { hiddenIds.delete(id); }
    else { hiddenIds.add(id); likedIds.delete(id); }
    saveState(); render();
  };
  window.toggleShowHidden = function() {
    showHidden = !showHidden;
    const btn = document.getElementById('toggle-hidden-btn');
    if (btn) btn.textContent = showHidden ? 'Hide hidden' : 'Show hidden';
    render();
  };
  function buildExport(which) {
    const pick = (id) => { const r = DATA.find(d => d.id === id); return r ? { id: r.id, platform: r.platform, url: r.url, title: r.title, fitScore: r.fitScore, tier: r.tier, priceTotal: r.priceTotal, pricePerNight: r.pricePerNight } : { id }; };
    if (which === 'liked') return { liked: [...likedIds].map(pick) };
    if (which === 'hidden') return { hidden: [...hiddenIds].map(pick) };
    return { liked: [...likedIds].map(pick), hidden: [...hiddenIds].map(pick) };
  }
  window.copyList = function(which) {
    const json = JSON.stringify(buildExport(which), null, 2);
    navigator.clipboard.writeText(json).then(() => showToast('Copied to clipboard')).catch(() => {
      // fallback
      const ta = document.createElement('textarea'); ta.value = json; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      showToast('Copied to clipboard');
    });
  };
  window.savePicks = function() {
    const json = JSON.stringify({ liked: [...likedIds], hidden: [...hiddenIds] }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'picks.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Downloaded picks.json — save to your data directory');
  };
  function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
  }

  function esc(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function parsePrice(s) { if (!s) return 99999; const m = s.replace(/[^0-9.]/g,''); return m ? parseFloat(m) : 99999; }
  function tierRank(t) { return {top_pick:0,shortlist:1,consider:2,unlikely:3,no_go:4}[t] ?? 5; }

  // --- MAP ---
  let map = null;
  const markers = {};
  let activeMarkerId = null;

  function initMap() {
    const withCoords = DATA.filter(r => r.lat != null && r.lng != null);
    if (withCoords.length === 0) {
      const sec = document.getElementById('map-section');
      if (sec) sec.style.display = 'none';
      return;
    }

    map = L.map('map', { scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    const bounds = [];
    withCoords.forEach(r => {
      const photo = r.photos[0] || '';
      const isLiked = likedIds.has(r.id);
      const tierColor = TIER_COLORS[r.tier] || '#6b7280';
      const html = '<div class="marker-card' + (isLiked ? ' liked' : '') + '" data-id="' + r.id + '">'
        + (photo ? '<img class="marker-photo" src="' + esc(photo) + '" alt="">' : '<div class="marker-photo"></div>')
        + '<div class="marker-price">' + esc(r.priceTotal) + '</div>'
        + '<div class="marker-dot" style="background:' + tierColor + '"></div>'
        + '</div>';

      const icon = L.divIcon({ className: 'map-marker', html: html, iconSize: [64, 62], iconAnchor: [32, 62] });
      const marker = L.marker([r.lat, r.lng], { icon: icon }).addTo(map);
      marker.on('click', function() {
        window.scrollToRow(r.id);
        setActiveMarker(r.id);
      });
      markers[r.id] = { marker: marker, data: r };
      bounds.push([r.lat, r.lng]);
    });

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
    updateMapMarkers();

    // Resize handles
    const mapEl = document.getElementById('map');
    function attachResize(handleId, direction) {
      const handle = document.getElementById(handleId);
      if (!handle || !mapEl) return;
      let startY, startH;
      handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        startY = e.clientY;
        startH = mapEl.offsetHeight;
        function onMove(e) {
          const delta = (e.clientY - startY) * direction;
          const h = Math.max(200, startH + delta);
          mapEl.style.height = h + 'px';
          map.invalidateSize();
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
    attachResize('map-resize-top', -1);
    attachResize('map-resize-bottom', 1);
  }

  function setActiveMarker(id) {
    if (activeMarkerId && markers[activeMarkerId]) {
      const el = markers[activeMarkerId].marker.getElement();
      if (el) { const card = el.querySelector('.marker-card'); if (card) card.classList.remove('active'); }
    }
    activeMarkerId = id;
    if (id && markers[id]) {
      const el = markers[id].marker.getElement();
      if (el) { const card = el.querySelector('.marker-card'); if (card) card.classList.add('active'); }
    }
  }

  function updateMapMarkers() {
    if (!map) return;
    Object.keys(markers).forEach(id => {
      const m = markers[id];
      const r = m.data;
      const visible = activeTiers.has(r.tier) && (showHidden || !hiddenIds.has(r.id));
      if (visible && !map.hasLayer(m.marker)) m.marker.addTo(map);
      else if (!visible && map.hasLayer(m.marker)) map.removeLayer(m.marker);

      // Update liked styling
      const el = m.marker.getElement();
      if (el) {
        const card = el.querySelector('.marker-card');
        if (card) {
          card.classList.toggle('liked', likedIds.has(id));
        }
      }
    });
  }

  // Override scrollToRow to also highlight marker
  const origScrollToRow = window.scrollToRow;
  window.scrollToRow = function(id) {
    origScrollToRow(id);
    setActiveMarker(id);
    if (markers[id] && map) {
      map.panTo(markers[id].marker.getLatLng(), { animate: true });
    }
  };

  render();
  initMap();
})();
`;
}

// --- Standalone execution ---
const scriptPath = process.argv[1];
if (scriptPath && (scriptPath.endsWith('/report.js') || scriptPath.endsWith('/report.ts'))) {
  const dir = process.argv[2] || 'data';
  generateReport({ outputDir: dir }).then(f => console.log(`Done: ${f}`)).catch(e => { console.error(e); process.exit(1); });
}
