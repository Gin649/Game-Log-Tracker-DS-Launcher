#!/usr/bin/env python3
"""Builds the console logos shown in the console bar (Display Options, Console bar, Logos).

The source is Dan Patrick's console logo set, "Recommended Versions (Normal) (1 Per Platform) v2.1 / Light - Color",
mirrored at https://github.com/PRO100BYTE/console-logos. Point this at that folder:

    python3 tools/build_console_logos.py "<path>/Light - Color"

Each logo is trimmed to its drawing, shrunk to bar size and saved as WebP in assets/www/logos/consoles.
js/console-logos.js is written beside them: it maps a console's name (letters and digits only, lower case, the
same way views.js shortens names) to its file. Add a console by adding a line to LOGOS and running this again.
"""
import json
import os
import re
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www')
OUT_DIR = os.path.join(WWW, 'logos', 'consoles')
OUT_JS = os.path.join(WWW, 'js', 'console-logos.js')

MAX_H, MAX_W = 112, 448  # about three times the tallest blade, so it stays sharp on the Thor's screen

# file name to save as: (source picture, the console names that use it)
LOGOS = {
    'nes': ('Consoles/Nintendo Entertainment System.png', ['NES/Famicom', 'NES', 'Nintendo Entertainment System', 'Famicom']),
    'fds': ('Consoles/Nintendo Famicom Disk System.png', ['Famicom Disk System']),
    'snes': ('Consoles/Super Nintendo Entertainment System.png', ['SNES/Super Famicom', 'SNES', 'Super Nintendo', 'Super Famicom']),
    'n64': ('Consoles/Nintendo 64.png', ['Nintendo 64', 'N64']),
    'gamecube': ('Consoles/Nintendo GameCube.png', ['GameCube', 'Nintendo GameCube']),
    'wii': ('Consoles/Nintendo Wii.png', ['Wii', 'Nintendo Wii']),
    'wiiu': ('Consoles/Nintendo Wii U.png', ['Wii U', 'Nintendo Wii U']),
    'switch': ('Consoles/Nintendo Switch.png', ['Nintendo Switch', 'Switch']),
    'switch2': ('extra:switch2.jpg', ['Nintendo Switch 2', 'Switch 2']),
    'gb': ('Handhelds/Nintendo Game Boy.png', ['Game Boy']),
    'gbc': ('Handhelds/Nintendo Game Boy Color.png', ['Game Boy Color']),
    'gba': ('Handhelds/Nintendo Game Boy Advance.png', ['Game Boy Advance']),
    'nds': ('Handhelds/Nintendo DS.png', ['Nintendo DS']),
    'dsi': ('Handhelds/Nintendo DSi.png', ['Nintendo DSi']),
    '3ds': ('Handhelds/Nintendo 3DS.png', ['Nintendo 3DS']),
    'virtualboy': ('Consoles/Nintendo Virtual Boy.png', ['Virtual Boy']),
    'pokemonmini': ('Handhelds/Nintendo Pokémon Mini.png', ['Pokemon Mini']),
    'genesis': ('Consoles/Sega Genesis.png', ['Genesis/Mega Drive', 'Genesis', 'Sega Genesis']),
    'megadrive': ('Consoles/Sega Mega Drive.png', ['Mega Drive', 'Sega Mega Drive']),
    'mastersystem': ('Consoles/Sega Master System.png', ['Master System', 'Sega Master System']),
    'gamegear': ('Handhelds/Sega Game Gear.png', ['Game Gear', 'Sega Game Gear']),
    'segacd': ('Consoles/Sega CD.png', ['Sega CD']),
    '32x': ('Consoles/Sega 32X.png', ['32X', 'Sega 32X']),
    'saturn': ('Consoles/Sega Saturn.png', ['Saturn', 'Sega Saturn']),
    'dreamcast': ('Consoles/Sega Dreamcast.png', ['Dreamcast', 'Sega Dreamcast']),
    'sg1000': ('Consoles/Sega SG-1000.png', ['SG-1000']),
    'ps1': ('Consoles/Sony Playstation.png', ['PlayStation', 'PlayStation 1']),
    'ps2': ('Consoles/Sony Playstation 2.png', ['PlayStation 2']),
    'ps3': ('Consoles/Sony Playstation 3.png', ['PlayStation 3']),
    'ps4': ('Consoles/Sony Playstation 4.png', ['PlayStation 4']),
    'ps5': ('Consoles/Sony Playstation 5.png', ['PlayStation 5']),
    'psp': ('Handhelds/Sony PSP.png', ['PlayStation Portable', 'PSP']),
    'vita': ('Handhelds/Sony PS Vita.png', ['PlayStation Vita', 'PS Vita']),
    'xbox': ('Consoles/Microsoft Xbox.png', ['Xbox', 'Original Xbox']),
    'xbox360': ('Consoles/Microsoft Xbox 360.png', ['Xbox 360']),
    'xboxone': ('Consoles/Microsoft Xbox One.png', ['Xbox One']),
    'xboxseries': ('Consoles/Microsoft Xbox Series.png', ['Xbox Series X|S', 'Xbox Series X', 'Xbox Series S', 'Xbox Series']),
    'pcengine': ('Consoles/NEC TurboGrafx-16.png', ['PC Engine/TurboGrafx-16', 'TurboGrafx-16', 'PC Engine']),
    'pcenginecd': ('Consoles/NEC TurboGrafx-CD.png', ['PC Engine CD/TurboGrafx-CD', 'TurboGrafx-CD', 'PC Engine CD']),
    'pcfx': ('Consoles/NEC PC-FX.png', ['PC-FX']),
    'neogeo': ('Consoles/SNK Neo Geo.png', ['Neo Geo']),
    'neogeocd': ('Consoles/SNK Neo Geo CD.png', ['Neo Geo CD']),
    'neogeopocket': ('Handhelds/SNK Neo Geo Pocket.png', ['Neo Geo Pocket']),
    'atari2600': ('Consoles/Atari 2600.png', ['Atari 2600']),
    'atari5200': ('Consoles/Atari 5200.png', ['Atari 5200']),
    'atari7800': ('Consoles/Atari 7800.png', ['Atari 7800']),
    'lynx': ('Handhelds/Atari Lynx.png', ['Atari Lynx']),
    'jaguar': ('Consoles/Atari Jaguar.png', ['Atari Jaguar']),
    'jaguarcd': ('Consoles/Atari Jaguar CD.png', ['Atari Jaguar CD']),
    'arcade': ('Arcade/Arcade Classics.png', ['Arcade']),
    '3do': ('Consoles/3DO Interactive Multiplayer.png', ['3DO Interactive Multiplayer', '3DO']),
    'colecovision': ('Consoles/ColecoVision.png', ['ColecoVision']),
    'intellivision': ('Consoles/Mattel Intellivision.png', ['Intellivision']),
    'msx': ('Computers/Microsoft MSX.png', ['MSX']),
    'wonderswan': ('Handhelds/WonderSwan.png', ['WonderSwan']),
    'odyssey2': ('Consoles/Magnavox Odyssey 2.png', ['Magnavox Odyssey 2']),
    'vectrex': ('Consoles/GCE Vectrex.png', ['Vectrex']),
    'appleii': ('Computers/Apple II.png', ['Apple II']),
    'pc88': ('Computers/NEC PC-8801.png', ['PC-8000/8800', 'PC-8801']),
    'amstradcpc': ('Computers/Amstrad CPC.png', ['Amstrad CPC']),
    'channelf': ('Consoles/Fairchild Channel F.png', ['Fairchild Channel F']),
    'supervision': ('Handhelds/Watara Supervision.png', ['Watara Supervision']),
    'megaduck': ('Handhelds/Mega Duck.png', ['Mega Duck']),
    'arcadia2001': ('Consoles/Emerson Arcadia 2001.png', ['Arcadia 2001']),
    'amiga': ('Computers/Commodore Amiga.png', ['Amiga', 'Commodore Amiga']),
    'c64': ('Computers/Commodore 64.png', ['Commodore 64']),
    'zxspectrum': ('Computers/Sinclair ZX Spectrum.png', ['ZX Spectrum']),
    'dos': ('Computers/MS-DOS.png', ['DOS', 'MS-DOS']),
    'windows': ('Computers/Windows.png', ['PC', 'Windows']),
    'android': ('Handhelds/Android.png', ['Android']),
}


# Dark logos that are hard to read on the app's dark themes. Their dark colours are lightened, the rest is left alone.
LIFT = {'gb', 'gbc', 'c64', 'intellivision'}


def lift(im, below=0.42, by=0.45):
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < below:
                px[x, y] = (round(r + (255 - r) * by), round(g + (255 - g) * by), round(b + (255 - b) * by), a)
    return im


def norm(name):
    return re.sub(r'[^a-z0-9]+', '', name.lower())


def shrink(path):
    im = Image.open(path).convert('RGBA')
    box = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    if box:
        im = im.crop(box)
    scale = min(MAX_H / im.height, MAX_W / im.width, 1)
    return im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    os.makedirs(OUT_DIR, exist_ok=True)
    index = {}
    for slug, (rel, names) in sorted(LOGOS.items()):
        # 'extra:' pictures are not in the set. They are kept in tools/console-logos-extra.
        path = os.path.join(HERE, 'console-logos-extra', rel[6:]) if rel.startswith('extra:') else os.path.join(src, rel)
        if not os.path.isfile(path):
            print('missing:', rel)
            continue
        im = shrink(path)
        if slug in LIFT:
            im = lift(im)
        im.save(os.path.join(OUT_DIR, slug + '.webp'), 'WEBP', quality=88, method=6)
        for n in names:
            index[norm(n)] = slug
    with open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write('// Console logos for the console bar. Written by tools/build_console_logos.py, so change that and run it again.\n')
        f.write('// A console name with only its letters and digits, lower case, gives the file in logos/consoles.\n')
        f.write('const CONSOLE_LOGOS = ' + json.dumps(index, sort_keys=True, separators=(',', ':')) + ';\n')
    print(len(set(index.values())), 'logos,', len(index), 'names')


if __name__ == '__main__':
    main()
