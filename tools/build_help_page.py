#!/usr/bin/env python3
"""Builds the web version of the Help guide (docs/user-guide.html) from the app's own files.

The words are in app/src/main/assets/www/js/help-content.js and the look in css/help.css, the same files the app's
Help window uses, so after changing the guide just run this again:

    python3 tools/build_help_page.py

The page is a single file with nothing to download apart from the fonts, so it can be posted anywhere.
"""
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
WWW = ROOT / "app/src/main/assets/www"
OUT = ROOT / "docs/user-guide.html"


def theme_css():
    """The fonts, the default colours (:root) and the three other themes, taken from the app's stylesheet."""
    css = (WWW / "css/style.css").read_text(encoding="utf-8")
    fonts = re.search(r"@import url\([^)]*\);", css).group(0)
    root = re.search(r":root\{.*?\n  \}", css, re.S).group(0)
    themes = re.findall(r'html\[data-theme="(?:nintendo|playstation|xbox)"\]\{[^}]*\}', css)
    return "\n".join([fonts, root] + themes)


def main():
    logo = base64.b64encode((WWW / "logos/app.webp").read_bytes()).decode("ascii")
    help_css = (WWW / "css/help.css").read_text(encoding="utf-8")
    content_js = (WWW / "js/help-content.js").read_text(encoding="utf-8")
    help_js = (WWW / "js/help.js").read_text(encoding="utf-8")

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game Log Tracker DS Launcher: Instruction Booklet</title>
<link rel="icon" href="data:image/webp;base64,{logo}">
<style>
{theme_css()}
html,body{{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:var(--font-ui);--status-h:0px;}}
body{{background-image:radial-gradient(circle at 20% 0%, rgba(var(--gold-rgb),0.07), transparent 40%),radial-gradient(circle at 80% 100%, rgba(var(--teal-rgb),0.06), transparent 40%);background-attachment:fixed;min-height:100vh;}}
*{{box-sizing:border-box;}}
{help_css}
.web-foot{{max-width:760px;margin:0 auto;padding:0 14px 48px;text-align:center;color:var(--muted);font-size:14px;}}
.web-foot a{{color:var(--gold);}}
.web-themes{{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:0 0 14px;}}
.web-themes button{{background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:999px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer;}}
.web-themes button.on{{background:var(--gold);color:var(--on-gold);border-color:var(--gold);}}
</style>
</head>
<body>
<div id="guide"></div>
<footer class="web-foot">
  <div class="web-themes" aria-label="Theme">
    <button data-t="retro" class="on">Retro</button><button data-t="nintendo">Nintendo</button><button data-t="playstation">Playstation</button><button data-t="xbox">Xbox</button>
  </div>
  <p><a href="https://github.com/Gin649/Game-Log-Tracker-DS-Launcher/releases" target="_blank" rel="noopener">Download the launcher</a>
  · <a href="https://discord.gg/6dgZA4yD2" target="_blank" rel="noopener">Community Discord</a></p>
</footer>
<script>
{content_js}
</script>
<script>
{help_js}
</script>
<script>
HelpBook.render(document.getElementById('guide'), {{ logo: 'data:image/webp;base64,{logo}' }});
document.querySelectorAll('.web-themes button').forEach(b => b.addEventListener('click', () => {{
  if(b.dataset.t === 'retro') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', b.dataset.t);
  document.querySelectorAll('.web-themes button').forEach(x => x.classList.toggle('on', x === b));
}}));
</script>
</body>
</html>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(page) // 1024} KB)")


if __name__ == "__main__":
    main()
