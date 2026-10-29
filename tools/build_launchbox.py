#!/usr/bin/env python3
"""Builds the small per-console art index the app reads, from LaunchBox's public games database.

LaunchBox publishes one big Metadata.zip (games, alternate names, image file names). This keeps only the
consoles named in app/src/main/assets/launchbox.json and, per game, the file names of four pictures:
up to six fan arts (joined with "|"), box front, a screenshot and the clear logo. One JSON file per console is written to
<out>/launchbox/, plus index.json. The app downloads only the consoles it needs; the pictures themselves
come from images.launchbox-app.com when a game is scraped.

    build_launchbox.py --zip Metadata.zip --systems app/src/main/assets/launchbox.json --out out
"""
import argparse
import io
import json
import re
import sys
import time
import zipfile
import xml.etree.ElementTree as ET

WANT = {
    'fan': ['Fanart - Background'],
    'box': ['Box - Front', 'Box - Front - Reconstructed'],
    'shot': ['Screenshot - Gameplay', 'Screenshot - Game Title'],
    'logo': ['Clear Logo'],
}
FIELDS = ['fan', 'box', 'shot', 'logo']
MAX_FAN = 6
REGION_RANK = {'': 0, 'world': 0, 'north america': 1, 'united states': 1, 'canada': 2, 'europe': 3, 'united kingdom': 3,
               'australia': 4, 'japan': 5}


def compact(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def region_rank(r):
    return REGION_RANK.get((r or '').strip().lower(), 9)


def text(el, tag):
    c = el.find(tag)
    return (c.text or '').strip() if c is not None and c.text else ''


def stream(zf, member, tags):
    """Yields each top-level element named in tags, then frees it."""
    with zf.open(member) as f:
        for _, el in ET.iterparse(f, events=('end',)):
            if el.tag in tags:
                yield el
                el.clear()


def build(zf, platforms):
    member = next((n for n in zf.namelist() if n.lower().endswith('metadata.xml')), None)
    if not member:
        sys.exit('Metadata.xml is not in the zip')

    wanted = {compact(p): p for p in platforms}
    games = {}  # DatabaseID -> (name, platform key)
    seen = {}
    for g in stream(zf, member, {'Game'}):
        key = compact(text(g, 'Platform'))
        if key not in wanted:
            continue
        gid, name = text(g, 'DatabaseID'), text(g, 'Name')
        if gid and name:
            games[gid] = (name, key)
            seen[key] = seen.get(key, 0) + 1

    alts = {}   # DatabaseID -> [alternate names]
    best = {}   # (DatabaseID, field) -> (rank, file name)
    fans = {}   # DatabaseID -> [(rank, file name)] every fan art, for choosing between them
    type_to_field = {t: (f, i) for f, ts in WANT.items() for i, t in enumerate(ts)}
    for el in stream(zf, member, {'GameAlternateName', 'GameImage'}):
        gid = text(el, 'DatabaseID')
        if gid not in games:
            continue
        if el.tag == 'GameAlternateName':
            n = text(el, 'AlternateName')
            if n:
                alts.setdefault(gid, []).append(n)
            continue
        hit = type_to_field.get(text(el, 'Type'))
        fn = text(el, 'FileName')
        if not hit or not fn:
            continue
        rank = (hit[1], region_rank(text(el, 'Region')))
        if hit[0] == 'fan':
            fans.setdefault(gid, []).append((rank, fn))
        k = (gid, hit[0])
        if k not in best or rank < best[k][0]:
            best[k] = (rank, fn)

    out = {key: [] for key in wanted}
    for gid, (name, key) in games.items():
        pics = [best.get((gid, f), (None, ''))[1] for f in FIELDS]
        # several fan arts are joined with "|" in the fan column, best first; the app lets you swipe between them
        files = []
        for _, fn in sorted(fans.get(gid, [])):
            if fn not in files:
                files.append(fn)
        pics[0] = '|'.join(files[:MAX_FAN])
        if not any(pics):
            continue
        names = [name]
        for a in alts.get(gid, []):
            if compact(a) != compact(name) and a not in names:
                names.append(a)
        for n in names:
            out[key].append([n] + pics)
    for key, p in wanted.items():
        if key not in seen:
            print('warning: no games found for platform "%s"' % p, file=sys.stderr)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', required=True)
    ap.add_argument('--systems', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--stamp', default='')
    a = ap.parse_args()

    with open(a.systems, encoding='utf-8') as f:
        systems = json.load(f).get('systems', {})
    platforms = sorted({v for v in systems.values() if v})

    import os
    os.makedirs(os.path.join(a.out, 'launchbox'), exist_ok=True)
    with zipfile.ZipFile(a.zip) as zf:
        rows = build(zf, platforms)

    index = {'v': 1, 'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'source': a.stamp, 'platforms': {}}
    for key, games in rows.items():
        if not games:
            continue
        games.sort(key=lambda r: r[0].lower())
        data = json.dumps({'v': 1, 'g': games}, ensure_ascii=False, separators=(',', ':'))
        with open(os.path.join(a.out, 'launchbox', key + '.json'), 'w', encoding='utf-8') as f:
            f.write(data)
        index['platforms'][key] = {'games': len(games), 'bytes': len(data.encode('utf-8'))}
        print('%-40s %6d rows %8.1f KB' % (key, len(games), len(data.encode('utf-8')) / 1024))
    with open(os.path.join(a.out, 'launchbox', 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, separators=(',', ':'))


if __name__ == '__main__':
    main()
