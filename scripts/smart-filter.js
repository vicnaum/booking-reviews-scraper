const fs = require("fs");
const path = require("path");
const dir = "data/airbnb/output/rome-listings";
const files = fs.readdirSync(dir).filter(f => f.startsWith("listing_") && f.endsWith(".json"));

const results = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
  const title = (d.title || "").toLowerCase();
  const desc = (d.description || "").toLowerCase();
  const combined = title + " " + desc;

  // Extract bedrooms from title/description
  let inferredBedrooms = null;
  const brMatch = combined.match(/(\d)\s*(?:br|bdr|bed\s*room|bedroom)/);
  if (brMatch) inferredBedrooms = parseInt(brMatch[1]);
  if (combined.includes("two-bedroom") || combined.includes("two bedroom") || combined.includes("2-bedroom")) inferredBedrooms = 2;
  if (combined.includes("three-bedroom") || combined.includes("three bedroom") || combined.includes("3-bedroom")) inferredBedrooms = 3;
  if (combined.includes("studio") && !inferredBedrooms) inferredBedrooms = 0;

  // Check for double/queen/king bed in desc
  const hasDoubleBed = /double bed|queen bed|king bed|king-size|queen-size|matrimonial|letto matrimon/i.test(combined);
  // Check for sofa bed
  const hasSofaBed = /sofa bed|sofa-bed|pull-out|divano letto|sofabed/i.test(combined);
  // Check for separate room for daughter
  const hasSeparateRoom = /separate room|second bedroom|2nd bedroom|living room.*bed|divano.*letto/i.test(combined);

  const amenityNames = (d.amenities || []).map(a => (a.name || "").toLowerCase());
  const hasBalcony = amenityNames.some(a => /balcon|terrace|patio/i.test(a));
  const hasAC = amenityNames.some(a => /air condition|a\/c/i.test(a));
  const hasHeating = amenityNames.some(a => /heating|heat/i.test(a));

  // Floor
  let floor = null;
  const floorMatch = desc.match(/(\d+)(?:st|nd|rd|th)\s*floor/);
  if (floorMatch) floor = floorMatch[1];
  if (desc.includes("penthouse")) floor = "penthouse";
  if (desc.includes("top floor")) floor = "top";
  if (desc.includes("ground floor")) floor = "ground";

  const bedrooms = d.bedrooms || inferredBedrooms;
  const isPromising = (bedrooms && bedrooms >= 2) || (d.capacity >= 4 && (hasDoubleBed || hasSofaBed || hasSeparateRoom));

  results.push({
    id: d.id,
    title: d.title,
    url: d.url,
    cap: d.capacity,
    bedrooms: d.bedrooms,
    inferredBedrooms,
    beds: d.beds,
    rating: d.rating,
    reviews: d.reviewCount,
    hasDoubleBed,
    hasSofaBed,
    hasSeparateRoom,
    hasBalcony,
    hasAC,
    hasHeating,
    floor,
    isPromising,
    desc: (d.description || "").substring(0, 300),
  });
}

// Sort: promising first, then by rating
results.sort((a, b) => {
  if (a.isPromising && !b.isPromising) return -1;
  if (!a.isPromising && b.isPromising) return 1;
  return (b.rating || 0) - (a.rating || 0);
});

console.log("=== PROMISING AIRBNB LISTINGS (likely 2+ bedrooms or separate sleeping areas) ===\n");
const promising = results.filter(r => r.isPromising);
for (const r of promising) {
  console.log(`${r.title} (${r.id})`);
  console.log(`  URL: ${r.url}`);
  console.log(`  Bedrooms: ${r.bedrooms || "?"} (inferred: ${r.inferredBedrooms || "?"}), Cap: ${r.cap}, Beds: ${r.beds || "?"}`);
  console.log(`  Rating: ${r.rating || "?"} (${r.reviews || 0} reviews)`);
  console.log(`  Double: ${r.hasDoubleBed}, Sofa: ${r.hasSofaBed}, SepRoom: ${r.hasSeparateRoom}`);
  console.log(`  Balcony: ${r.hasBalcony}, AC: ${r.hasAC}, Heat: ${r.hasHeating}, Floor: ${r.floor || "?"}`);
  console.log(`  Desc: ${r.desc}...`);
  console.log();
}

console.log(`\n=== MAYBE (capacity >= 4 but no bedroom info) ===\n`);
const maybe = results.filter(r => !r.isPromising && r.cap >= 4);
for (const r of maybe) {
  console.log(`  ${r.title} (cap=${r.cap}, rating=${r.rating || "?"}, reviews=${r.reviews || 0}) ${r.url}`);
}

console.log(`\n=== REJECTED (capacity < 4 or studio) ===\n`);
const rejected = results.filter(r => !r.isPromising && r.cap < 4);
for (const r of rejected) {
  console.log(`  ${r.title} (cap=${r.cap})`);
}

console.log(`\nTotal: ${results.length}, Promising: ${promising.length}, Maybe: ${maybe.length}, Rejected: ${rejected.length}`);
