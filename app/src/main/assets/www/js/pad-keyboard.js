// The controller keyboard: a console-style grid of keys across the bottom of the screen, for typing in a text box
// with the controller. gamepad.js opens it when you confirm on a text box (or jump to a search box); tapping a text
// box still brings up Android's own keyboard.
//
//   D-pad      move between keys            B (confirm)  type the highlighted key
//   A (back)   delete a letter; with the box empty, close the keyboard
//   X          space                        Y            capitals on / off
//   L1 / R1    move the cursor              Start        search / done
// (Android calls the Thor's X "y" and its Y "x".)
(function(){
  const ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '.', '&'],
    ['{shift}', '{space}', '{del}', '{done}'],
  ];
  const LABEL = { '{shift}': 'ABC', '{space}': 'Space', '{del}': '⌫', '{done}': 'Search' };
  const HINT = { '{shift}': 'Y', '{space}': 'X', '{del}': 'A', '{done}': 'Start' };

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const root = document.createElement('div');
  root.id = 'pad-kb';
  root.innerHTML = `
    <div class="pkb-preview"><span class="pkb-text"></span><span class="pkb-caret"></span></div>
    <div class="pkb-keys"></div>
    <div class="pkb-help"><span class="hk">B</span> type <span class="hk">A</span> delete <span class="hk">X</span> space
      <span class="hk">Y</span> capitals <span class="hk">L1</span><span class="hk">R1</span> cursor <span class="hk">Start</span> done</div>`;
  document.body.appendChild(root);
  const keysEl = root.querySelector('.pkb-keys');
  const textEl = root.querySelector('.pkb-text');

  let input = null, row = 1, col = 0, caps = false, savedMode = null, onClose = null;

  function draw(){
    keysEl.innerHTML = ROWS.map((r, ri) => `<div class="pkb-row${ri === ROWS.length - 1 ? ' pkb-wide' : ''}">${r.map((k, ci) => {
      const special = k[0] === '{' && k.length > 1;
      let label = special ? LABEL[k] : (caps ? k.toUpperCase() : k);
      if(k === '{shift}') label = caps ? 'abc' : 'ABC';
      if(k === '{done}') label = doneLabel();
      const cls = ['pkb-key'];
      if(special) cls.push('pkb-' + k.slice(1, -1));
      if(ri === row && ci === col) cls.push('on');
      if(k === '{shift}' && caps) cls.push('lit');
      return `<button type="button" class="${cls.join(' ')}" data-r="${ri}" data-c="${ci}" tabindex="-1">${esc(label)}${special ? `<small>${HINT[k]}</small>` : ''}</button>`;
    }).join('')}</div>`).join('');
  }
  const doneLabel = () => input && (input.id === 'addgame-title') ? 'Search' : 'Done';

  function preview(){
    if(!input) return;
    const v = input.value, p = caretPos();
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
    if(k === '{space}'){ type(' '); return; }
    if(k === '{del}'){ del(); return; }
    if(k === '{done}'){ done(); return; }
    type(caps ? k.toUpperCase() : k);
  }

  // Start / Search: the box gets an Enter, as from a keyboard, then the keyboard closes.
  function done(){
    const el = input;
    close();
    if(el) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
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
    caps = false; row = 1; col = 0;
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
    if(name === 'up' || name === 'down' || name === 'left' || name === 'right') move(name);
    else if(name === confirmKey) press(ROWS[row][col]);
    else if(name === backKey){ if(input.value) del(); else close(); }
    else if(name === 'y') press('{space}');
    else if(name === 'x') press('{shift}');
    else if(name === 'start') done();
    else if(name === 'select') close();
    else if(name === 'l1' || name === 'r1'){
      const p = caretPos();
      setCaret(name === 'l1' ? Math.max(0, p - 1) : Math.min(input.value.length, p + 1));
      preview();
    }
    return true;
  }

  // Touch works too: tap a key to press it.
  keysEl.addEventListener('click', (e) => {
    const k = e.target.closest('.pkb-key');
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

  window.PadKeyboard = { open, close, key, isOpen: () => !!input, input: () => input };
})();
