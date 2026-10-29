#!/usr/bin/env python3
"""Builds the romhack index the Game Log Tracker DS Launcher reads.

The idea (and the approach of reading only the end of each zip) comes from JoeyOS's
build_rapatches.py, used with Joey's permission. This version is its own, simpler thing.

RetroAchievements' RAPatches repo holds about 5,600 patch archives. Searching them from the
phone meant listing the whole repo and then asking for the end of up to 2,000 patches one by
one. This script does that work once, on GitHub, and publishes the answer as one small file:

    ra-patches/index.json   what is in every archive: the patches inside, their format, and for
                            BPS and UPS the checksum of the ROM each one was made for
    ra-patches/cache.json   what was already read, so a run only reads new or changed archives

With that file the app can match a ROM's checksum against every hack and translation in one go,
including the ones packed in zips, which it could not check before downloading them.

    python tools/build_rapatches.py --repo ./RAPatches --source http --out build
    python tools/build_rapatches.py --repo ./RAPatches --source git --only GBA --out build   # offline test

--repo is a clone of RAPatches (a shallow, blobless clone is enough: only the file list is used).
Only the Python standard library is needed.
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

RAW = "https://raw.githubusercontent.com/RetroAchievements/RAPatches/"
UA = {"User-Agent": "GLT-DS-Launcher romhack index"}
SKIP_TOP = {"Removed", "Saves", "Utilities", "misc", "DLC", "Incompatible", "Unsorted", "README.md"}
PATCH_EXT = ("bps", "ips", "ups", "ppf", "aps", "xdelta", "xdelta3", "vcdiff", "vcd")
CRC_EXT = ("bps", "ups")  # these two store the checksum of the ROM they were made for
MAX_CRC_ENTRY = 256 * 1024 * 1024
CACHE_VERSION = 1


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True).stdout


def list_tree(repo):
    """[(path, blob sha)] for every file in the clone."""
    out = git(repo, "ls-tree", "-r", "-z", "HEAD")
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, path = rec.split(b"\t", 1)
        mode, kind, sha = meta.decode().split()
        if kind == "blob":
            yield path.decode("utf-8", "surrogateescape"), sha


def ext_of(name):
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


# ---------------------------------------------------------------- reading archives

class RangeFile:
    """A read-only file made of HTTP range requests, so zipfile can read one entry of a big
    archive without downloading the rest of it."""

    TAIL = 256 * 1024

    def __init__(self, url):
        self.url = url
        self.pos = 0
        self.win_start = 0
        self.win = b""
        self.size = None
        self._load_tail()

    def _request(self, rng):
        last = None
        for attempt in range(4):
            req = urllib.request.Request(self.url, headers={**UA, "Range": rng})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.status, r.headers.get("Content-Range"), r.read()
            except urllib.error.HTTPError as e:
                if e.code == 416:  # smaller than the range asked for: take the whole file
                    req = urllib.request.Request(self.url, headers=UA)
                    with urllib.request.urlopen(req, timeout=60) as r:
                        return 200, None, r.read()
                last = e
                if e.code < 500 and e.code != 429:
                    raise
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last = e
            time.sleep(1.5 * (attempt + 1))
        raise last

    def _load_tail(self):
        status, crange, body = self._request("bytes=-%d" % self.TAIL)
        if status == 200 or not crange:
            self.size = len(body)
            self.win_start, self.win = 0, body
        else:
            self.size = int(crange.rsplit("/", 1)[1])
            self.win_start, self.win = self.size - len(body), body

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        if n == 0:
            return b""
        end = self.pos + n
        if not (self.win_start <= self.pos and end <= self.win_start + len(self.win)):
            want = min(max(n, self.TAIL), self.size - self.pos)
            _, _, body = self._request("bytes=%d-%d" % (self.pos, self.pos + want - 1))
            self.win_start, self.win = self.pos, body
        i = self.pos - self.win_start
        data = self.win[i:i + n]
        self.pos += len(data)
        return data


def open_http(path, sha, repo):
    return RangeFile(RAW + "main/" + urllib.parse.quote(path))


def open_git(path, sha, repo):
    return io.BytesIO(git(repo, "cat-file", "blob", sha))


def bps_ups_source_crc(fh, size, ext):
    """The checksum of the ROM this patch was made for: the first of the three 4-byte values that end the file."""
    magic = fh.read(4)
    if magic != (b"BPS1" if ext == "bps" else b"UPS1"):
        return ""
    tail = magic if size < 12 else b""
    while True:
        chunk = fh.read(1 << 20)
        if not chunk:
            break
        tail = (tail + chunk)[-12:]
    if len(tail) < 12:
        return ""
    return "%08x" % int.from_bytes(tail[:4], "little")


def inspect(path, sha, opener, repo):
    """[[patch name, format, source crc]] for the patches inside an archive, or None when the read failed."""
    ext = ext_of(path)
    name = path.rsplit("/", 1)[-1]
    if ext == "7z":
        return []  # not laid out like a zip; the app lists these by name only
    if ext != "zip":  # a loose patch file
        return [[name, ext, ""]]
    try:
        fh = opener(path, sha, repo)
        with zipfile.ZipFile(fh) as z:
            found = []
            for info in z.infolist():
                if info.is_dir():
                    continue
                pext = ext_of(info.filename)
                if pext not in PATCH_EXT:
                    continue
                crc = ""
                if pext in CRC_EXT and 12 <= info.file_size <= MAX_CRC_ENTRY:
                    with z.open(info) as entry:
                        crc = bps_ups_source_crc(entry, info.file_size, pext)
                found.append([info.filename.replace("\\", "/").rsplit("/", 1)[-1], pext, crc])
            return found
    except zipfile.BadZipFile:
        return []  # genuinely not a readable zip: remembered, not retried every run
    except Exception as e:  # noqa: BLE001 - network trouble: not remembered, tried again next run
        print("  could not read %s: %s" % (path, e), file=sys.stderr)
        return None


# ---------------------------------------------------------------- the index

def describe(path):
    """The folder facts about one file, or None when it is not a patch we list."""
    parts = path.split("/")
    if len(parts) < 2 or parts[0] in SKIP_TOP:
        return None
    ext = ext_of(path)
    if ext not in ("zip", "7z") and ext not in PATCH_EXT:
        return None
    rec = {"p": path}
    if len(parts) >= 3:
        rec["t"] = parts[1]            # Hacks, Translation, Improvement, Fix, Subset ...
    if len(parts) >= 4:
        rec["s"] = parts[2]            # the base game (hacks) or the language (translations)
    m = re.match(r"(\d+)-", parts[-1])
    if m:
        rec["g"] = int(m.group(1))     # the RetroAchievements game this archive is named after
    return rec


def build(repo, out_dir, source, only=None, workers=12):
    opener = open_http if source == "http" else open_git
    cache_file = os.path.join(out_dir, "ra-patches", "cache.json")
    cache = {}
    if os.path.isfile(cache_file):
        try:
            with open(cache_file, encoding="utf-8") as f:
                loaded = json.load(f)
            if loaded.get("_v") == CACHE_VERSION:
                cache = {k: v for k, v in loaded.items() if k != "_v"}
        except (OSError, ValueError):
            cache = {}

    entries = []
    for path, sha in list_tree(repo):
        rec = describe(path)
        if rec and (not only or path.split("/")[0] == only):
            entries.append((rec, sha))

    todo = [(r, s) for r, s in entries if s not in cache]
    print("%d archives, %d known from the cache, reading %d" % (len(entries), len(entries) - len(todo), len(todo)))
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for (rec, sha), inner in zip(todo, pool.map(lambda e: inspect(e[0]["p"], e[1], opener, repo), todo)):
            done += 1
            if inner is not None:
                cache[sha] = inner
            if done % 200 == 0:
                print("  read %d/%d" % (done, len(todo)))

    patches = []
    for rec, sha in entries:
        inner = cache.get(sha)
        if inner is None:
            inner = []  # unreadable right now; still listed by name, read again next run
        if inner:
            rec["i"] = inner
        patches.append(rec)
    patches.sort(key=lambda r: r["p"])

    live = {sha for _, sha in entries}
    os.makedirs(os.path.dirname(cache_file), exist_ok=True)
    with open(cache_file, "w", encoding="utf-8") as f:
        pruned = {k: v for k, v in sorted(cache.items()) if k in live}
        pruned["_v"] = CACHE_VERSION
        json.dump(pruned, f, separators=(",", ":"))
    head = git(repo, "rev-parse", "HEAD").decode().strip()
    with open(os.path.join(out_dir, "ra-patches", "index.json"), "w", encoding="utf-8") as f:
        json.dump({"v": 1, "branch": "main", "commit": head,
                   "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "patches": patches}, f, separators=(",", ":"), ensure_ascii=False)
    withcrc = sum(1 for p in patches if any(i[2] for i in p.get("i", [])))
    print("wrote %d patches (%d with a source checksum)" % (len(patches), withcrc))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True, help="a clone of RetroAchievements/RAPatches")
    ap.add_argument("--out", default="build")
    ap.add_argument("--source", choices=("http", "git"), default="http")
    ap.add_argument("--only", help="one top-level console folder, for a quick test")
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()
    build(a.repo, a.out, a.source, a.only, a.workers)


if __name__ == "__main__":
    main()
