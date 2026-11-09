#!/usr/bin/env python3
"""Checks data/ports.json against GitHub and writes a report (Markdown) of what needs a look.

  Health of the listed ports:
    - the repo moved (renamed or transferred), is archived, or is gone
    - it has no Android build in its recent releases any more
  New ports:
    - repos that look like a recompiled, decompiled or reimplemented game with an Android build, and are not listed

With --update-ports, ports.json is kept current for the two things that need no judgement: a repo that moved gets its
new name (the port's id stays, so installed ports are still recognised), and a repo that is gone gets "gone": true (and
loses it if the repo comes back). Entries are never deleted, so a port you installed stays in its game's profile and
keeps working. New ports are only reported: a new port needs the game's name(s) and its system added by hand. Uses the GitHub CLI (`gh api`), which is authenticated on GitHub Actions through GH_TOKEN.

    python tools/check_ports.py --out report.md
"""
import argparse
import urllib.request
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
RECOMPA_URL = "https://recompa.app/index.json"
JOEY_URL = "https://raw.githubusercontent.com/JoeysRetroHandhelds/JoeyOS/data/ports/android.json"
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
        if "rate limit" in err.lower():
            time.sleep(20 * (attempt + 1))
            continue
        if "403" in err:
            return None  # not allowed to read this repo: reported as "could not be checked", no point retrying
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


def fetch_json(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GLT-DS-Launcher ports check (weekly)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except Exception as e:
        print("Could not read %s: %s" % (url, e))
        return None


def source_candidates(known):
    """Ports in Recompa's catalog and Joey's list (the sources the list was built from) that ports.json lacks.
    Returns (recompa_new, joey_new, readable): lists of dicts with game, platform, repos, released."""
    rec_new, joey_new, ok = [], [], {"recompa": False, "joey": False}
    seen = set(known)
    rc = fetch_json(RECOMPA_URL)
    if rc and isinstance(rc.get("ports"), list):
        ok["recompa"] = True
        for p in rc["ports"]:
            forks = [f for f in p.get("forks", []) if f.get("repo")]
            if not forks or any(f["repo"].lower() in known for f in forks):
                continue
            built = [f for f in forks if (f.get("release") or {}).get("asset")]
            rec_new.append({"game": p.get("game", ""), "name": p.get("name", ""), "platform": p.get("original_platform", ""),
                            "type": p.get("type", ""), "repos": [f["repo"] for f in forks][:3], "apk": bool(built),
                            "released": max([(f.get("release") or {}).get("published_at", "") for f in forks] or [""])[:10],
                            "added": (p.get("added_at") or "")[:10]})
            seen.update(f["repo"].lower() for f in forks)
    jy = fetch_json(JOEY_URL)
    if jy and isinstance(jy.get("ports"), list):
        ok["joey"] = True
        for p in jy["ports"]:
            repo = p.get("repository")
            if not repo or repo.lower() in seen:
                continue
            seen.add(repo.lower())
            joey_new.append({"game": "; ".join(p.get("games") or [])[:60], "name": p.get("name", ""), "platform": ", ".join(p.get("consoles") or []),
                             "type": p.get("type") or "", "repos": [repo], "apk": bool(p.get("apkUrl")), "released": "", "added": ""})
    rec_new.sort(key=lambda x: x["added"], reverse=True)
    return rec_new, joey_new, ok


def gone_set(gone):
    return set(gone)


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
    ap.add_argument("--update-ports", action="store_true", help="write moved repos and gone flags back to ports.json")
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
    alive = set()  # repos GitHub answered for, whatever they hold
    known = {r.lower() for r in by_repo}
    for repo in repos:
        meta = gh("repos/" + repo)
        if meta is None or not isinstance(meta, dict):
            errors.append(repo)
            continue
        if meta.get("_missing"):
            gone.append(repo)
            continue
        full = meta.get("full_name", repo)
        alive.add(repo)
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

    if args.update_ports:
        # a run where GitHub mostly failed to answer must not mark everything gone
        if len(gone) > max(10, len(repos) // 10):
            print("Too many repos look gone (%d): not touching ports.json." % len(gone))
        else:
            ren = dict(moved)
            changed = 0
            for p in ports:
                if p["repo"] in ren:
                    p["repo"] = ren[p["repo"]]
                    changed += 1
                if p["repo"] in gone_set(gone) and not p.get("gone"):
                    p["gone"] = True
                    changed += 1
                elif p.get("gone") and p["repo"] in alive:
                    del p["gone"]
                    changed += 1
            if changed:
                with open(args.ports, "w", encoding="utf-8") as f:
                    json.dump({"ports": ports}, f, indent=1, ensure_ascii=False)
                    f.write("\n")
                print("ports.json updated (%d changes)." % changed)

    ignored = set()  # repos you decided not to list: data/ports-ignored.txt, one owner/repo per line, # for notes
    try:
        for line in open("data/ports-ignored.txt", encoding="utf-8"):
            line = line.split("#")[0].strip().lower()
            if line:
                ignored.add(line)
    except OSError:
        pass
    rec_new, joey_new, src_ok = source_candidates(known | ignored)

    # new candidates
    seen, cands = set(), []
    for q in SEARCHES:
        res = gh("search/repositories?per_page=50&sort=stars&order=desc", "q=" + q + " archived:false")
        time.sleep(3)
        for r in (res or {}).get("items", []) if isinstance(res, dict) else []:
            full = r["full_name"]
            if full.lower() in known or full.lower() in ignored or full.lower() in seen:
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
    out[3:3] = ["**New in Recompa: %d** · **New in Joey's list: %d** · **Other new on GitHub: %d** · " % (len(rec_new), len(joey_new), len(listed)) + "**Gone (404): %d** · **No Android build any more: %d** · **Archived: %d** · **Moved: %d**" % (
        len(gone), len(nobuild), len(archived), len(moved)), ""]
    if moved:
        out += [("## Moved (repo name fixed in ports.json)" if args.update_ports else "## Moved (update `repo` in data/ports.json)"), ""] + ["- %s → **%s**" % m for m in moved] + [""]
    if gone:
        out += [("## Gone (404, flagged in ports.json; kept for anyone who installed it)" if args.update_ports else "## Gone (404)"), ""] + ["- %s (%s)" % (r, ", ".join(p["name"] for p in by_repo[r])) for r in gone] + [""]
    if archived:
        out += ["## Archived (no more updates)", ""] + ["- %s" % r for r in archived] + [""]
    if nobuild:
        out += ["## No Android build in the latest releases (the app already hides these)", ""] + ["- %s (last push %s)" % m for m in nobuild] + [""]
    def line(x):
        links = ", ".join("[%s](https://github.com/%s)" % (r, r) for r in x["repos"])
        return "- %s%s (%s%s): %s%s%s" % (x["game"] or x["name"], " / " + x["name"] if x["game"] and x["name"] and x["game"] != x["name"] else "",
                                          x["platform"], ", " + x["type"] if x["type"] else "", links,
                                          ", latest " + x["released"] if x["released"] else "", "" if x["apk"] else " (no APK in its release)")
    if not src_ok["recompa"]:
        out += ["_Recompa's list could not be read this time._", ""]
    if not src_ok["joey"]:
        out += ["_Joey's list could not be read this time._", ""]
    if rec_new:
        out += ["## New in Recompa's list (not in ports.json)", ""] + [line(x) for x in rec_new] + [""]
    if joey_new:
        out += ["## New in Joey's list only (not in ports.json or Recompa)", ""] + [line(x) for x in joey_new] + [""]
    problems = problems or bool(rec_new or joey_new)
    if listed:
        out += ["## Other new ports found by searching GitHub", "",
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
    text = "\n".join(out)
    if len(text) > 60000:  # a GitHub issue holds 65,536 characters
        text = text[:60000].rsplit("\n", 1)[0] + "\n\n_The list was cut to fit. Add repos you don't want to see to data/ports-ignored.txt._\n"
    open(args.out, "w", encoding="utf-8").write(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
