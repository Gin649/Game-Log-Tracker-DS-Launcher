#!/usr/bin/env node
// Builds ra-patches-index.json: a flat list of every patch file path in the
// RetroAchievements/RAPatches repo. Run on a schedule by
// .github/workflows/build-ra-index.yml and committed into the repo, so the
// app fetches one small same-origin file on GitHub Pages instead of calling
// GitHub's tree API itself. That API is rate-limited per IP; a PWA with a
// handful of people behind the same home or mobile IP could hit that limit,
// and a stale local cache was the only fallback. This runs in GitHub's own
// Actions runners, one request a day, so it never gets close to a limit.
//
// This intentionally does NOT build a RetroAchievements game-ID-to-title
// map (as in the original brief's "ra-game-map.json"). The app already
// knows each game's title and RetroAchievements ID at the moment someone
// opens that game's page — it's signed into RA and just fetched the game's
// own info — so it doesn't need a second, separately-built database of
// every title on every console to look one up. Duplicating that here would
// mean an RA Web API key sitting in a GitHub Actions secret (readable by
// anyone with write access to the repo) purely to reconstruct data the
// client already has for free. The client-side matching (exact match by
// RA game ID from the file name, then a title-word fallback against this
// index) covers the same ground without that.
//
// Usage: node tools/build-ra-index.mjs [output-path]
// Env:   GITHUB_TOKEN — optional, raises the GitHub API rate limit from
//        60/hr to 5000/hr. The workflow supplies this automatically.

const OWNER = 'RetroAchievements';
const REPO = 'RAPatches';
const PATCH_EXT = /\.(bps|ips|ups|ppf|aps|xdelta3?|vcdiff|vcd|zip|7z)$/i;
const outPath = process.argv[2] || 'ra-patches-index.json';

async function ghFetch(url) {
  const headers = { 'accept': 'application/vnd.github+json', 'user-agent': 'game-log-tracker-index-builder' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  const meta = await ghFetch(`https://api.github.com/repos/${OWNER}/${REPO}`);
  const branch = meta.default_branch || 'main';

  const tree = await ghFetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${branch}?recursive=1`
  );
  if (tree.truncated) {
    // The recursive tree API caps out around 100,000 entries / ~7MB — RAPatches is
    // nowhere near that today, but fail loudly rather than silently ship a partial index.
    throw new Error('GitHub truncated the tree response — RAPatches has grown too large for one recursive call; the index builder needs updating to page through it.');
  }

  const files = (tree.tree || [])
    .filter((e) => e.type === 'blob' && PATCH_EXT.test(e.path))
    .map((e) => e.path)
    .sort();

  if (files.length < 100) {
    // A near-empty result almost always means something upstream broke (a bad
    // token, an API shape change), not that the repo actually emptied out.
    throw new Error(`Only found ${files.length} patch files — that looks wrong for RAPatches, refusing to overwrite the index with a bad one.`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    owner: OWNER,
    repo: REPO,
    branch,
    count: files.length,
    files,
  };

  const fs = await import('node:fs/promises');
  await fs.writeFile(outPath, JSON.stringify(out));
  console.log(`Wrote ${outPath}: ${files.length} patch files from ${OWNER}/${REPO}@${branch}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
