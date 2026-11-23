// Help: the instruction booklet (words in help-content.js). It opens from the menu's Help item in the app, and the
// same code draws the web version of the guide (tools/build-help-page.py), which has no app around it.
//
// The booklet has a cover, a contents page and one "page" per chapter. Typing in the search box keeps only the
// sections that have every word typed, with the words highlighted. The controller keys are in HelpBook.key below.
(function(){
  const G = window.HELP_GUIDE;
  if(!G) return;

  const SIZE_KEY = 'help-text-size';
  const SIZES = [0.85, 0.92, 1, 1.1, 1.22, 1.36];

  const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // The buttons, roughly where they are on the Thor (not to scale). Each label says what the button does most of the time.
  function diagram(){
    const face = (cx, cy, l, cls) => `<g class="hd-face ${cls || ''}"><circle cx="${cx}" cy="${cy}" r="15"/><text x="${cx}" y="${cy + 5}">${l}</text></g>`;
    const note = (x, y, anchor, title, what) =>
      `<text class="hd-note" x="${x}" y="${y}" text-anchor="${anchor}"><tspan class="hd-note-b">${title}</tspan> ${what}</text>`;
    return `<figure class="hp-diagram">
      <svg viewBox="0 0 640 330" role="img" aria-label="Controller buttons and what they do">
        <g class="hd-shoulder"><rect x="172" y="20" width="84" height="26" rx="13"/><text x="214" y="38">L2</text></g>
        <g class="hd-shoulder"><rect x="172" y="52" width="84" height="26" rx="13"/><text x="214" y="70">L1</text></g>
        <g class="hd-shoulder"><rect x="384" y="20" width="84" height="26" rx="13"/><text x="426" y="38">R2</text></g>
        <g class="hd-shoulder"><rect x="384" y="52" width="84" height="26" rx="13"/><text x="426" y="70">R1</text></g>
        <rect class="hd-body" x="60" y="88" width="520" height="210" rx="34"/>
        <rect class="hd-screen" x="214" y="104" width="212" height="150" rx="6"/>
        <text class="hd-screen-t" x="320" y="184">Touch screen</text>
        <g class="hd-dpad"><path d="M126 118h22v22h22v22h-22v22h-22v-22h-22v-22h22z"/></g>
        <g class="hd-stick"><circle cx="137" cy="232" r="27"/><circle class="hd-stick-top" cx="137" cy="232" r="16"/></g>
        ${face(503, 120, 'X', 'hd-x')}
        ${face(472, 151, 'Y', 'hd-y')}
        ${face(534, 151, 'A', 'hd-a')}
        ${face(503, 182, 'B', 'hd-b')}
        <g class="hd-stick"><circle cx="503" cy="242" r="25"/><circle class="hd-stick-top" cx="503" cy="242" r="15"/></g>
        <g class="hd-small"><rect x="262" y="266" width="44" height="16" rx="8"/><text x="284" y="278">Select</text></g>
        <g class="hd-small"><rect x="334" y="266" width="44" height="16" rx="8"/><text x="356" y="278">Start</text></g>
        ${note(162, 38, 'end', '', 'previous tab')}
        ${note(162, 70, 'end', '', 'previous console')}
        ${note(478, 38, 'start', '', 'next tab')}
        ${note(478, 70, 'start', '', 'next console')}
        ${note(10, 318, 'start', 'D-pad / left stick', 'move')}
        ${note(320, 318, 'middle', 'Select', 'menu')}
        ${note(630, 318, 'end', 'Right stick', 'scroll')}
      </svg>
      <figcaption>
        <span><span class="hk">B</span> Confirm</span>
        <span><span class="hk">A</span> Back</span>
        <span><span class="hk">X</span> Search / Play</span>
        <span><span class="hk">Y</span> Refresh</span>
      </figcaption>
    </figure>`;
  }

  function chapterHtml(ch, n){
    const secs = ch.sections.map((s, i) =>
      `<article class="hp-sec" data-sec="${n}.${i + 1}"><h3><span class="hp-sec-no">${n}.${i + 1}</span>${escHtml(s.h)}</h3>${s.html}</article>`).join('');
    return `<section class="hp-chapter" id="hp-${ch.id}" data-ch="${n}">
        <header class="hp-ch-head"><span class="hp-ch-no">${n}</span><h2>${escHtml(ch.title)}</h2></header>
        ${secs}
        <footer class="hp-folio">· ${n} ·</footer>
      </section>`;
  }

  // Draws the whole booklet into `root`. opts.logo is the cover picture, opts.closeBtn adds a ✕ to the search bar.
  function render(root, opts){
    opts = opts || {};
    const contents = G.chapters.map((ch, i) =>
      `<li><a href="#hp-${ch.id}" data-go="hp-${ch.id}"><span class="hp-toc-no">${i + 1}</span><span class="hp-toc-t">${escHtml(ch.title)}</span><span class="hp-toc-dots"></span><span class="hp-toc-pg">${ch.sections.length} topics</span></a></li>`).join('');
    root.innerHTML = `<div class="hp-book">
      <div class="hp-bar">
        <div class="hp-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
          <input type="search" class="hp-search-input" placeholder="Search the guide" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Search the guide">
          <button class="hp-search-clear" type="button" aria-label="Clear search">×</button>
        </div>
        <span class="hp-count" aria-live="polite"></span>
        ${opts.closeBtn ? '<button class="modal-close hp-close" type="button" aria-label="Close Help">✕</button>' : ''}
      </div>
      <div class="hp-pages">
        <section class="hp-cover">
          <div class="hp-cover-frame">
            ${opts.logo ? `<img class="hp-cover-logo" src="${opts.logo}" alt="">` : ''}
            <div class="hp-cover-title">${escHtml(G.title)}</div>
            <div class="hp-cover-sub">${escHtml(G.subtitle)}</div>
            <p class="hp-cover-note">Please read this booklet to get the most out of your launcher. Keep it handy: it's always
            in the menu under Help.</p>
          </div>
        </section>
        <nav class="hp-contents" aria-label="Contents">
          <h2>Contents</h2>
          <ol>${contents}</ol>
        </nav>
        ${G.chapters.map((ch, i) => chapterHtml(ch, i + 1)).join('')}
        <div class="hp-empty" hidden>Nothing in the guide matches that. Try fewer or different words.</div>
      </div>
    </div>`;
    root.querySelectorAll('[data-diagram="thor"]').forEach(el => { el.outerHTML = diagram(); });

    const book = root.querySelector('.hp-book');
    const input = root.querySelector('.hp-search-input');
    const count = root.querySelector('.hp-count');
    const empty = root.querySelector('.hp-empty');
    const secs = Array.from(root.querySelectorAll('.hp-sec'));
    const original = new Map(secs.map(s => [s, s.innerHTML]));
    const scroller = opts.scroller || (() => window);

    // Jumps inside the booklet (the contents and links between chapters) scroll to the chapter and leave the address alone.
    root.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#hp-"]');
      if(!a) return;
      e.preventDefault();
      if(input.value) setQuery('');
      goTo(root.querySelector(a.getAttribute('href')));
    });

    function goTo(el){
      if(!el) return;
      const sc = scroller();
      const bar = root.querySelector('.hp-bar');
      const barH = bar && !book.classList.contains('hp-bar-hidden') ? bar.offsetHeight : 0;
      if(sc === window){
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - barH - 8 });
      }else{
        sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - barH - 8;
      }
    }

    // Wraps every place a word appears in <mark>, inside the text only (never inside tags or the drawing).
    function highlight(sec, words){
      const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT, {
        acceptNode: n => n.parentNode.closest('svg, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });
      const nodes = [];
      while(walker.nextNode()) nodes.push(walker.currentNode);
      const re = new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
      nodes.forEach(n => {
        if(!re.test(n.nodeValue)) return;
        re.lastIndex = 0;
        const span = document.createElement('span');
        span.innerHTML = escHtml(n.nodeValue).replace(re, '<mark>$1</mark>');
        n.replaceWith(...span.childNodes);
      });
    }

    function setQuery(q){
      input.value = q;
      search();
    }

    let timer = 0;
    function search(){
      clearTimeout(timer);
      const q = fold(input.value.trim());
      const words = q.split(/\s+/).filter(Boolean);
      book.classList.toggle('hp-searching', words.length > 0);
      secs.forEach(s => { s.innerHTML = original.get(s); s.hidden = false; });
      root.querySelectorAll('.hp-chapter').forEach(c => { c.hidden = false; });
      if(!words.length){ count.textContent = ''; empty.hidden = true; return; }
      let hits = 0;
      root.querySelectorAll('.hp-chapter').forEach(ch => {
        const chTitle = fold(ch.querySelector('.hp-ch-head').textContent);
        let shown = 0;
        ch.querySelectorAll('.hp-sec').forEach(s => {
          const text = fold(s.textContent) + ' ' + chTitle;
          const ok = words.every(w => text.includes(w));
          s.hidden = !ok;
          if(ok){ shown++; highlight(s, words); }
        });
        ch.hidden = shown === 0;
        hits += shown;
      });
      count.textContent = hits ? hits + (hits === 1 ? ' topic' : ' topics') : '';
      empty.hidden = hits > 0;
      const sc = scroller();
      if(sc === window) window.scrollTo(0, 0); else sc.scrollTop = 0;
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 150); });
    input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ search(); input.blur(); } });
    root.querySelector('.hp-search-clear').addEventListener('click', () => { setQuery(''); input.focus(); });

    // Text size, kept between visits.
    let size = 2;
    try{
      const saved = localStorage.getItem(SIZE_KEY);
      if(saved !== null && Number(saved) >= 0 && Number(saved) < SIZES.length) size = Number(saved);
    }catch(e){}
    const applySize = () => { book.style.setProperty('--hp-scale', SIZES[size]); };
    applySize();

    return {
      book,
      input,
      hasQuery: () => !!input.value,
      clear: () => setQuery(''),
      textSize(dir){
        size = Math.max(0, Math.min(SIZES.length - 1, size + dir));
        applySize();
        try{ localStorage.setItem(SIZE_KEY, String(size)); }catch(e){}
      },
      toggleBar(){ book.classList.toggle('hp-bar-hidden'); },
      // The chapter at the top of the screen, then the one before or after it.
      chapter(dir){
        const chs = Array.from(root.querySelectorAll('.hp-chapter:not([hidden])'));
        if(!chs.length) return;
        const sc = scroller();
        const top = sc === window ? 0 : sc.getBoundingClientRect().top;
        const barH = book.classList.contains('hp-bar-hidden') ? 0 : root.querySelector('.hp-bar').offsetHeight;
        const offset = c => c.getBoundingClientRect().top - top - barH;
        let at = -1; // the last chapter that starts at or above the top of the screen
        chs.forEach((c, i) => { if(offset(c) <= 20) at = i; });
        if(dir > 0){
          // a chapter that is already nearly at the top counts as the one you are on
          let next = at + 1;
          if(next < chs.length - 1 && offset(chs[next]) < 150) next++;
          goTo(chs[Math.min(chs.length - 1, next)]);
          return;
        }
        if(at < 0 || (at === 0 && offset(chs[0]) >= -20)){ // on the cover or the contents, or at the start of chapter 1
          if(sc === window) window.scrollTo(0, 0); else sc.scrollTop = 0;
          return;
        }
        // part way into a chapter: back to its start; already at its start: the chapter before
        goTo(offset(chs[at]) < -20 ? chs[at] : chs[at - 1]);
      },
    };
  }

  // ---------- In the app: the Help window ----------
  let view = null;
  const backdrop = document.getElementById('help-backdrop');

  function openHelp(){
    if(!backdrop) return;
    if(!view){
      view = render(document.getElementById('help-card'), {
        logo: 'logos/app.webp',
        closeBtn: true,
        scroller: () => backdrop,
      });
      view.book.querySelector('.hp-close').addEventListener('click', closeHelp);
    }
    backdrop.classList.add('open');
    if(typeof closeDropdownMenu === 'function') closeDropdownMenu();
  }
  function closeHelp(){
    if(backdrop) backdrop.classList.remove('open');
  }

  const openBtn = document.getElementById('btn-help-open');
  if(openBtn) openBtn.addEventListener('click', openHelp);

  // Controller keys while Help is open. Names are Android's: "y" is the button labelled X on the Thor and "x" the one
  // labelled Y. Returns true when the key was used here.
  function key(name){
    if(!view || !backdrop || !backdrop.classList.contains('open')) return false;
    if(name === 'y'){
      if(view.book.classList.contains('hp-bar-hidden')) view.toggleBar();
      view.input.focus();
      try{ if(window.PadNative) window.PadNative.showKeyboard(); }catch(e){}
      return true;
    }
    if(name === 'x'){ view.toggleBar(); return true; }
    if(name === 'l1' || name === 'r1'){ view.chapter(name === 'r1' ? 1 : -1); return true; }
    if(name === 'l2' || name === 'r2'){ view.textSize(name === 'r2' ? 1 : -1); return true; }
    return false;
  }
  // The back button: a search is cleared first, then Help closes (gamepad.js does the closing).
  function back(){
    if(!view || !backdrop || !backdrop.classList.contains('open')) return false;
    if(view.book.classList.contains('hp-bar-hidden')){ view.toggleBar(); return true; }
    if(view.hasQuery()){ view.clear(); return true; }
    return false;
  }

  window.HelpBook = { render, open: openHelp, close: closeHelp, key, back };
})();
