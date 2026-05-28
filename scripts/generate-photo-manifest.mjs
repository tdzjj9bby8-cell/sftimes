#!/usr/bin/env node
/**
 * Generate the launch photo manifest.
 *
 * Reads every article markdown in src/content/stories/ and every best-of
 * markdown in src/content/best-of/, then emits one big markdown file at
 * drafts/photo-manifest-launch.md with a Gemini-feedable prompt per image.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const storiesDir = path.resolve(projectRoot, 'src', 'content', 'stories');
const bestOfDir = path.resolve(projectRoot, 'src', 'content', 'best-of');
const out = path.resolve(projectRoot, 'drafts', 'photo-manifest-launch.md');

const parseFrontmatter = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const lines = m[1].split('\n');
  const data = {};
  for (const line of lines) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    // strip surrounding quotes
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    data[kv[1]] = val;
  }
  return data;
};

const lightFromPhotoClass = (cls) => {
  switch (cls) {
    case 'warm': return 'warm early-morning light or golden side light, soft and unhurried';
    case 'cool': return 'predawn cool blue light or overcast morning, a touch melancholy';
    case 'green': return 'natural foliage light, dappled or filtered through plants';
    case 'dusk':  return 'evening fading light, soft purple-orange, last hour before dark';
    default:      return 'natural ambient light, single source, no artificial fill';
  }
};

const inferKeeperEmotion = (kt) => {
  switch (kt) {
    case 'recipe':  return 'patient, focused, the hands of a person who has done this thousands of times';
    case 'routine': return 'quietly present, this is the same moment they have lived a thousand times';
    case 'room':    return 'at home in a space they have shaped over decades';
    case 'record':  return 'careful, methodical, mid-act of preserving something';
    case 'refusal': return 'matter-of-fact, settled, not performing defiance';
    default:        return 'quiet, observational, unposed';
  }
};

const buildHeroPrompt = (data, n) => {
  const light = lightFromPhotoClass(data.photo_class);
  const emotion = inferKeeperEmotion(data.keeper_type);
  const nhood = data.neighborhood || 'San Francisco';
  const subject = data.hero_alt || data.caption || data.title;
  const filename = (data.hero_filename_hint || `heroes/unknown-${n}.jpg`).split('/').pop();

  const prompt = `Shot brief: ${subject}. Wide horizontal documentary photograph, subject placed off-center, ${nhood} neighborhood texture (storefront, sidewalk, room interior, weather) visible in soft background. Light: ${light}. Mood: ${emotion}. Shot on a 35mm prime lens, available natural light, slight grain, real depth of field. Composition has generous negative space on one side. No logos, no readable signage with brand names, no posed faces. Aspect ratio 21:9, high resolution.`;

  return [
    `## ${String(n).padStart(2,'0')}. \`${filename}\``,
    '',
    '```',
    prompt,
    '```',
    '',
    '---',
    '',
  ].join('\n');
};

const buildBestOfPrompt = (data, n) => {
  const filename = (data.hero_filename_hint || `best-of/${data.url_slug}.jpg`).split('/').pop();
  const category = data.title;
  const prompt = `Shot brief: a single image that represents the category "${category}" without showing any specific restaurant logo or signage. The image is a still-life or scene (food, hands, a counter, a chair, a window) lit by one warm window-light source. Real metallic or ceramic objects in frame. No readable text. Generous negative space. Composition: top-down or 45-degree angle. Mood: appetite-forward but restrained, not overcrowded. Aspect ratio 4:3, high resolution.`;

  return [
    `## B${String(n).padStart(2,'0')}. \`${filename}\``,
    '',
    '```',
    prompt,
    '```',
    '',
    '---',
    '',
  ].join('\n');
};

// Build manifest
let manifest = `# SF Times launch photo manifest

67 photos. Copy the prompt, paste into Gemini, generate, download, rename to the filename shown.

**Save heroes to:** \`astro/src/assets/heroes/\`
**Save Best Of to:** \`astro/src/assets/best-of/\`
**Save team to:** \`astro/src/assets/team/\`
**Save OG to:** \`astro/public/\`
**Save logo to:** \`astro/public/\`

Paste the master prompt from \`photo-prompt-gemini.md\` once at the start of the Gemini session, then go.

---

# Article heroes (57)

`;

const storyFiles = fs.readdirSync(storiesDir).filter(f => f.endsWith('.md')).sort();
storyFiles.forEach((f, i) => {
  const text = fs.readFileSync(path.join(storiesDir, f), 'utf8');
  const data = parseFrontmatter(text);
  manifest += buildHeroPrompt(data, i + 1);
});

manifest += `\n# Best Of category cards (4)\n\n`;

const bestOfFiles = fs.readdirSync(bestOfDir).filter(f => f.endsWith('.md')).sort();
bestOfFiles.forEach((f, i) => {
  const text = fs.readFileSync(path.join(bestOfDir, f), 'utf8');
  const data = parseFrontmatter(text);
  manifest += buildBestOfPrompt(data, i + 1);
});

// Manual sections appended below
manifest += `
# Team headshots (4)

## T01. \`eric.jpg\`

\`\`\`
Shot brief: a portrait of Eric, late 30s, founder and editor of an independent San Francisco profile publication. Shot in a natural environment (a kitchen table, a small office, a café window seat), not a studio. Eric is looking just past the camera or down at a notebook, not directly into the lens. Light: single window-light source on the side of the face. Color: natural skin tones, no warm filters, no smoothing. Background: a softly out-of-focus interior, possibly with a book or a coffee cup visible. The portrait reads as the kind of photograph a friend took, not a corporate headshot. Aspect ratio 1:1, high resolution.
\`\`\`

---

## T02. \`nicholas.jpg\`

\`\`\`
Shot brief: a portrait of Nicholas, 30s, reporter for SF Times. Documentary style, shot in a working environment, not posed. Natural window light from one side, single source. Subject looking slightly off-camera. No corporate look, no over-smile, no fake bokeh. Background: soft, out-of-focus interior or street scene. Aspect ratio 1:1, high resolution.
\`\`\`

---

## T03. \`daisy.jpg\`

\`\`\`
Shot brief: a portrait of Daisy, 30s, reporter for SF Times. Documentary style, natural environment, not a studio. Window light from one side. Subject looking slightly off-camera or in the act of writing, not posed. Natural skin tones, no filters. Background out of focus. Aspect ratio 1:1, high resolution.
\`\`\`

---

## T04. \`kiwi.jpg\`

\`\`\`
Shot brief: a portrait of Kiwi, the SF Times photographer, holding a 35mm camera. Casual, not posed. Shot from a low angle or three-quarter view. Window light, single source. Subject is in the act of looking at the back of the camera or framing a shot. Natural skin tones, real depth of field. Background: a workspace or street scene, softly out of focus. Aspect ratio 1:1, high resolution.
\`\`\`

---

# OG / share image (1)

## O01. \`og-image.jpg\` (1200x630)

\`\`\`
Shot brief: a singular San Francisco image that represents the publication without being a cliché. NOT the Golden Gate Bridge, NOT Painted Ladies, NOT a cable car, NOT a tech-worker-in-hoodie scene. Examples that would work: morning fog rolling over the Outer Richmond rooflines, a hand-painted shop sign in Chinatown light, an empty Muni 38 Geary bus at 6 a.m., the back of a person walking up Filbert Steps with a paper grocery bag. Composition: wide, with generous negative space on the right or left side so the SF Times wordmark could overlay without crowding. Mood: this is a city someone loves quietly. Color: warm off-white tones, slight grain. Aspect ratio 1.91:1, exactly 1200 by 630 pixels.
\`\`\`

---

# Logo (1)

## L01. \`logo.png\`

**Note:** Gemini is not the right tool for a logo. Better path: upscale one of the existing 79KB copies in \`src/SFTIMES/\`, or redraw in Figma. Skip this one in Gemini unless you want a flat mock.

If you want Gemini to mock it anyway:

\`\`\`
Shot brief: a clean editorial wordmark for a publication called "SF Times" set in a refined serif font (similar to Fraunces or Tiempos), all caps, ink color (#181612) on a warm off-white background (#f4f1ea). Centered, with the words "The Keepers" set smaller in an Inter sans-serif caps below the wordmark. No icon, no flourishes. Aspect ratio 3:1 horizontal, high resolution. Flat vector look, not photographic.
\`\`\`
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, manifest, 'utf8');
console.log(`Wrote photo manifest with ${storyFiles.length + bestOfFiles.length + 4 + 1 + 1} entries to: ${out}`);
console.log(`Size: ${(manifest.length/1024).toFixed(1)} KB`);
