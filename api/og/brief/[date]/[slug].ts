/**
 * /api/og/brief/[date]/[slug]
 *
 * Dynamic Open Graph image for a Brief item permalink. Returns an SVG
 * image (1200×630, Facebook/Twitter/LinkedIn-compatible OG card size)
 * with the category badge, signal, headline, source attribution, and SF
 * Times branding.
 *
 * Why SVG instead of @vercel/og: SVG renders consistently across all
 * social previewers, caches indefinitely with the same path, and has no
 * runtime dependencies. Vercel's image proxy converts to PNG on demand
 * for clients that don't accept SVG (Slack, some chat apps).
 *
 * Cache: 30 days. The image is deterministic given the slug, so a long
 * cache is safe. Override per-deploy by appending ?v=2 to the URL if
 * the template changes.
 *
 * URL: /api/og/brief/2026-06-13/build-act-pause-recalibration
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// ============ SIGNAL COLORS ============

const SIGNAL_COLORS: Record<string, { fg: string; pillBg: string }> = {
  'first-to-connect': { fg: '#ffffff', pillBg: '#d9551f' },
  'underreported': { fg: '#ffffff', pillBg: '#2c5582' },
  'missing-context': { fg: '#ffffff', pillBg: '#6b6357' },
  'structural-pattern': { fg: '#ffffff', pillBg: '#1d1d1b' },
};

// ============ LOAD ITEM ============

interface BriefItem {
  slug: string;
  category: string;
  signal: string;
  source_headline: string;
  source_outlet: string;
  source_byline: string;
}

async function loadItem(date: string, slug: string): Promise<BriefItem | null> {
  // Read directly from the content collection markdown file.
  // The content collection path is relative to the project root.
  const filePath = path.join(process.cwd(), 'src', 'content', 'briefs', `${date}.md`);
  try {
    const raw = await readFile(filePath, 'utf-8');
    // Extract frontmatter (everything between the first two ---)
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const frontmatter = match[1];

    // Find the items: block and walk through to find the matching slug
    // (Lightweight YAML walk without a full parser; the file is generated
    // by our publish script so format is predictable.)
    const itemBlocks = frontmatter.split(/^  - id:/m).slice(1);
    for (const block of itemBlocks) {
      const slugMatch = block.match(/^\s*slug:\s*(\S+)/m);
      if (!slugMatch || slugMatch[1] !== slug) continue;
      const categoryMatch = block.match(/^\s*category:\s*(.+)$/m);
      const signalMatch = block.match(/^\s*signal:\s*(\S+)/m);
      const headlineMatch = block.match(/^\s*source_headline:\s*"((?:[^"\\]|\\.)*)"/m);
      const outletMatch = block.match(/^\s*source_outlet:\s*"((?:[^"\\]|\\.)*)"/m);
      const bylineMatch = block.match(/^\s*source_byline:\s*"((?:[^"\\]|\\.)*)"/m);
      return {
        slug,
        category: (categoryMatch?.[1] || '').trim(),
        signal: signalMatch?.[1] || 'underreported',
        source_headline: (headlineMatch?.[1] || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
        source_outlet: (outletMatch?.[1] || '').replace(/\\"/g, '"'),
        source_byline: (bylineMatch?.[1] || 'Staff').replace(/\\"/g, '"'),
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ============ SVG RENDERING ============

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Naive line wrap for the headline. The OG image is 1200px wide; the
 *  headline area gives us roughly 28 characters per line at the target
 *  font size before it gets cramped. */
function wrapHeadline(text: string, maxCharsPerLine = 28, maxLines = 4): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1) {
        // Last line: pack the rest then truncate with ellipsis if needed
        const rest = words.slice(words.indexOf(w) + 1).join(' ');
        const tail = rest ? `${current} ${rest}` : current;
        lines.push(tail.length > maxCharsPerLine + 4 ? tail.slice(0, maxCharsPerLine + 1).trimEnd() + '…' : tail);
        return lines;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function renderSvg(item: BriefItem): string {
  const signal = SIGNAL_COLORS[item.signal] ?? SIGNAL_COLORS['underreported'];
  const headlineLines = wrapHeadline(item.source_headline, 28, 4);
  const lineHeight = 78;
  const headlineStartY = 320 - ((headlineLines.length - 1) * lineHeight) / 2;

  const headlineTspans = headlineLines
    .map((line, i) => `<tspan x="80" y="${headlineStartY + i * lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <!-- Background paper tone -->
  <rect width="1200" height="630" fill="#ebe6da"/>

  <!-- Left accent strip (the signal color) -->
  <rect x="0" y="0" width="20" height="630" fill="${signal.pillBg}"/>

  <!-- SF Times wordmark, top right -->
  <text x="1120" y="80" fill="#0a0a0a"
        font-family="Anton, Impact, sans-serif" font-size="42"
        text-anchor="end" letter-spacing="1">SF TIMES</text>
  <text x="1120" y="110" fill="#6b6357"
        font-family="Inter Tight, Inter, sans-serif" font-size="14"
        font-weight="700" text-anchor="end" letter-spacing="3">THE BRIEF</text>

  <!-- Category pill, top left -->
  <rect x="80" y="60" width="${item.category.length * 14 + 36}" height="40" fill="#e2ddcf" rx="0"/>
  <text x="${80 + (item.category.length * 14 + 36) / 2}" y="86" fill="#0a0a0a"
        font-family="Inter Tight, Inter, sans-serif" font-size="18"
        font-weight="700" text-anchor="middle" letter-spacing="2.5">${escapeXml(item.category)}</text>

  <!-- Signal pill, next to category -->
  <rect x="${80 + item.category.length * 14 + 36 + 12}" y="60"
        width="${item.signal.length * 12 + 36}" height="40" fill="${signal.pillBg}" rx="0"/>
  <text x="${80 + item.category.length * 14 + 36 + 12 + (item.signal.length * 12 + 36) / 2}" y="86"
        fill="${signal.fg}"
        font-family="Inter Tight, Inter, sans-serif" font-size="16"
        font-weight="700" text-anchor="middle" letter-spacing="2">${escapeXml(item.signal.toUpperCase().replace(/-/g, ' '))}</text>

  <!-- Headline -->
  <text fill="#0a0a0a"
        font-family="Anton, Impact, sans-serif" font-size="68"
        font-weight="400" letter-spacing="-0.5">${headlineTspans}</text>

  <!-- Divider rule, low -->
  <line x1="80" y1="520" x2="1120" y2="520" stroke="#bdb6a4" stroke-width="1"/>

  <!-- Source attribution -->
  <text x="80" y="560" fill="#6b6357"
        font-family="Inter Tight, Inter, sans-serif" font-size="20"
        letter-spacing="0.5">Reported by</text>
  <text x="80" y="590" fill="#0a0a0a"
        font-family="Inter Tight, Inter, sans-serif" font-size="24"
        font-weight="700">${escapeXml(item.source_byline)}<tspan fill="#6b6357" font-weight="400"> at ${escapeXml(item.source_outlet)}</tspan></text>

  <!-- Brief tagline, bottom right -->
  <text x="1120" y="590" fill="#6b6357"
        font-family="Inter Tight, Inter, sans-serif" font-size="18"
        font-weight="500" text-anchor="end" letter-spacing="0.4">Editorial commentary, linked out, never rewritten.</text>
</svg>`;
}

// ============ HANDLER ============

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { date, slug } = req.query as { date: string; slug: string };
  if (!date || !slug) {
    res.status(400).json({ error: 'Missing date or slug' });
    return;
  }

  const item = await loadItem(date, slug);
  if (!item) {
    res.status(404).json({ error: `No brief item at /brief/${date}/${slug}` });
    return;
  }

  const svg = renderSvg(item);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400');
  res.status(200).send(svg);
}
