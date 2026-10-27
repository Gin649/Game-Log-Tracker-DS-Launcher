// RetroAchievements guides: lookup in the RetroAchievements/guides wiki, download, and the
// "Find on RetroAchievements Guides" section of the Game Guide panel.
//
// The wiki's pages are Markdown files in a git repo (github.com/RetroAchievements/guides.wiki).
// GitHub only turns them into HTML on its own website, and github.com sends no CORS headers,
// so the app can't fetch that rendered page. raw.githubusercontent.com does allow
// cross-origin requests (the ROM patcher already depends on that), so the app downloads the
// Markdown source, converts it to HTML here, runs it through sanitizeGuideHtml, and saves it
// as an ordinary 'html' guide. The reader then gives it search, bookmarks and text options
// like any other guide. Needs archiveKey / archiveFetch / sanitizeGuideHtml / addGuide /
// guideEsc from the earlier scripts, so load it after guides.js.

  const RAG_OWNER = 'RetroAchievements';
  const RAG_REPO = 'guides';
  const RAG_INDEX_FILE = './ra-guides-index.json'; // built daily by tools/build-ra-guides-index.mjs
  const RAG_INDEX_CACHE_KEY = 'ra-guides-index:cache';

  // The wiki renders a single newline inside a paragraph as a line break (like a GitHub
  // comment), and many authors rely on it. Set to false for strict CommonMark behaviour.
  const RAG_HARD_BREAKS = true;

  // Markdown to HTML
  // A small converter for the part of GitHub-flavoured Markdown the guides use: headings,
  // emphasis, links and images, lists (nested, ordered, task), block quotes, tables, code,
  // rules, reference links and passthrough HTML blocks. Output is always sanitized afterwards.

  function ragEsc(s){
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // GitHub's heading-anchor rule: lowercase, drop punctuation, spaces become hyphens.
  function ragSlug(text){
    return String(text || '').toLowerCase().trim()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
  }

  // Only web links survive. A link with no scheme is another page of the wiki; #fragments
  // are mapped onto the ids this converter gives its headings.
  function ragUrl(raw){
    let u = String(raw || '').trim();
    if(u.charAt(0) === '<' && u.charAt(u.length - 1) === '>') u = u.slice(1, -1).trim();
    if(!u) return '';
    if(u.charAt(0) === '#'){
      let frag = u.slice(1);
      try{ frag = decodeURIComponent(frag); }catch(e){}
      return '#g-' + ragSlug(frag);
    }
    if(/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
    if(u.slice(0, 2) === '//') return 'https:' + u;
    if(/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''; // javascript:, data:, etc.
    if(u.charAt(0) === '/') return '';
    return `https://github.com/${RAG_OWNER}/${RAG_REPO}/wiki/` + u;
  }

  const RAG_LINK_URL = '(<[^>]*>|(?:[^\\s()]|\\([^\\s()]*\\))*)(?:\\s+(?:"[^"]*"|\'[^\']*\'))?';
  const RAG_IMG_RE = new RegExp('!\\[((?:[^\\[\\]]|\\[[^\\]]*\\])*)\\]\\(\\s*' + RAG_LINK_URL + '\\s*\\)', 'g');
  const RAG_LINK_RE = new RegExp('\\[((?:[^\\[\\]]|\\[[^\\]]*\\])*)\\]\\(\\s*' + RAG_LINK_URL + '\\s*\\)', 'g');

  // Placeholders (\u0000<n>\u0001) keep finished HTML, code and URLs out of the way of the
  // emphasis rules, so an underscore in a URL or an attribute value is never mistaken for markup.
  function ragInline(src, refs){
    const stash = [];
    const hold = html => { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0001'; };

    function trimUrl(u){
      let tail = '';
      for(;;){
        const c = u.charAt(u.length - 1);
        if(/[.,;:!?'"*_~]/.test(c) || (c === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length)){
          tail = c + tail; u = u.slice(0, -1);
        }else break;
      }
      return [u, tail];
    }
    function anchor(url, innerHtml){
      const ext = url.charAt(0) !== '#' ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${ragEsc(url)}"${ext}>${innerHtml}</a>`;
    }

    // everything that works on running text, applied to the main text and to link text.
    // Inside link text (inLink) URLs are left alone: a link can't contain another link.
    function fmt(t, inLink){
      if(!inLink) t = t.replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi, (m, url) => hold(anchor(url, ragEsc(url))));
      t = t.replace(/<\/?[a-zA-Z][^<>]*>|<!--[\s\S]*?-->/g, m => hold(m));
      t = t.replace(/</g, '&lt;');
      if(!inLink) t = t.replace(/(^|[\s(>])((?:https?:\/\/|www\.)[^\s<]+)/gi, (m, pre, url) => {
        const [clean, tail] = trimUrl(url);
        if(!clean) return m;
        const href = /^www\./i.test(clean) ? 'https://' + clean : clean;
        return pre + hold(anchor(href, ragEsc(clean))) + tail;
      });
      t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
      t = t.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>');
      t = t.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|\W)__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
      t = t.replace(/(^|[^*\w])\*([^\s*](?:[^*]*[^\s*])?)\*(?!\*)/g, '$1<em>$2</em>');
      t = t.replace(/(^|\W)_([^\s_](?:[^_]*[^\s_])?)_(?!\w)/g, '$1<em>$2</em>');
      return t;
    }

    let s = String(src);
    s = s.replace(/(``+)([\s\S]+?)\1/g, (m, f, code) => hold('<code>' + ragEsc(code.trim()) + '</code>'));
    s = s.replace(/`([^`\n]+)`/g, (m, code) => hold('<code>' + ragEsc(code) + '</code>'));
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~<>])/g, (m, c) => hold(ragEsc(c)));

    s = s.replace(RAG_IMG_RE, (m, alt, url) => {
      const href = ragUrl(url);
      if(!/^https?:\/\//i.test(href)) return hold(ragEsc(alt));
      const badge = /media\.retroachievements\.org\/Badge\//i.test(href) ? ' class="ra-badge"' : '';
      return hold(`<img src="${ragEsc(href)}" alt="${ragEsc(alt)}" loading="lazy" referrerpolicy="no-referrer"${badge}>`);
    });
    s = s.replace(RAG_LINK_RE, (m, text, url) => {
      const href = ragUrl(url);
      return href ? hold(anchor(href, fmt(text, true))) : fmt(text);
    });
    // reference links: [text][ref], [ref][]
    if(refs){
      s = s.replace(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\[([^\]]*)\]/g, (m, text, ref) => {
        const def = refs[String(ref || text).toLowerCase().trim()];
        const href = def ? ragUrl(def) : '';
        return href ? hold(anchor(href, fmt(text, true))) : m;
      });
    }
    s = fmt(s);

    s = s.replace(/[ \t]*\n[ \t]*/g, m => RAG_HARD_BREAKS ? '<br>\n' : '\n');
    for(let guard = 0; guard < 20 && /\u0000\d+\u0001/.test(s); guard++){
      s = s.replace(/\u0000(\d+)\u0001/g, (m, i) => stash[+i]);
    }
    return s;
  }

  const RAG_LIST_RE = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
  const RAG_HTML_BLOCK_RE = /^ {0,3}<\/?(details|summary|div|p|center|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|h[1-6]|pre|hr|figure|figcaption|section|dl|dt|dd)(?=[\s>\/]|$)/i;
  const RAG_FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*[^`]*$/;
  const RAG_HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  const RAG_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  function ragIndentOf(l){
    const m = l.match(/^[ \t]*/)[0];
    return m.replace(/\t/g, '    ').length;
  }
  function ragIsBlank(l){ return /^\s*$/.test(l); }
  function ragStartsBlock(l){
    if(RAG_FENCE_RE.test(l) || RAG_HR_RE.test(l) || /^ {0,3}#{1,6}(\s|$)/.test(l) || /^ {0,3}>/.test(l) || RAG_HTML_BLOCK_RE.test(l)) return true;
    const m = l.match(RAG_LIST_RE);
    if(m && l.trim().length > m[2].length){
      return !/^\d/.test(m[2]) || parseInt(m[2], 10) === 1; // only "1." can interrupt a paragraph
    }
    return false;
  }
  function ragSplitRow(line){
    let t = line.trim();
    if(t.charAt(0) === '|') t = t.slice(1);
    if(t.charAt(t.length - 1) === '|' && t.charAt(t.length - 2) !== '\\') t = t.slice(0, -1);
    const cells = []; let cur = '';
    for(let i = 0; i < t.length; i++){
      const c = t.charAt(i);
      if(c === '\\' && t.charAt(i + 1) === '|'){ cur += '|'; i++; }
      else if(c === '|'){ cells.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function ragBlocks(lines, ctx, tight){
    const out = [];
    const n = lines.length;
    let i = 0;
    while(i < n){
      const line = lines[i];
      if(ragIsBlank(line)){ i++; continue; }

      // fenced code
      let m = line.match(RAG_FENCE_RE);
      if(m){
        const fence = m[1];
        const close = new RegExp('^ {0,3}' + (fence.charAt(0) === '`' ? '`' : '~') + '{' + fence.length + ',}\\s*$');
        const buf = [];
        i++;
        while(i < n && !close.test(lines[i])){ buf.push(lines[i]); i++; }
        i++;
        out.push('<pre><code>' + ragEsc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // heading
      m = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/);
      if(m){
        const level = m[1].length;
        const raw = (m[2] || '').trim();
        out.push(ragHeading(level, raw, ctx));
        i++;
        continue;
      }

      if(RAG_HR_RE.test(line)){ out.push('<hr>'); i++; continue; }

      // raw HTML block, runs to the next blank line (a <pre> runs to its closing tag)
      m = line.match(RAG_HTML_BLOCK_RE);
      if(m){
        const buf = [];
        if(m[1].toLowerCase() === 'pre'){
          while(i < n){ buf.push(lines[i]); if(/<\/pre>/i.test(lines[i])){ i++; break; } i++; }
        }else{
          while(i < n && !ragIsBlank(lines[i])){ buf.push(lines[i]); i++; }
        }
        out.push(buf.join('\n'));
        continue;
      }

      // block quote (a following non-blank line that starts nothing new continues it)
      if(/^ {0,3}>/.test(line)){
        const buf = [];
        while(i < n){
          const l = lines[i];
          if(/^ {0,3}>/.test(l)){ buf.push(l.replace(/^ {0,3}> ?/, '')); i++; }
          else if(!ragIsBlank(l) && buf.length && !ragIsBlank(buf[buf.length - 1]) && !ragStartsBlock(l)){ buf.push(l); i++; }
          else break;
        }
        out.push('<blockquote>' + ragBlocks(buf, ctx, false) + '</blockquote>');
        continue;
      }

      // list
      m = line.match(RAG_LIST_RE);
      if(m){
        const res = ragList(lines, i, ctx);
        out.push(res.html);
        i = res.next;
        continue;
      }

      // table
      if(line.indexOf('|') !== -1 && i + 1 < n && RAG_DELIM_RE.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1){
        const head = ragSplitRow(line);
        const delim = ragSplitRow(lines[i + 1]);
        if(head.length === delim.length){
          const aligns = delim.map(d => /^:-+:$/.test(d) ? 'center' : /-:$/.test(d) ? 'right' : /^:-/.test(d) ? 'left' : '');
          const cell = (tag, txt, k) => `<${tag}${aligns[k] ? ` align="${aligns[k]}"` : ''}>${ragInline(txt, ctx.refs)}</${tag}>`;
          let html = '<div class="ra-table-wrap"><table><thead><tr>' + head.map((h, k) => cell('th', h, k)).join('') + '</tr></thead><tbody>';
          i += 2;
          while(i < n && !ragIsBlank(lines[i]) && lines[i].indexOf('|') !== -1){
            const cells = ragSplitRow(lines[i]);
            while(cells.length < head.length) cells.push('');
            html += '<tr>' + cells.slice(0, head.length).map((c, k) => cell('td', c, k)).join('') + '</tr>';
            i++;
          }
          out.push(html + '</tbody></table></div>');
          continue;
        }
      }

      // paragraph (or a setext heading when an === / --- line follows it)
      const buf = [line.replace(/^\s+/, '')];
      i++;
      let setext = 0;
      while(i < n && !ragIsBlank(lines[i])){
        const l = lines[i];
        const su = l.match(/^ {0,3}(=+|-+)[ \t]*$/);
        if(su){ setext = su[1].charAt(0) === '=' ? 1 : 2; i++; break; }
        if(ragStartsBlock(l)) break;
        buf.push(l.replace(/^\s+/, ''));
        i++;
      }
      if(setext) out.push(ragHeading(setext, buf.join(' '), ctx));
      else{
        const html = ragInline(buf.join('\n'), ctx.refs);
        out.push(tight ? html : '<p>' + html + '</p>');
      }
    }
    return out.join('\n');
  }

  function ragHeading(level, raw, ctx){
    const plain = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '');
    let slug = ragSlug(plain) || 'section';
    const seen = ctx.slugs[slug] || 0;
    ctx.slugs[slug] = seen + 1;
    if(seen) slug += '-' + seen;
    return `<h${level} id="g-${ragEsc(slug)}">${ragInline(raw, ctx.refs)}</h${level}>`;
  }

  // One list: finds where it ends, splits it into items, and renders each item's content
  // as blocks of its own (that is how nesting works).
  function ragList(lines, start, ctx){
    const n = lines.length;
    const first = lines[start].match(RAG_LIST_RE);
    const ordered = /^\d/.test(first[2]);
    const markerKind = ordered ? first[2].slice(-1) : first[2];
    const startNum = ordered ? parseInt(first[2], 10) : 1;
    const items = [];
    let loose = false;
    let i = start;

    const sameList = mm => !!mm && /^\d/.test(mm[2]) === ordered && (ordered ? mm[2].slice(-1) === markerKind : mm[2] === markerKind);
    const makeItem = (l, mm) => {
      const spaces = mm[3].replace(/\t/g, '    ').length;
      const gap = (mm[3] !== '' && spaces >= 1 && spaces <= 4) ? spaces : 1; // 5+ spaces means code after the marker
      return { offset: mm[1].length + mm[2].length + gap, lines: [l.slice(mm[0].length)], blank: false };
    };

    let cur = makeItem(lines[start], first);
    items.push(cur);
    i++;
    while(i < n){
      const l = lines[i];
      if(ragIsBlank(l)){
        let j = i + 1;
        while(j < n && ragIsBlank(lines[j])) j++;
        if(j >= n) break;
        const nl = lines[j];
        const nm = nl.match(RAG_LIST_RE);
        if(ragIndentOf(nl) >= cur.offset){ cur.lines.push(''); cur.blank = true; i++; continue; } // more of this item
        if(nm && sameList(nm) && !RAG_HR_RE.test(nl)){ loose = true; i = j; continue; }          // next item after a gap
        break;
      }
      const mm = l.match(RAG_LIST_RE);
      if(ragIndentOf(l) >= cur.offset){
        const flat = l.replace(/\t/g, '    ');
        cur.lines.push(flat.slice(Math.min(cur.offset, flat.match(/^ */)[0].length)));
        i++;
        continue;
      }
      if(mm && !RAG_HR_RE.test(l)){
        if(!sameList(mm)) break;
        cur = makeItem(l, mm);
        items.push(cur);
        i++;
        continue;
      }
      const prev = cur.lines[cur.lines.length - 1];
      if(!ragIsBlank(prev) && !ragStartsBlock(l)){ cur.lines.push(l.replace(/^\s+/, '')); i++; continue; } // lazy continuation
      break;
    }

    const isLoose = loose || items.some(it => it.blank);
    const body = items.map(it => {
      let text = it.lines;
      let box = '';
      const task = (text[0] || '').match(/^\[([ xX])\][ \t]+/);
      if(task){ box = task[1] === ' ' ? '\u2610 ' : '\u2611 '; text = [text[0].slice(task[0].length)].concat(text.slice(1)); }
      const inner = ragBlocks(text, ctx, !isLoose);
      return '<li>' + box + inner + '</li>';
    }).join('\n');
    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
    return { html: `<${tag}${startAttr}>\n${body}\n</${tag}>`, next: i };
  }

  function ragRenderMarkdown(md){
    let text = String(md || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
    const ctx = { slugs: {}, refs: {} };
    // reference definitions: [name]: https://… "title"
    text = text.replace(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]*>|\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/gm, (m, name, url) => {
      ctx.refs[name.toLowerCase().trim()] = url;
      return '';
    });
    return ragBlocks(text.split('\n'), ctx, false);
  }

  // Finding a guide
  // RetroAchievements console id -> how that console appears in a wiki page name,
  // e.g. "Paper Mario (Nintendo 64)". The first name is the usual spelling.
  const RAG_CONSOLES = {
    1:['Genesis','Mega Drive','Sega Genesis'], 2:['Nintendo 64','N64'], 3:['SNES','Super Nintendo','Super Famicom'],
    4:['Game Boy','GB'], 5:['Game Boy Advance','GBA'], 6:['Game Boy Color','GBC'], 7:['NES','Famicom'],
    8:['PC Engine','TurboGrafx-16','PCE'], 9:['Sega CD','Mega CD'], 10:['32X'], 11:['Master System','SMS'],
    12:['PlayStation','PSX','PS1'], 13:['Atari Lynx','Lynx'], 14:['Neo Geo Pocket'], 15:['Game Gear'],
    16:['GameCube','GCN'], 17:['Atari Jaguar','Jaguar'], 18:['Nintendo DS','NDS','DS'], 19:['Wii'],
    21:['PlayStation 2','PS2'], 23:['Magnavox Odyssey 2'], 24:['Pokemon Mini'], 25:['Atari 2600'], 27:['Arcade'],
    28:['Virtual Boy'], 29:['MSX'], 33:['SG 1000'], 38:['Apple II'], 39:['Saturn','Sega Saturn'], 40:['Dreamcast'],
    41:['PlayStation Portable','PSP'], 43:['3DO Interactive Multiplayer','3DO'], 44:['ColecoVision'],
    45:['Intellivision'], 46:['Vectrex'], 49:['PC FX'], 51:['Atari 7800'], 53:['WonderSwan'], 56:['Neo Geo CD'],
    76:['PC Engine CD','PCE CD'], 77:['Atari Jaguar CD'], 78:['Nintendo DSi'], 81:['Famicom Disk System']
  };
  // Consoles that share games, so a "(Game Boy)" page still fits a Game Boy Color game.
  const RAG_FAMILIES = [[4, 6], [8, 76], [7, 81], [18, 78], [1, 9, 10], [14]];
  const ragTagNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const RAG_TAG_TO_CONSOLE = {};
  Object.keys(RAG_CONSOLES).forEach(id => RAG_CONSOLES[id].forEach(name => { RAG_TAG_TO_CONSOLE[ragTagNorm(name)] = Number(id); }));
  function ragSameConsole(a, b){
    if(a === b) return true;
    return RAG_FAMILIES.some(f => f.includes(a) && f.includes(b));
  }

  // Words a guide's name may add to the game's title and still be about that game.
  const RAG_NOISE = new Set(('achievement achievements cheevo cheevos guide guides missable missables walkthrough roadmap ' +
    'checklist checklists treasure treasures set subset bonus full complete list locations location notes postgame tips ' +
    'strategy hunt related misc gameplay mechanics tricks exploits drops monster monsters bestiary entries scan scrapbook ' +
    'route routing simple version edition').split(' '));

  // Words the game's own title may carry that the wiki page leaves out.
  const RAG_TITLE_NOISE = new Set(['version', 'edition']);

  const ragNorm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const ragDisplayTitle = page => String(page).replace(/-/g, ' ');
  const ragRawUrl = page => `https://raw.githubusercontent.com/wiki/${RAG_OWNER}/${RAG_REPO}/${encodeURIComponent(page)}.md`;
  const ragPageUrl = page => `https://github.com/${RAG_OWNER}/${RAG_REPO}/wiki/${encodeURIComponent(page)}`;

  function ragMakeEntry(page){
    const spaced = ragDisplayTitle(page);
    let consoleId = null;
    const tags = spaced.match(/\(([^()]*)\)/g) || [];
    for(const t of tags){
      const id = RAG_TAG_TO_CONSOLE[ragTagNorm(t.slice(1, -1))];
      if(id){ consoleId = id; break; }
    }
    const key = archiveKey(ragNorm(spaced));
    return {
      page,
      title: spaced,
      key,
      words: new Set(key.split(' ').filter(Boolean)),
      consoleId,
      hack: /~[^~]+~|\((hack|homebrew)\)/i.test(spaced),
      wip: /^\s*[(\[]wip[)\]]/i.test(spaced),
      search: ragNorm(spaced).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    };
  }

  let ragIndexMem = null;
  // The index is a same-origin file the daily GitHub Action keeps fresh. The last copy that
  // loaded is kept in storage, so the lookup also works offline. null when neither exists.
  async function ragLoadIndex(){
    if(ragIndexMem) return ragIndexMem;
    let data = null;
    try{
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try{
        const res = await fetch(RAG_INDEX_FILE, { cache: 'no-store', signal: controller.signal });
        if(res.ok){
          const j = await res.json();
          if(j && Array.isArray(j.pages) && j.pages.length) data = j;
        }
      }finally{ clearTimeout(timer); }
    }catch(e){ /* offline, or the file hasn't been built yet */ }
    if(data){
      try{ await window.storage.set(RAG_INDEX_CACHE_KEY, JSON.stringify(data), false); }catch(e){}
    }else{
      try{
        const r = await window.storage.get(RAG_INDEX_CACHE_KEY, false);
        if(r && r.value){
          const j = JSON.parse(r.value);
          if(j && Array.isArray(j.pages) && j.pages.length) data = j;
        }
      }catch(e){}
    }
    if(!data) return null;
    ragIndexMem = { entries: data.pages.map(ragMakeEntry), generatedAt: data.generatedAt || '' };
    return ragIndexMem;
  }

  // Closest wiki pages for a game, best first. A page is a match when its name (console tag,
  // [Subset] tags and "(WIP)" aside) is the game's title, or the title plus words like
  // "Achievement Guide" or "Roadmap", or begins with a title of three or more words.
  function ragMatchGame(entries, title, consoleId){
    const cid = Number(consoleId) || null;
    const variants = [];
    const add = (name, weight) => {
      const k = archiveKey(ragNorm(name));
      if(k && !variants.some(v => v.key === k)) variants.push({ key: k, words: k.split(' '), weight });
    };
    add(title, 1);
    [' - ', ': '].forEach(sep => {
      const i = title.indexOf(sep);
      if(i >= 0){ add(title.slice(0, i), 0.7); add(title.slice(i + sep.length), 0.7); }
    });
    const gameHack = /~[^~]+~/.test(title);
    const out = [];
    entries.forEach(e => {
      if(e.hack !== gameHack) return;
      if(cid && e.consoleId && !ragSameConsole(e.consoleId, cid)) return;
      let score = 0;
      variants.forEach(v => {
        if(v.weight < 1 && v.words.length < 2) return;
        let s = 0;
        if(e.key === v.key) s = 100;
        else if(e.words.size >= 2 && [...e.words].every(w => v.words.includes(w)) && v.words.filter(w => !e.words.has(w)).every(w => RAG_TITLE_NOISE.has(w))){
          s = 78; // RA says "Pokemon Crystal Version", the wiki page is "Pokemon Crystal (Game Boy Color)"
        }else if(v.words.every(w => e.words.has(w))){
          const extras = [...e.words].filter(w => !v.words.includes(w));
          if(extras.every(w => RAG_NOISE.has(w))) s = 80 - extras.length;
          else if(v.words.length >= 3 && e.key.startsWith(v.key + ' ')) s = 55;
        }
        score = Math.max(score, s * v.weight);
      });
      if(!score) return;
      if(cid && e.consoleId) score += 10;
      if(e.wip) score -= 1;
      out.push({ entry: e, score });
    });
    out.sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length);
    return out.slice(0, 8).map(x => x.entry);
  }

  // Every word you type must appear in the page name (the last one may be a prefix).
  function ragSearch(entries, query){
    const words = ragNorm(query).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if(!words.length) return [];
    const hits = entries.filter(e => {
      const have = e.search.split(' ');
      return words.every((w, i) => i === words.length - 1 ? have.some(h => h.startsWith(w)) : have.includes(w));
    });
    hits.sort((a, b) => a.title.length - b.title.length);
    return hits.slice(0, 30);
  }

  // Without an index (not built yet, and never loaded), try the usual "Title (Console)" name
  // directly. HEAD requests only; nothing is downloaded until the person taps Save.
  async function ragGuessPages(title, consoleId){
    const base = String(title).replace(/\s+/g, '-');
    const names = [];
    (RAG_CONSOLES[Number(consoleId)] || []).forEach(label => names.push(`${base}-(${label.replace(/\s+/g, '-')})`));
    names.push(base);
    const found = [];
    for(const page of names.slice(0, 5)){
      try{
        const res = await fetch(ragRawUrl(page), { method: 'HEAD' });
        if(res.ok) found.push(ragMakeEntry(page));
      }catch(e){ /* offline: stop guessing */ break; }
      if(found.length) break;
    }
    return found;
  }

  async function ragFindForGame(title, consoleId){
    const index = await ragLoadIndex();
    if(index) return { index, matches: ragMatchGame(index.entries, title, consoleId) };
    return { index: null, matches: await ragGuessPages(title, consoleId) };
  }

  async function downloadRaGuide(gameId, page, onStatus){
    if(onStatus) onStatus('Downloading the guide…');
    let md;
    try{
      const res = await archiveFetch(ragRawUrl(page), 45000);
      md = await res.text();
    }catch(e){
      throw new Error('Could not download from GitHub (' + e.message + ')');
    }
    if(md.trim().length < 50) throw new Error('That guide page is empty.');
    const html = sanitizeGuideHtml(ragRenderMarkdown(md));
    const guide = {
      filename: ragDisplayTitle(page), kind: 'html', source: 'ra-guides', page,
      content: html, scrollFrac: 0, savedAt: Date.now()
    };
    if(guideVisibleTextLength(guide) === 0) throw new Error('Nothing readable in that guide page.');
    await addGuide(gameId, guide);
    return guide;
  }

  // The "Find on RetroAchievements Guides" section
  function renderRaGuideSection(){
    return `
        <button class="guide-btn guide-btn-primary" id="guide-ra-btn">Find on RetroAchievements Guides</button>
        <p class="guide-status-text" id="guide-ra-status">Achievement guides written by RA set developers. Saved on your device; pictures still load from the web.</p>
        <div id="guide-ra-results"></div>
        <div class="guide-divider">or</div>`;
  }
  function ragRowHtml(entry, saved){
    return `
      <div class="guide-list-item" data-ra-page="${guideEsc(entry.page)}">
        <div class="guide-list-item-info">
          <span class="guide-list-item-name">${guideEsc(entry.title)}</span>
          <span class="guide-list-item-meta">RA GUIDE</span>
        </div>
        <div class="guide-list-item-actions">
          <button class="guide-list-item-btn" data-ra-action="save" type="button"${saved ? ' disabled' : ''}>${saved ? 'Saved' : 'Save'}</button>
          <a class="guide-list-item-btn" data-ra-action="open" href="${guideEsc(ragPageUrl(entry.page))}" target="_blank" rel="noopener">GitHub ↗</a>
        </div>
      </div>`;
  }

  function wireRaGuideSection(wrap, gameId, title, consoleId, refreshList){
    const btn = wrap.querySelector('#guide-ra-btn');
    const status = wrap.querySelector('#guide-ra-status');
    const box = wrap.querySelector('#guide-ra-results');
    if(!btn || !status || !box) return;
    const savedPages = new Set();

    const setStatus = (msg, err) => { status.className = 'guide-status-text' + (err ? ' err' : ''); status.textContent = msg; };
    const rows = list => list.map(e => ragRowHtml(e, savedPages.has(e.page))).join('');

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      setStatus('Looking through the RetroAchievements guides…');
      try{
        (await loadGuides(gameId)).forEach(g => { if(g.page) savedPages.add(g.page); });
        const { index, matches } = await ragFindForGame(title, consoleId);
        btn.style.display = 'none';
        let html = '';
        if(matches.length){
          setStatus(matches.length === 1 ? 'Found a guide for this game.' : `Found ${matches.length} guides that look like this game.`);
          html += `<div class="guide-list" id="guide-ra-matches">${rows(matches)}</div>`;
        }else{
          setStatus(index ? `No RA guide matched “${title}”. Try the search below, the set may use a different name.` : `Couldn't find an RA guide named “${title}”, and the guide list isn't available right now.`, !index);
        }
        if(index){
          html += `<input type="search" class="guide-rename-input" id="guide-ra-search" placeholder="Search all RA guides…" aria-label="Search RA guides" autocomplete="off" style="margin-top:8px;">
                   <div class="guide-list" id="guide-ra-found" style="margin-top:8px;"></div>`;
        }
        html += `<button class="guide-btn guide-btn-outline" id="guide-ra-done" style="display:none;margin-top:8px;">View saved guides</button>`;
        box.innerHTML = html;

        const searchEl = box.querySelector('#guide-ra-search');
        const foundEl = box.querySelector('#guide-ra-found');
        let timer = null;
        if(searchEl) searchEl.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            const q = searchEl.value.trim();
            if(q.length < 2){ foundEl.innerHTML = ''; return; }
            const hits = ragSearch(index.entries, q);
            foundEl.innerHTML = hits.length ? rows(hits) : '<p class="guide-status-text" style="padding:8px 2px;">No guides found.</p>';
          }, 200);
        });

        const doneBtn = box.querySelector('#guide-ra-done');
        if(doneBtn) doneBtn.addEventListener('click', () => refreshList());

        box.addEventListener('click', async (e) => {
          const open = e.target.closest('[data-ra-action="open"]');
          if(open){ e.preventDefault(); openInExternalBrowser(open.href); return; }
          const save = e.target.closest('[data-ra-action="save"]');
          if(!save || save.disabled) return;
          const row = save.closest('[data-ra-page]');
          const page = row && row.getAttribute('data-ra-page');
          if(!page) return;
          save.disabled = true;
          save.textContent = 'Saving…';
          try{
            await downloadRaGuide(gameId, page, null);
            savedPages.add(page);
            // the same page can appear in both lists
            box.querySelectorAll('[data-ra-page]').forEach(r => {
              if(r.getAttribute('data-ra-page') !== page) return;
              const b = r.querySelector('[data-ra-action="save"]');
              if(b){ b.disabled = true; b.textContent = 'Saved'; }
            });
            if(doneBtn) doneBtn.style.display = 'block';
            setStatus('Saved. Save another, or tap “View saved guides” to read it.');
          }catch(err){
            save.disabled = false;
            save.textContent = 'Save';
            setStatus(err.message, true);
          }
        });
      }catch(e){
        btn.disabled = false;
        setStatus(e.message || 'Something went wrong.', true);
      }
    });
  }
