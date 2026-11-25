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

  // The photo of the Thor with a numbered marker by each button, and the list of what they do underneath, like the
  // "names of parts" page of an old manual. Marker spots are in the photos' own pixels (thor.jpg was 1666 x 2212 and
  // the shoulder photo 2576 x 620): [number, button x, button y, marker x, marker y].
  const THOR_MARKS = [
    [5, 330, 390, 250, 300],
    [6, 610, 1330, 540, 1260],
    [7, 370, 1210, 370, 1100],
    [8, 1318, 1207, 1318, 1100],
    [9, 262, 1380, 110, 1250],
    [10, 262, 1680, 105, 1540],
    [11, 1432, 1297, 1570, 1215],
    [12, 1345, 1383, 1265, 1290],
    [13, 1522, 1383, 1600, 1480],
    [14, 1437, 1468, 1520, 1570],
    [15, 1420, 1690, 1580, 1830],
    [16, 355, 1903, 215, 1985],
    [17, 1330, 1903, 1470, 1985],
  ];
  const SHOULDER_MARKS = [
    [1, 330, 80, 650, 75],
    [2, 290, 170, 650, 210],
    [3, 2250, 95, 1930, 75],
    [4, 2290, 175, 1930, 210],
  ];
  const PARTS = [
    ['L2', 'Previous tab'],
    ['L1', 'Previous console (previous chapter in Help, page up in a manual)'],
    ['R2', 'Next tab'],
    ['R1', 'Next console (next chapter in Help, page down in a manual)'],
    ['Top screen', 'Fan art, the floating cartridge and the header. Games play here.'],
    ['Bottom screen', 'The tracker. Touch works everywhere.'],
    ['Select (\u25a1)', 'Open or close the menu'],
    ['Start (\u25b7)', 'Used by your games'],
    ['Left stick', 'Move the highlight'],
    ['D-pad', 'Move the highlight'],
    ['X', 'Search, or Play in a game profile'],
    ['Y', 'Refresh'],
    ['A', 'Go back'],
    ['B', 'Confirm'],
    ['Right stick', 'Scroll quickly'],
    ['Home', "Android's Home (opens the launcher when it is your home app)"],
    ['Back', 'Go back, the same as A'],
  ];
  function marks(list, r){
    return list.map(([n, bx, by, mx, my]) =>
      `<line class="hm-line" x1="${bx}" y1="${by}" x2="${mx}" y2="${my}"/><circle class="hm-dot" cx="${bx}" cy="${by}" r="${r * 0.22}"/>` +
      `<g class="hm-mark"><circle cx="${mx}" cy="${my}" r="${r}"/><text x="${mx}" y="${my + r * 0.36}" font-size="${r}">${n}</text></g>`).join('');
  }
  function diagram(){
    const legend = PARTS.map(([name, what], i) =>
      `<li><span class="hm-no">${i + 1}</span><span><b>${escHtml(name)}</b> ${escHtml(what)}</span></li>`).join('');
    return `<figure class="hp-thor">
      <div class="hp-photo"><img src="help/img/thor-shoulders.webp" alt="The top edge of the Thor with the L1, L2, R1 and R2 buttons" loading="lazy">
        <svg viewBox="0 0 2576 620" aria-hidden="true">${marks(SHOULDER_MARKS, 56)}</svg></div>
      <div class="hp-photo"><img src="help/img/thor.webp" alt="The AYN Thor, open, with every button numbered" loading="lazy">
        <svg viewBox="0 0 1666 2212" aria-hidden="true">${marks(THOR_MARKS, 44)}</svg></div>
      <figcaption>Names of parts</figcaption>
      <ol class="hp-parts">${legend}</ol>
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
      if(window.PadKeyboard) window.PadKeyboard.open(view.input);
      else{
        view.input.focus();
        try{ if(window.PadNative) window.PadNative.showKeyboard(); }catch(e){}
      }
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
