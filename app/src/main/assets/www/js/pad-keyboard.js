// The controller keyboard: a console-style grid of keys across the bottom of the screen, for typing in a text box
// with the controller. gamepad.js opens it when you confirm on a text box (or jump to a search box); tapping a text
// box still brings up Android's own keyboard.
//
//   D-pad      move between keys            B (confirm)  type the highlighted key
//   A (back)   delete a letter; with the box empty, close the keyboard
//   X          space                        Y            capitals on / off
//   L1 / R1    move the cursor              R2           symbols on / off
//   Start      search / done
// Hold B on a letter (or press and hold it on the screen) for its accents, like the é in Pokémon: left / right
// choose one, B types it, A closes the accents.
// (Android calls the Thor's X "y" and its Y "x".)
(function(){
  const LETTERS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '.', '&'],
  ];
  const SYMBOLS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['!', '?', '/', ':', ';', '_', '@', '#', '(', ')'],
    ['+', '=', '*', '%', '$', '~', '"', ',', '<', '>'],
    ['[', ']', '{', '}', '|', '\\', '^', '`', '-', '.'],
  ];
  const BOTTOM = ['{shift}', '{sym}', '{space}', '{del}', '{done}'];
  // What holding a key offers
  const ACCENTS = {
    a: 'áàâäãåæ', e: 'éèêë', i: 'íìîï', o: 'óòôöõøœ', u: 'úùûü', c: 'ç', n: 'ñ', y: 'ýÿ', s: 'ß',
    '-': '–—', "'": '’‘', '.': '…', '?': '¿', '!': '¡', '$': '€£¥',
  };
  const HOLD_MS = 450;
  let ROWS = [...LETTERS, BOTTOM];
  const LABEL = { '{shift}': 'ABC', '{sym}': '#+=', '{space}': 'Space', '{del}': '⌫', '{done}': 'Search' };
  const HINT = { '{shift}': 'Y', '{sym}': 'R2', '{space}': 'X', '{del}': 'A', '{done}': 'Start' };

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const root = document.createElement('div');
  root.id = 'pad-kb';
  root.innerHTML = `
    <div class="pkb-preview"><span class="pkb-text"></span><span class="pkb-caret"></span></div>
    <div class="pkb-keys"></div>
    <div class="pkb-help"><span class="hk">B</span> type (hold: é) <span class="hk">A</span> delete <span class="hk">X</span> space
      <span class="hk">Y</span> capitals <span class="hk">R2</span> symbols <span class="hk">L1</span><span class="hk">R1</span> cursor <span class="hk">Start</span> done</div>`;
  document.body.appendChild(root);
  const keysEl = root.querySelector('.pkb-keys');
  const textEl = root.querySelector('.pkb-text');

  let input = null, row = 1, col = 0, caps = false, sym = false, savedMode = null, onClose = null;
  let accent = null;            // the accents shown: { list, i, el }
  let holdTimer = 0, holding = null, confirmName = 'a';
  const accentsOf = (k) => (k && k.length === 1 && ACCENTS[k]) ? [...ACCENTS[k]].map(c => caps ? c.toUpperCase() : c) : null;

  // The accents for a key, in a row just above it
  function openAccents(keyEl, list){
    closeAccents();
    const box = document.createElement('div');
    box.className = 'pkb-accents';
    box.innerHTML = list.map((c, i) => `<button type="button" class="pkb-key${i === 0 ? ' on' : ''}" data-i="${i}" tabindex="-1">${esc(c)}</button>`).join('');
    root.appendChild(box);
    const kr = keyEl.getBoundingClientRect(), rr = root.getBoundingClientRect();
    const w = box.offsetWidth;
    let left = kr.left - rr.left + kr.width / 2 - w / 2;
    left = Math.max(6, Math.min(left, rr.width - w - 6));
    box.style.left = left + 'px';
    box.style.top = (kr.top - rr.top - box.offsetHeight - 6) + 'px';
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.pkb-key');
      if(b) pickAccent(Number(b.getAttribute('data-i')));
    });
    accent = { list, i: 0, el: box };
  }
  function moveAccent(step){
    accent.i = (accent.i + step + accent.list.length) % accent.list.length;
    accent.el.querySelectorAll('.pkb-key').forEach((b, i) => b.classList.toggle('on', i === accent.i));
  }
  function pickAccent(i){
    if(!accent) return;
    const c = accent.list[i == null ? accent.i : i];
    closeAccents();
    type(c);
  }
  function closeAccents(){
    if(accent){ accent.el.remove(); accent = null; }
  }

  function draw(){
    keysEl.innerHTML = ROWS.map((r, ri) => `<div class="pkb-row${ri === ROWS.length - 1 ? ' pkb-wide' : ''}">${r.map((k, ci) => {
      const special = k[0] === '{' && k.length > 1;
      let label = special ? LABEL[k] : (caps ? k.toUpperCase() : k);
      if(k === '{shift}') label = caps ? 'abc' : 'ABC';
      if(k === '{sym}') label = sym ? 'abc' : '#+=';
      if(k === '{done}') label = doneLabel();
      const cls = ['pkb-key'];
      if(special) cls.push('pkb-' + k.slice(1, -1));
      if(ri === row && ci === col) cls.push('on');
      if((k === '{shift}' && caps) || (k === '{sym}' && sym)) cls.push('lit');
      return `<button type="button" class="${cls.join(' ')}" data-r="${ri}" data-c="${ci}" tabindex="-1">${esc(label)}${special ? `<small>${HINT[k]}</small>` : ''}</button>`;
    }).join('')}</div>`).join('');
  }
  // Search for a search box, Done for anything else
  const doneLabel = () => input && (input.type === 'search' || /search|addgame-title/.test(input.id) || input.classList.contains('lib-search')) ? 'Search' : 'Done';

  function preview(){
    if(!input) return;
    let v = input.value; const p = caretPos();
    if(input.type === 'password') v = '•'.repeat(v.length); // a key or password isn't shown here either
    textEl.innerHTML = v ? esc(v.slice(0, p)) + '<i class="pkb-cur"></i>' + esc(v.slice(p)) : `<span class="pkb-ph">${esc(input.placeholder || 'Type here')}</span><i class="pkb-cur"></i>`;
  }
  function caretPos(){
    try{ const p = input.selectionStart; return p == null ? input.value.length : p; }catch(e){ return input.value.length; }
  }
  function setCaret(p){ try{ input.setSelectionRange(p, p); }catch(e){} }

  // Changes the box's text the way typing would, so live searches update as you go.
  function edit(fn){
    const v = input.value, p = caretPos();
    const r = fn(v, p);
    input.value = r.v;
    setCaret(r.p);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    preview();
  }
  const type = (s) => edit((v, p) => ({ v: v.slice(0, p) + s + v.slice(p), p: p + s.length }));
  const del = () => edit((v, p) => p > 0 ? { v: v.slice(0, p - 1) + v.slice(p), p: p - 1 } : { v, p });

  function press(k){
    if(k === '{shift}'){ caps = !caps; draw(); return; }
    if(k === '{sym}'){ sym = !sym; ROWS = [...(sym ? SYMBOLS : LETTERS), BOTTOM]; draw(); return; }
    if(k === '{space}'){ type(' '); return; }
    if(k === '{del}'){ del(); return; }
    if(k === '{done}'){ done(); return; }
    type(caps ? k.toUpperCase() : k);
  }

  // Start / Search: a one-line box gets an Enter, as from a keyboard, then the keyboard closes.
  function done(){
    const el = input;
    close();
    if(el && el.tagName === 'INPUT') el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }

  // Up and down go to the key on the next row whose middle is closest; left and right wrap round the row.
  function move(dir){
    const cur = keysEl.querySelector(`[data-r="${row}"][data-c="${col}"]`);
    if(dir === 'left' || dir === 'right'){
      const n = ROWS[row].length;
      col = (col + (dir === 'right' ? 1 : -1) + n) % n;
    }else{
      const to = (row + (dir === 'down' ? 1 : -1) + ROWS.length) % ROWS.length;
      const x = cur ? cur.getBoundingClientRect().left + cur.offsetWidth / 2 : 0;
      let best = 0, bestD = Infinity;
      keysEl.querySelectorAll(`[data-r="${to}"]`).forEach(k => {
        const r = k.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - x);
        if(d < bestD){ bestD = d; best = Number(k.getAttribute('data-c')); }
      });
      row = to; col = best;
    }
    draw();
  }

  function open(el, closed){
    if(!el) return;
    if(input) close();
    input = el;
    onClose = closed || null;
    // keep Android's keyboard away while this one is up
    savedMode = el.getAttribute('inputmode');
    el.setAttribute('inputmode', 'none');
    try{ el.focus({ preventScroll: true }); }catch(e){ el.focus(); }
    setCaret(el.value.length);
    caps = false; sym = false; ROWS = [...LETTERS, BOTTOM]; row = 1; col = 0;
    draw();
    preview();
    root.classList.add('open');
    document.documentElement.classList.add('pad-kb-on');
    // the box stays in sight above the keyboard
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const room = window.innerHeight - root.offsetHeight;
      if(r.bottom > room - 8 || r.top < 0) el.scrollIntoView({ block: 'center' });
    });
  }

  function close(){
    if(!input) return;
    closeAccents();
    clearTimeout(holdTimer); holding = null;
    const el = input, cb = onClose;
    input = null; onClose = null;
    if(savedMode == null) el.removeAttribute('inputmode'); else el.setAttribute('inputmode', savedMode);
    el.blur();
    root.classList.remove('open');
    document.documentElement.classList.remove('pad-kb-on');
    if(cb) cb(el);
  }

  // Controller buttons while the keyboard is open. Returns true when it used the button (it uses them all).
  function key(name, confirmKey){
    if(!input) return false;
    if(!input.isConnected || !input.getClientRects().length){ close(); return false; }
    const backKey = confirmKey === 'a' ? 'b' : 'a';
    confirmName = confirmKey;
    if(accent){ // choosing an accent
      if(name === 'left' || name === 'right') moveAccent(name === 'right' ? 1 : -1);
      else if(name === confirmKey) pickAccent();
      else closeAccents();
      return true;
    }
    if(name === confirmKey){
      const k = ROWS[row][col], list = accentsOf(k);
      if(list){ // typed when let go; held, it shows the accents instead
        holding = k;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          holdTimer = 0;
          if(holding !== k) return;
          holding = null;
          const el = keysEl.querySelector(`[data-r="${row}"][data-c="${col}"]`);
          if(el) openAccents(el, list);
        }, HOLD_MS);
        return true;
      }
    }
    if(name === 'up' || name === 'down' || name === 'left' || name === 'right') move(name);
    else if(name === confirmKey) press(ROWS[row][col]);
    else if(name === backKey){ if(input.value) del(); else close(); }
    else if(name === 'y') press('{space}');
    else if(name === 'x') press('{shift}');
    else if(name === 'start') done();
    else if(name === 'r2') press('{sym}');
    else if(name === 'select') close();
    else if(name === 'l1' || name === 'r1'){
      const p = caretPos();
      setCaret(name === 'l1' ? Math.max(0, p - 1) : Math.min(input.value.length, p + 1));
      preview();
    }
    return true;
  }

  // A controller button let go (gamepad.js): a short press on a key with accents types it.
  function up(name){
    if(name !== confirmName || !holding) return;
    const k = holding;
    holding = null;
    clearTimeout(holdTimer);
    press(k);
  }

  // Touch works too: tap a key to press it, or press and hold it for its accents.
  let touchHold = 0, heldByTouch = false;
  keysEl.addEventListener('pointerdown', (e) => {
    const k = e.target.closest('.pkb-key');
    heldByTouch = false;
    clearTimeout(touchHold);
    if(!k || !input) return;
    const name = ROWS[Number(k.getAttribute('data-r'))][Number(k.getAttribute('data-c'))];
    const list = accentsOf(name);
    if(list) touchHold = setTimeout(() => { heldByTouch = true; openAccents(k, list); }, HOLD_MS);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => keysEl.addEventListener(t, () => clearTimeout(touchHold)));
  keysEl.addEventListener('click', (e) => {
    const k = e.target.closest('.pkb-key');
    if(heldByTouch){ heldByTouch = false; return; } // the hold opened the accents; pick one of those
    closeAccents();
    if(!k || !input) return;
    row = Number(k.getAttribute('data-r')); col = Number(k.getAttribute('data-c'));
    const name = ROWS[row][col];
    press(name);
    if(input){ draw(); try{ input.focus({ preventScroll: true }); }catch(err){} }
  });
  // Tapping the text box itself switches to Android's keyboard, as a tap always does.
  document.addEventListener('pointerdown', (e) => { if(input && e.target === input) close(); }, true);
  // a tap on the keyboard's own background mustn't take the focus from the box
  root.addEventListener('mousedown', (e) => e.preventDefault());

  // Boxes it types into: text of any kind. Dates and times keep Android's own pickers.
  const canType = (el) => !!el && (el.tagName === 'TEXTAREA'
    || (el.tagName === 'INPUT' && !/^(date|time|month|week|datetime-local|checkbox|radio|button|submit|reset|file|range|color|hidden)$/.test(el.type)));

  window.PadKeyboard = { open, close, key, up, canType, isOpen: () => !!input, input: () => input };
})();
