#!/usr/bin/env python3
"""Checks data/ports.json against GitHub and writes a report (Markdown) of what needs a look.

  Health of the listed ports:
    - the repo moved (renamed or transferred), is archived, or is gone
    - it has no Android build in its recent releases any more
  New ports:
    - repos that look like a recompiled, decompiled or reimplemented game with an Android build, and are not listed

Nothing is changed in ports.json: a new port needs the game's name(s) and its system, so the report is the list to
go through. Uses the GitHub CLI (`gh api`), which is authenticated on GitHub Actions through GH_TOKEN.

    python tools/check_ports.py --out report.md
"""
import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

SEARCHES = [
    "topic:decompilation topic:android",
    "topic:recompilation topic:android",
    "topic:game-port topic:android",
    "decompilation android apk in:name,description,readme",
    "recompiled android port apk in:name,description",
    "android port of in:description decompilation",
    "reimplementation android apk game engine in:description",
]
MIN_STARS = 25
MAX_AGE_DAYS = 400


def gh(path, *params):
    cmd = ["gh", "api", path] + [a for p in params for a in ("-f", p)]
    for attempt in range(3):
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            try:
                return json.loads(r.stdout)
            except ValueError:
                return None
        err = (r.stderr or "") + (r.stdout or "")
        if "404" in err or "Not Found" in err or "451" in err:
            return {"_missing": True}
        if "rate limit" in err.lower() or "403" in err:
            time.sleep(20 * (attempt + 1))
            continue
        time.sleep(2)
    return None


def has_android_build(releases, pattern=None):
    pat = re.compile(pattern) if pattern else None
    for rel in releases or []:
        if rel.get("draft"):
            continue
        for a in rel.get("assets") or []:
            n = a.get("name", "")
            ok = bool(pat.search(n)) if pat else n.lower().endswith(".apk")
            low = n.lower()
            if ok and not any(x in low for x in ("x86", "x64", "armeabi", "armv7", "debug")):
                return rel
    return None


def age_days(iso):
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - d).days
    except Exception:
        return 99999


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ports", default="data/ports.json")
    ap.add_argument("--out", default="ports-report.md")
    ap.add_argument("--limit", type=int, default=0, help="only check this many listed repos (for a quick test)")
    args = ap.parse_args()

    ports = json.load(open(args.ports, encoding="utf-8"))["ports"]
    by_repo = {}
    for p in ports:
        by_repo.setdefault(p["repo"], []).append(p)
    repos = sorted(by_repo)
    if args.limit:
        repos = repos[:args.limit]

    moved, archived, gone, nobuild, errors = [], [], [], [], []
    known = {r.lower() for r in by_repo}
    for repo in repos:
        meta = gh("repos/" + repo)
        if meta is None:
            errors.append(repo)
            continue
        if meta.get("_missing"):
            gone.append(repo)
            continue
        full = meta.get("full_name", repo)
        if full.lower() != repo.lower():
            moved.append((repo, full))
            known.add(full.lower())
        if meta.get("archived"):
            archived.append(repo)
        rels = gh("repos/%s/releases?per_page=30" % repo)
        if rels is None or isinstance(rels, dict):
            errors.append(repo)
            continue
        pattern = next((p.get("pattern") for p in by_repo[repo] if p.get("pattern")), None)
        if not has_android_build(rels, pattern):
            nobuild.append((repo, meta.get("pushed_at", "")[:10]))

    # new candidates
    seen, cands = set(), []
    for q in SEARCHES:
        res = gh("search/repositories?per_page=50&sort=stars&order=desc", "q=" + q + " archived:false")
        time.sleep(3)
        for r in (res or {}).get("items", []) if isinstance(res, dict) else []:
            full = r["full_name"]
            if full.lower() in known or full.lower() in seen:
                continue
            seen.add(full.lower())
            if r.get("fork") or r.get("stargazers_count", 0) < MIN_STARS or age_days(r.get("pushed_at", "")) > MAX_AGE_DAYS:
                continue
            cands.append(r)
    listed = []
    for r in sorted(cands, key=lambda r: -r.get("stargazers_count", 0))[:60]:
        rels = gh("repos/%s/releases?per_page=15" % r["full_name"])
        rel = has_android_build(rels) if isinstance(rels, list) else None
        if rel:
            listed.append((r, rel))

    out = ["# Android ports check", "", "Run on %s. Checked %d listed repos." % (datetime.now(timezone.utc).strftime("%Y-%m-%d"), len(repos)), ""]
    problems = bool(moved or archived or gone or nobuild or listed)
    if moved:
        out += ["## Moved (update `repo` in data/ports.json)", ""] + ["- %s → **%s**" % m for m in moved] + [""]
    if gone:
        out += ["## Gone (404)", ""] + ["- %s (%s)" % (r, ", ".join(p["name"] for p in by_repo[r])) for r in gone] + [""]
    if archived:
        out += ["## Archived (no more updates)", ""] + ["- %s" % r for r in archived] + [""]
    if nobuild:
        out += ["## No Android build in the latest releases (the app already hides these)", ""] + ["- %s (last push %s)" % m for m in nobuild] + [""]
    if listed:
        out += ["## New ports that may be worth adding", "",
                "Each has an Android build in its releases and is not in the list. Check the game and system, then add it.", ""]
        for r, rel in listed:
            out.append("- [%s](%s) ★%d, last push %s, latest build `%s`: %s" % (
                r["full_name"], r["html_url"], r["stargazers_count"], (r.get("pushed_at") or "")[:10], rel.get("tag_name", ""),
                (r.get("description") or "").strip()[:140]))
        out.append("")
    if errors:
        out += ["_Could not be checked this time (GitHub did not answer): %s_" % ", ".join(errors[:30]), ""]
    if not problems:
        out += ["Nothing needs attention.", ""]
    open(args.out, "w", encoding="utf-8").write("\n".join(out))
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
