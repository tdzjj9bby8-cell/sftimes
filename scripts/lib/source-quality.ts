/**
 * scripts/lib/source-quality.ts
 *
 * Judge what a source IS, not just that it exists.
 *
 * WHY THIS EXISTS
 * The multi-source floor in article-firewall.ts stops the obvious failure: an
 * "article" that is a rewrite of one other outlet's reporting. It counts
 * distinct sources. On the very first real research run it was satisfied by
 * four sources, three of which were travel-guide and SEO content, and one of
 * which read as machine-generated listicle copy.
 *
 * Every check downstream would have passed. Every number would have traced to a
 * source. Every quotation would have been verbatim. And the output would have
 * been a tourist blog post under the SF Times byline, which is precisely the
 * outcome the whole pipeline exists to prevent. A floor that counts sources
 * without weighing them is not a quality control, it is a formality.
 *
 * WHAT COUNTS AS LOAD-BEARING
 *   journalism  a newsroom with an masthead and corrections policy
 *   primary     the subject speaking for itself, or a public record: .gov,
 *               .edu, court filings, an organization's own site, an archive
 *
 * Everything else — aggregators, tour guides, listicles, review sites, content
 * farms — is SUPPORTING. It may add colour and detail. It may not be the basis
 * of a piece. That is the whole distinction.
 *
 * This list is necessarily incomplete and always will be. An unrecognized
 * newsroom is classified as supporting, which is the safe direction: it makes
 * the gate stricter than it should be rather than looser, and the fix is to
 * add the domain.
 */

/** Newsrooms. Bay Area first, then national and wire. */
const JOURNALISM_DOMAINS = [
  // Bay Area
  'sfchronicle.com', 'sfstandard.com', 'missionlocal.org', 'kqed.org', 'sfist.com',
  '48hills.org', 'sfpublicpress.org', 'thefrisc.com', 'sfexaminer.com', 'sfgate.com',
  'berkeleyside.org', 'berkeleyscanner.com', 'oaklandside.org', 'oaklandnorth.net',
  'richmondside.org', 'alamedapost.com', 'sanjosespotlight.com', 'mercurynews.com',
  'eastbaytimes.com', 'paloaltoonline.com', 'mv-voice.com', 'almanacnews.com',
  'padailypost.com', 'pleasantonweekly.com', 'contracostaherald.com', 'marinij.com',
  'pressdemocrat.com', 'napavalleyregister.com', 'smdailyjournal.com', 'ebar.com',
  'eltecolote.org', 'sfbayview.com', 'localnewsmatters.org', 'calmatters.org',
  'abc7news.com', 'nbcbayarea.com', 'ktvu.com', 'kron4.com', 'cbsnews.com',
  'sfweekly.com', 'sfgov.org', 'streetsblog.org', 'sf.streetsblog.org',
  'hoodline.com', 'eater.com', 'sf.eater.com', 'vallejosun.com', 'santacruzlocal.org',
  'lookout.co', 'bayareanewsgroup.com', 'sfbaytimes.com', 'bayarearidercom',
  // National and wire
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'latimes.com', 'apnews.com',
  'reuters.com', 'npr.org', 'pbs.org', 'bbc.com', 'bbc.co.uk', 'theguardian.com',
  'propublica.org', 'theatlantic.com', 'newyorker.com', 'bloomberg.com',
  'politico.com', 'axios.com', 'usatoday.com', 'nbcnews.com', 'cbsnews.com',
  'abcnews.go.com', 'cnn.com', 'time.com', 'fastcompany.com', 'wired.com',
  'sciencemag.org', 'nature.com', 'statnews.com', 'themarshallproject.org',
  'citylab.com', 'bloomberg.com', 'curbed.com', 'atlasobscura.com',
  'smithsonianmag.com', 'nationalgeographic.com', 'kalw.org', 'kcbs.radio.com',
];

/** Domain suffixes that indicate a primary or institutional source. */
const PRIMARY_SUFFIXES = ['.gov', '.mil', '.edu', '.ca.gov', '.us'];

/** Institutional and archival hosts that count as primary. */
const PRIMARY_DOMAINS = [
  'courtlistener.com', 'pacer.gov', 'archive.org', 'loc.gov', 'census.gov',
  'sfplanning.org', 'sfmta.com', 'bart.gov', 'acgov.org', 'sccgov.org',
  'smcgov.org', 'cccounty.us', 'oaklandca.gov', 'sanjoseca.gov', 'berkeleyca.gov',
  'foundsf.org', 'calisphere.org', 'oac.cdlib.org', 'sfhistory.org',
];

/** Hosts and patterns that are explicitly NOT load-bearing, however useful.
 *  Listed so the classification is auditable rather than a silent default. */
const KNOWN_SUPPORTING = [
  'tripadvisor.com', 'yelp.com', 'freetoursbyfoot.com', 'sftourismtips.com',
  'fastfoodclub.com', 'thetakeout.com', 'factorytoursguide.com', 'indagare.com',
  'afar.com', 'timeout.com', 'thrillist.com', 'medium.com', 'substack.com',
  'reddit.com', 'quora.com', 'pinterest.com', 'facebook.com', 'instagram.com',
  'x.com', 'twitter.com', 'linkedin.com', 'youtube.com', 'tiktok.com',
  'wikipedia.org', 'wikiwand.com', 'fandom.com', 'blogspot.com', 'wordpress.com',
];

export type SourceTier = 'journalism' | 'primary' | 'supporting';

/**
 * Minimum load-bearing sources. Journalism or primary, not supporting.
 *
 * Two rather than three deliberately. Three would block legitimate pieces about
 * subjects that only one newsroom has covered plus a public record, which is a
 * common and perfectly good shape for a local feature. Two forces corroboration
 * without demanding a press pile-on.
 */
export const MIN_LOAD_BEARING_SOURCES = 2;

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function classifySource(url: string): SourceTier {
  const host = hostOf(url);
  if (!host) return 'supporting';

  const matches = (list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

  // Explicit supporting first, so a content farm on a .org cannot slip through.
  if (matches(KNOWN_SUPPORTING)) return 'supporting';

  if (matches(PRIMARY_DOMAINS)) return 'primary';
  if (PRIMARY_SUFFIXES.some((s) => host.endsWith(s))) return 'primary';
  if (matches(JOURNALISM_DOMAINS)) return 'journalism';

  // Unrecognized. Classified as supporting on purpose: the safe direction is a
  // gate that is too strict, because the failure mode of "too loose" is a
  // published article built on content-farm copy.
  return 'supporting';
}

export interface SourceQualityVerdict {
  pass: boolean;
  loadBearing: number;
  tiers: Record<string, SourceTier>;
  reasons: string[];
}

/** Is this set of sources a defensible basis for a feature? */
export function evaluateSourceQuality(urls: string[]): SourceQualityVerdict {
  const tiers: Record<string, SourceTier> = {};
  let loadBearing = 0;
  for (const u of urls) {
    const t = classifySource(u);
    tiers[u] = t;
    if (t !== 'supporting') loadBearing++;
  }
  const reasons: string[] = [];
  if (loadBearing < MIN_LOAD_BEARING_SOURCES) {
    reasons.push(
      `Only ${loadBearing} load-bearing source(s); the floor is ${MIN_LOAD_BEARING_SOURCES}. ` +
        'Travel guides, listicles, review sites and aggregators can add detail but cannot be the basis of a feature.'
    );
  }
  return { pass: reasons.length === 0, loadBearing, tiers, reasons };
}
