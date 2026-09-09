# SF Times Daily Editorial Engine — Proposed Architecture

Analysis only. Nothing built. For approval before implementation.

Goal: each weekday, produce (1) the Daily Brief and (2) up to three original
SF Times articles, with strict source verification and safe failure behavior.

---

## 0. The reframe that matters most

There is a question underneath this that has to be answered before any of the
seven below: **where does an "original article" get its material?**

A Brief item is one source article plus our angle, 150 words. An original
article is a 1,200-word piece published under the SF Times byline. If it is
built from a single source, it is not an original article. It is a longer Brief
item pretending to be reporting, and it is exactly the "AI filler" outcome you
want to avoid.

So an original article needs **multiple verified sources synthesized into
something no single source says.** That is the whole product. Everything below
follows from it.

The pipeline currently has no research capability. It reads RSS feeds. It
cannot search. So the honest options for sourcing original articles are:

| Option | Cost | Fabrication risk | Verdict |
|---|---|---|---|
| **A. Cluster the day's already-fetched corpus** | ~$0 extra | Low: same bodies, same firewall | **Recommended for v1** |
| **B. Search our own published archive** | $0 | Low | **Recommended as a supplement** |
| C. Add a web-search API (Brave/Exa/Tavily) | New vendor + per-query cost | Medium: unverified pages | Defer to v2 |
| D. Anthropic server-side web search | Per-search billing | Medium | Defer to v2 |

**Recommendation: build v1 on A + B only.**

The pipeline already fetches and verifies 10 to 15 full article bodies every
weekday across 14 sources. When four of them touch restaurant closures, or three
touch the same housing mechanism, that is a genuine multi-source basis for a
synthesis article, using material we have *already fetched, already verified,
and already paid for*. That is precisely your "reuse research efficiently"
instinct, and it is the cheapest and safest version of it.

Option B adds compounding value specific to SF Times: our own prior Brief
editions and stories are a corpus. An article on Mission restaurant closures can
legitimately build on our own prior coverage, which itself cites original
reporting. That is free, it differentiates us, and it is how a publication
builds topical authority over time.

**The honest limitation:** this only produces an article when the day's news
actually contains a cluster. Some weekdays will yield zero. That is correct
behavior under your own rule, not a defect.

---

## 1. What is already reusable

Most of it. This is the good news.

| Component | Reuse | Note |
|---|---|---|
| `brief-ingest.ts` | **Full** | Same 14 sources, dedupe, source health |
| `lib/fetch-article.ts` | **Full** | The 500-word floor is the foundation of both products |
| `lib/editorial-firewall.ts` | **Full, and more important here** | Numbers, quotes, attribution, certainty apply identically to a 1,200-word article |
| `lib/editorial-quality.ts` | **Partial** | Dedupe and diversity reused; needs cross-product comparison |
| `lib/sf-date.ts` | Full | |
| `lib/run-status.ts` | Extend | Add a second product block |
| `lib/token-budget.ts` | Full | One ceiling covers both products |
| `brief-watchdog.ts` | Extend | Verify articles went live too |
| Scoring stage | **Reuse as a signal** | Composite score is a useful relevance input for clustering |
| `stories` content collection | **Full** | Already proven by the Kollmeyer profile |
| Text-first article hero | **Full** | Solves the "no licensable photo" problem, already working |
| Kollmeyer sourcing-note pattern | **Full** | The disclosure model for reported-from-public-record pieces |
| `brief-publish.ts` composition | **No** | Articles use a different schema |

Roughly 70% of what exists carries over unchanged. The article product is mostly
a new *head* on the existing body.

---

## 2. New components required

1. **Opportunity identification** — one model call over the day's verified
   corpus that proposes article ideas, each with a claimed information gap and
   the specific source IDs supporting it. Biased hard toward returning zero.
2. **Cluster assembly** — deterministic. Group verified candidates by entity and
   topic overlap. Cheap, no model call.
3. **Archive retrieval** — deterministic search over `src/content/briefs/` and
   `src/content/stories/` for prior related coverage. Free.
4. **Multi-source synthesis drafting** — the long-form draft call, grounded in
   3+ full bodies.
5. **Per-claim source mapping** — each factual paragraph must record which
   source supports it. This is the new safety primitive, and it is what makes
   the firewall work on a multi-source piece.
6. **Article composition** — to the `stories` schema: title, deck, slug, issue
   auto-increment, read_minutes, text-first hero, sourcing note.
7. **Cross-product dedupe** — Brief items vs proposed articles.
8. **Geographic tiering** — currently the pipeline has *zero* geographic
   awareness. Needs a tier signal used as a tiebreaker, never an override.
9. **Extended review mode** — shows both products plus rejected opportunities.

---

## 3. Expected additional API cost

Measured extrapolation from the existing instrumented prompts.

| Call | Input | Output | Notes |
|---|---|---|---|
| Opportunity identification | ~3,000 | ~800 | One call, over headlines + deks + scores |
| Article draft (per article) | ~10,000 | ~2,000 | Carries 3-5 full bodies (~1,800 tok each) |
| Article audit (per article) | ~8,000 | ~400 | Bodies again for source fidelity |

**Three articles:** ~57k input, ~8k output → **~$0.10 per run.**

| | Per run | Per month (22 days) |
|---|---|---|
| Brief only (today) | $0.08 – $0.17 | $1.70 – $3.60 |
| Brief + up to 3 articles | **$0.18 – $0.27** | **$4.00 – $6.00** |

Roughly doubles cost, still small. If approved, raise `BRIEF_MAX_USD` from
$0.35 to **$0.60**, and the Anthropic Console cap from $5 to **$10**.

If we later add web search (option C or D), that changes materially and would
need re-measuring before enabling.

---

## 4. How to prevent low-quality AI filler

This is the question that decides whether the feature is worth building. Seven
controls, in order of importance:

**1. A hard multi-source floor.** An article may not be drafted unless it has
**at least 3 distinct verified source bodies**, each already past the 500-word
fetch floor. This is the direct analogue of the guardrail that fixed the Brief,
and it is the single strongest anti-filler control. One source means no article.

**2. Default to zero.** The opportunity prompt is written to expect zero on most
days and to treat "no genuine opportunity today" as the correct, professional
answer. No quota. Never "find me three."

**3. An explicit information-gap test.** Each opportunity must answer: *what
does this article tell a San Francisco reader that no single existing source
already tells them?* If the answer is a restatement, it is rejected before
drafting.

**4. The existing deterministic firewall, unchanged.** Numbers, quotations,
attribution, certainty. It applies identically and it is not a model call.

**5. Per-claim source mapping.** Every factual paragraph carries the source it
came from. Any paragraph that cannot name a source is removed. On a multi-source
piece this is what prevents the model from smoothing three articles into a
confident narrative containing assertions none of them made.

**6. An article-level quality floor.** Minimum length, minimum source count,
must not restate a Brief item, must carry a sourcing note. Failing any of these
drops the article, never repairs it.

**7. Articles do not auto-publish.** See §6.

---

## 5. Preventing Brief / article duplication

Sharing a *seed* is fine and desirable. Sharing an *angle* is not. Your
restaurant example is the exact case: the Brief notes the closure; the article
examines the neighborhood's changing restaurant landscape. Same seed, different
product.

The rule, concretely:

- An article **may** use a source that appears in today's Brief.
- An article **may not** be built primarily on that single source. If its only
  substantial source is a Brief item, it is a rewrite and is blocked.
- With the 3-source floor already in place, this is largely self-enforcing.
- Additionally: run the existing `removeNearDuplicates` across products,
  comparing the article's headline and deck against every Brief item that day. A
  high similarity score blocks it.
- **Cross-link both directions.** The article links to the Brief item, the Brief
  item links to the article. Good for readers, good for internal linking, and it
  makes the relationship explicit rather than accidental.

---

## 6. One AI stage, or a separate workflow?

**Recommendation: same workflow, separate stage, independent failure isolation,
and different publishing trust levels.**

Same workflow, because the fetched article bodies are the expensive shared
asset. A separate job would have to re-ingest and re-fetch everything, doubling
both runtime and fetch load on the sources, and cluster detection needs the
day's complete candidate set, which only exists inside that run.

But the two products must fail independently. If article synthesis fails, the
Brief still publishes. If the Brief produces nothing, a strong article
opportunity can still surface. `publication-status.json` records both
separately.

**The trust levels should differ, and this is the most important recommendation
in this document.**

A bad Brief item is 150 words of commentary linking to someone else's reporting.
A bad original article is 1,200 words published under your byline that reads
like SF Times reporting. The reputational exposure is categorically higher, and
the July 15 incident was the *small* version of that risk.

Therefore:

- **Brief:** auto-publishes once calibrated. Current behavior.
- **Articles:** go to a **review queue by default**. They are drafted, verified,
  composed, and staged, and you approve them. Auto-publishing articles should be
  an explicit opt-in you turn on only after a meaningful number of runs have
  produced pieces you would have published anyway.

This also fits how you already work: you approved the Kollmeyer profile before
it went live.

---

## 7. What review mode should show

Extend `review_only` to render both products into the GitHub job summary.

**Brief section** — as today: composed edition, item count, removals with
reasons.

**Article section** — for each proposed article:
- Headline, deck, and the claimed information gap
- Source list: outlet, URL, word count, and whether it also appears in today's Brief
- The full drafted body
- Per-claim source mapping
- Firewall result, pass or fail with specific violations
- The duplicate check against today's Brief items

**Rejected opportunities** — the ideas it considered and declined, with reasons.
This is how you calibrate the opportunity bar. Seeing what it *declined* is more
informative than seeing what it produced.

**Cost breakdown** — split by product, so you can see what the article layer
actually costs.

---

## Recommended architecture

```
WEEKDAY CRON (unchanged)
  ├─ weekday gate, idempotency gate, source-health gate   [no API spend]
  ├─ STAGE 1  ingest: 14 sources, dedupe, health          [no API spend]
  ├─ STAGE 2  score all candidates                        [cheap, no bodies]
  ├─ STAGE 3  fetch full bodies for top N                 [no API spend]
  │             ← THE SHARED VERIFIED CORPUS
  │
  ├─ STAGE 4A  BRIEF                    ├─ STAGE 4B  ARTICLES
  │   draft + 6-check audit             │   cluster assembly      [deterministic]
  │   deterministic firewall            │   archive retrieval     [deterministic]
  │   dedupe, diversity, floor          │   opportunity call      [1 model call]
  │   compose edition                   │   3-source floor gate
  │   ↓                                 │   synthesis draft       [per article]
  │   AUTO-PUBLISH                      │   article audit         [per article]
  │                                     │   firewall + claim mapping
  │                                     │   cross-product dedupe
  │                                     │   ↓
  │                                     │   REVIEW QUEUE (not auto-publish)
  │
  ├─ status: both products recorded independently
  ├─ build before push, push, verify live
  └─ watchdog verifies both
```

Geographic tiering feeds the scoring stage as a **tiebreaker only**: Tier 1 San
Francisco, Tier 2 Peninsula/San Mateo, Tier 3 broader Bay Area, Tier 4
Napa/Monterey/Sacramento and Northern California. A Tier 4 story with high civic
significance still outranks a trivial Tier 1 story, exactly as you specified.

### Suggested build order

1. Geographic tiering into scoring. Small, independent, improves the Brief today.
2. Cluster assembly and archive retrieval. Deterministic, free, testable offline.
3. Opportunity identification, review-only output. No drafting yet: first just
   see whether the ideas it proposes are any good. **This is the cheap decision
   point.** If the opportunities are weak, stop here and we have spent almost
   nothing.
4. Synthesis drafting and the article firewall, still review-only.
5. Article composition to the `stories` schema.
6. Much later, and only on evidence: consider auto-publishing articles.

Step 3 is deliberately a gate. It costs roughly $0.01 per run to find out
whether the system can identify article opportunities worth writing, before
committing to building the drafting layer at all.

---

## The honest risk

The Brief works because it is a *modest* product: short commentary that always
links to someone else's reporting, with a firewall that can verify every number
against one source.

Original articles are a materially harder problem. Multi-source synthesis is
where models are most likely to produce a confident narrative that no individual
source supports. The per-claim source mapping is the mitigation, but it is a
mitigation, not a guarantee. Paraphrased synthesis errors are the hardest class
to catch deterministically, and they will be the failure mode here.

That is why articles should stay in review for a long time, and why step 3 is a
gate rather than a milestone. Building the whole thing before checking whether
the opportunities are good would be the expensive mistake.
