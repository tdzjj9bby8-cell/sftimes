/**
 * scripts/lib/geo-filter.ts
 *
 * Keep out-of-region wire copy out of the day's field.
 *
 * WHY THIS EXISTS
 * Several outlets in the source list are local front-ends on national content
 * networks. Hoodline and ABC7 both publish under their own domain, so the
 * host filter in brief-ingest passes them, and on 2026-09-09 the editor had to
 * hand-reject four stories out of roughly fourteen: a Harris County public
 * defender, a DeKalb County homicide, UK air traffic control, and a Temple
 * University gift. Nearly a third of the field, each one having consumed a
 * full article download and a slot the editor had to read.
 *
 * TWO STAGES, AND THE DIFFERENCE MATTERS
 *
 *   isLikelyOutOfRegion()  runs BEFORE the fetch, on the headline and dek.
 *                          Drops only on POSITIVE evidence of somewhere else:
 *                          a named non-California state, a foreign country, a
 *                          wire dateline. Never on the absence of Bay Area
 *                          words, because a headline can be local and name no
 *                          place at all. This is what buys back fetch budget.
 *
 *   mentionsBayArea()      runs AFTER the fetch, on the full body. A genuine
 *                          Bay Area story names a Bay Area place somewhere in
 *                          800 words. Failing this does NOT delete the
 *                          candidate; it moves it to a separate section of the
 *                          work packet for the editor to judge.
 *
 * The asymmetry is deliberate. Deleting a true local story to save a download
 * is a worse outcome than downloading a story we end up rejecting, so the
 * cheap stage is strict about evidence and the expensive stage only sorts.
 */

/** Bay Area place names, agencies and institutions. Lowercase, matched as
 *  whole words. Deliberately broad: this list is used to CONFIRM a story is
 *  local, so a missing entry costs a demotion, not a deletion. */
const BAY_AREA_TERMS = [
  // Counties
  'san francisco', 'alameda county', 'contra costa', 'san mateo', 'santa clara',
  'marin county', 'sonoma', 'napa', 'solano county',
  // Cities and towns
  'oakland', 'berkeley', 'san jose', 'san josé', 'fremont', 'hayward', 'richmond',
  'alameda', 'emeryville', 'albany', 'san leandro', 'castro valley', 'pleasanton',
  'livermore', 'dublin', 'danville', 'walnut creek', 'concord', 'antioch',
  'pittsburg', 'martinez', 'brentwood', 'oakley', 'san ramon', 'orinda',
  'lafayette', 'moraga', 'el cerrito', 'pinole', 'hercules', 'vallejo', 'benicia',
  'palo alto', 'east palo alto', 'menlo park', 'redwood city', 'mountain view',
  'sunnyvale', 'santa clara', 'cupertino', 'milpitas', 'campbell', 'saratoga',
  'los gatos', 'morgan hill', 'gilroy', 'san mateo', 'burlingame', 'daly city',
  'south san francisco', 'san bruno', 'millbrae', 'foster city', 'belmont',
  'san carlos', 'atherton', 'woodside', 'half moon bay', 'pacifica', 'brisbane',
  'san rafael', 'novato', 'sausalito', 'mill valley', 'petaluma', 'santa rosa',
  'fairfield', 'union city', 'newark', 'san pablo', 'el sobrante',
  // SF neighborhoods
  'mission district', 'tenderloin', 'bayview', 'hunters point', 'sunset district',
  'richmond district', 'soma', 'castro', 'haight', 'chinatown', 'north beach',
  'potrero hill', 'excelsior', 'noe valley', 'fillmore', 'presidio', 'dogpatch',
  'nob hill', 'russian hill', 'japantown', 'outer sunset', 'bernal heights',
  // Agencies, institutions, landmarks
  'bart', 'muni', 'sfmta', 'caltrain', 'ac transit', 'vta', 'samtrans',
  'golden gate bridge', 'bay bridge', 'sfo', 'oakland airport', 'san jose airport',
  'uc berkeley', 'stanford', 'ucsf', 'san francisco state', 'san jose state',
  'board of supervisors', 'bay area', 'east bay', 'south bay', 'north bay',
  'peninsula', 'silicon valley', 'the bay',
];

/** US states other than California. A headline naming one is strong evidence
 *  the story is not ours. "Washington" is excluded on purpose: it means the
 *  federal government far more often than the state, and federal policy stories
 *  are legitimately Bay Area news. */
const NON_CA_STATES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'colorado', 'connecticut',
  'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana',
  'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland',
  'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana',
  'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york',
  'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
  'vermont', 'virginia', 'west virginia', 'wisconsin', 'wyoming',
];

/** Large non-California cities and out-of-region markers that appear in wire
 *  headlines. Kept to unambiguous names; anything that is also a California
 *  place or a common word is left out. */
const NON_CA_PLACES = [
  'new york city', 'nyc', 'manhattan', 'brooklyn', 'queens', 'the bronx',
  'chicago', 'houston', 'harris county', 'dallas', 'austin', 'phoenix',
  'philadelphia', 'atlanta', 'dekalb county', 'miami', 'boston', 'seattle',
  'burien', 'tacoma', 'spokane', 'portland', 'denver', 'las vegas', 'detroit',
  'minneapolis', 'st. louis', 'baltimore', 'nashville', 'memphis',
  'new orleans', 'salt lake city', 'kansas city', 'milwaukee', 'cleveland',
  'cincinnati', 'pittsburgh', 'orlando', 'tampa', 'charlotte', 'honolulu',
  'anchorage', 'albuquerque', 'tucson', 'omaha', 'indianapolis', 'columbus',
  'temple university', 'rutgers', 'penn state', 'ohio state',
];

/** Countries and regions outside the United States. */
const FOREIGN = [
  // Abbreviations matter: the real headline that slipped through was "...After
  // Fleeing to UK", which the spelled-out entries below do not match.
  'uk', 'u.k.', 'eu', 'e.u.', 'uae', 'nato',
  'united kingdom', 'britain', 'british', 'england', 'scotland', 'wales',
  'ireland', 'france', 'french', 'germany', 'german', 'spain', 'spanish government',
  'italy', 'russia', 'ukraine', 'china', 'chinese government', 'japan', 'india',
  'pakistan', 'israel', 'gaza', 'iran', 'iraq', 'syria', 'afghanistan', 'canada',
  'mexico city', 'brazil', 'australia', 'new zealand', 'south korea', 'north korea',
  'nigeria', 'kenya', 'egypt', 'turkey', 'poland', 'sweden', 'norway', 'denmark',
  'netherlands', 'belgium', 'switzerland', 'austria', 'greece', 'portugal',
];

function hasTerm(haystack: string, terms: string[]): string | null {
  for (const t of terms) {
    // Whole-word match. Escaped because some entries contain a period.
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(haystack)) return t;
  }
  return null;
}

export interface RegionVerdict {
  outOfRegion: boolean;
  /** The term that triggered it, for the run log. Never guessed. */
  reason?: string;
}

/**
 * Pre-fetch screen on headline and dek only.
 *
 * Returns true ONLY on positive evidence of somewhere else. A local story that
 * names no place still passes, which is the intended bias: this stage exists to
 * avoid downloading obvious wire copy, not to decide what is newsworthy.
 *
 * A Bay Area term anywhere in the text overrides the out-of-region signal,
 * because "Bay Area firm sued in Texas" is our story.
 */
export function isLikelyOutOfRegion(headline: string, dek = ''): RegionVerdict {
  const text = `${headline} ${dek}`.toLowerCase();
  if (!text.trim()) return { outOfRegion: false };

  // Local reference wins. Always.
  if (hasTerm(text, BAY_AREA_TERMS)) return { outOfRegion: false };

  // Wire dateline: "HOUSTON -- " or "NEW YORK CITY --" at the start.
  const dateline = /^\s*([A-Z][A-Z .'-]{2,30})\s+(--|—|-)\s/.exec(`${headline} ${dek}`);
  if (dateline) {
    const place = dateline[1].trim().toLowerCase();
    if (!hasTerm(place, BAY_AREA_TERMS)) {
      return { outOfRegion: true, reason: `dateline "${dateline[1].trim()}"` };
    }
  }

  for (const [label, list] of [
    ['state', NON_CA_STATES],
    ['place', NON_CA_PLACES],
    ['country', FOREIGN],
  ] as const) {
    const hit = hasTerm(text, list);
    if (hit) return { outOfRegion: true, reason: `${label} "${hit}"` };
  }

  return { outOfRegion: false };
}

/**
 * Post-fetch check on the full body.
 *
 * A real Bay Area story names a Bay Area place somewhere in several hundred
 * words. This is a sorting signal for the work packet, NOT grounds for
 * deletion: a statewide policy story with genuine local consequence can be
 * written without naming a city, and that judgment belongs to the editor.
 */
export function mentionsBayArea(body: string): boolean {
  return hasTerm(body.toLowerCase(), BAY_AREA_TERMS) !== null;
}
