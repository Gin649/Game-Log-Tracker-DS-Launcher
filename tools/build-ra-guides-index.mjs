#!/usr/bin/env node
// Builds ra-guides-index.json: the name of every guide page in the RetroAchievements/guides
// wiki. Run on a schedule by .github/workflows/build-ra-index.yml and committed into the repo,
// so the app loads one small same-origin file instead of crawling the wiki itself.
//
// A GitHub wiki is its own git repo (<repo>.wiki.git) and has no API that lists its pages, so
// this does a shallow clone and reads the file names. Each page "Paper Mario (Nintendo 64)" is
// the file "Paper-Mario-(Nintendo-64).md"; the index stores that name without ".md", which is
// also what the app puts in the raw.githubusercontent.com URL it downloads from.
//
// Usage: node tools/build-ra-guides-index.mjs [output-path]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OWNER = 'RetroAchievements';
const REPO = 'guides';
const WIKI_URL = `https://github.com/${OWNER}/${REPO}.wiki.git`;
const outPath = process.argv[2] || 'ra-guides-index.json';

// Pages that exist for the wiki itself rather than for a game: the front page, writing
// templates, and the index/hub pages.
const SKIP = /^(Home|Misc\.-Pages|WIP-Guides|List-of-RAGuides-Featured-in-RANews|Retreon-Setup-Guide)$|template/i;

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ra-guides-wiki-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', '--quiet', WIKI_URL, tmp], { stdio: 'inherit' });
    const names = await fs.readdir(tmp);

    const pages = names
      .filter((f) => /\.md$/i.test(f) && !f.startsWith('_') && !f.startsWith('.'))
      .map((f) => f.replace(/\.md$/i, ''))
      .filter((name) => !SKIP.test(name))
      .sort((a, b) => a.localeCompare(b));

    const other = names.filter((f) => !/\.md$/i.test(f) && !f.startsWith('.') && !f.startsWith('_') && f !== 'images');
    if (other.length) console.log(`Skipped ${other.length} non-Markdown file(s): ${other.slice(0, 5).join(', ')}${other.length > 5 ? ', …' : ''}`);

    if (pages.length < 100) {
      // Far fewer pages than the wiki has (it has 400+) means something upstream broke, not
      // that the wiki emptied out. Fail rather than overwrite a good index with a bad one.
      throw new Error(`Only found ${pages.length} guide pages — that looks wrong for ${OWNER}/${REPO}, refusing to overwrite the index.`);
    }

    const out = { generatedAt: new Date().toISOString(), owner: OWNER, repo: REPO, count: pages.length, pages };
    await fs.writeFile(outPath, JSON.stringify(out));
    console.log(`Wrote ${outPath}: ${pages.length} guide pages from ${OWNER}/${REPO} wiki`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
