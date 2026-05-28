# Deploy SF Times to Vercel

Reference doc. Eric already has Vercel + GitHub accounts.

## Step 1: Push the Astro project to GitHub (~5 min)

```bash
cd /Users/eric/projects/sftimes/astro

# Already done by Cowork: git init, .gitignore, first commit.
# You just need to create the GitHub repo and push.

# 1. In your browser, go to https://github.com/new
#    - Name: sftimes
#    - Private (recommended)
#    - DO NOT initialize with README, .gitignore, or license (we have one)
#    - Click "Create repository"

# 2. Back in Terminal, run these two lines, replacing YOUR_USERNAME:
git remote add origin git@github.com:YOUR_USERNAME/sftimes.git
git push -u origin main
```

If `git push` asks for credentials and you don't have an SSH key set up,
use the HTTPS URL instead: `https://github.com/YOUR_USERNAME/sftimes.git`
and GitHub will prompt for a personal access token.

## Step 2: Import to Vercel (~3 min)

1. Go to https://vercel.com/dashboard
2. Click "Add New Project"
3. Select "Import Git Repository" and pick the `sftimes` repo
4. Vercel auto-detects Astro. Confirm these settings:
   - **Root Directory:** `astro` (the Astro project is in the `astro/` subfolder)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Framework Preset:** Astro
5. Under Environment Variables, add one:
   - Key: `ALLOW_PLACEHOLDERS`
   - Value: `1`
   - (Lets the build pass with neon-green placeholders. Remove this when real photos are in.)
6. Click "Deploy"

First build takes ~60 seconds. Vercel gives you a preview URL like
`sftimes-abc123.vercel.app`. Walk the site there.

## Step 3: Add your domain (~5 min)

1. Vercel project dashboard → Settings → Domains
2. Type `sftimes.com` and click Add
3. Vercel shows DNS records to set. Typically:
   - A record: `76.76.21.21`
   - CNAME for `www`: `cname.vercel-dns.com`
4. Update DNS at your domain registrar
5. Wait 5 to 30 min for propagation
6. Vercel provisions HTTPS automatically once DNS resolves

## Step 4: Verify

- `https://sftimes.com` loads the new build
- `/stories/mrs-kim-tofu-house` renders the full article
- `/best-of/korean-bbq-sf` loads
- `/quizzes/mbti` is interactive
- `/rss.xml` returns valid XML

## Weekly publish workflow

```bash
cd /Users/eric/projects/sftimes/astro

# 1. Write the new article
#    (create src/content/stories/YYYY-MM-DD-slug.md with frontmatter + body)

# 2. Push
git add .
git commit -m "Issue 24: the keeper slug"
git push

# 3. Done. Vercel rebuilds in ~60s.
```

## When photos are ready

1. Drop real photos into `src/assets/heroes/`, `src/assets/best-of/`, `src/assets/team/`
2. Swap `<Placeholder>` components for Astro's `<Image>` in the 6 template files
3. In Vercel: Settings → Environment Variables → delete `ALLOW_PLACEHOLDERS`
4. Push. Build guard now enforces: any neon-green = deploy fails.

## Rollback

If a deploy breaks something: Vercel dashboard → Deployments → three dots
on the previous good deploy → "Promote to Production." Instant rollback.
