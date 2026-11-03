// The old-TV start-up animation on the top screen: a 4:3 CRT picture, full height, that turns on
// as static and tunes in to the game's name. ArtActivity calls GLTCrt.start(title) when Play is pressed
// and GLTCrt.stop() when the emulator takes over the screen.
(function(){
  const W = 440, H = 330, DUR = 3.0, BASE = 1.9;   // BASE: the length the timings below were written for   // the picture is drawn at this size, then scaled to the screen's height
  let root, flash, strips = [], noise, nctx, nimg, bar, built = false;
  let raf = 0, t0 = 0, audio = null, failsafe = 0, title = '';
  const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => 1 - Math.pow(1 - x, 3);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function build(){
    root = document.createElement('div');
    root.id = 'crt-root';
    root.innerHTML = '<div id="crt-scr"><div id="crt-s"><div id="crt-c"></div><div id="crt-wv"></div>' +
      '<canvas id="crt-n" width="147" height="110"></canvas><div id="crt-b"></div><div id="crt-sl"></div></div>' +
      '<div id="crt-vg"></div><div id="crt-gl"></div></div>';
    document.body.appendChild(root);
    flash = root.querySelector('#crt-c');
    noise = root.querySelector('#crt-n');
    nctx = noise.getContext('2d');
    nimg = nctx.createImageData(147, 110);
    bar = root.querySelector('#crt-b');
    built = true;
  }

  // The biggest font (up to 24px) that keeps the name on one line inside the picture.
  function fitSize(text){
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:bold 24px monospace;letter-spacing:2px;';
    probe.textContent = text;
    document.body.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return Math.max(9, Math.min(24, Math.floor(24 * 370 / Math.max(w, 1))));
  }

  // Just the name: no (USA), [!], disc tags or file extension.
  function cleanTitle(name){
    let t = String(name || '').replace(/\.[A-Za-z0-9]{2,4}$/, '');
    t = t.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s{2,}/g, ' ').trim();
    return t || String(name || 'Game');
  }

  function fill(){
    const wv = root.querySelector('#crt-wv');
    wv.innerHTML = '';
    strips = [];
    const size = fitSize(title);
    for(let y = 0; y < H; y += 8){
      const d = document.createElement('div');
      d.className = 'crt-st';
      d.style.top = y + 'px';
      d.innerHTML = '<div style="top:' + (-y) + 'px"><div style="font-size:' + size + 'px">' + esc(title) + '</div><small>GAME STARTING</small></div>';
      wv.appendChild(d);
      strips.push(d);
    }
  }

  function draw(real){
    const t = real * BASE / DUR; // the whole animation, stretched to DUR seconds
    let wi, hi;
    if(t < 0.1){ wi = 6; hi = 6; }
    else if(t < 0.25){ wi = 6 + ease((t - 0.1) / 0.15) * (W - 6); hi = 3; }
    else if(t < 0.45){ wi = W; hi = 3 + ease((t - 0.25) / 0.2) * (H - 3); }
    else { wi = W; hi = H; }
    const nop = t < 0.45 ? 1 : 1 - cl((t - 0.55) / 0.8);
    const vis = cl((t - 0.7) / 0.6);
    const x = (W - wi) / 2, y = (H - hi) / 2;
    const clip = 'inset(' + y + 'px ' + x + 'px ' + y + 'px ' + x + 'px)';
    flash.style.clipPath = clip;
    flash.style.opacity = t < 0.45 ? 1 : 0;
    const u = cl((t - 0.7) / 0.8), amp = 26 * Math.pow(1 - u, 1.5);
    for(let i = 0; i < strips.length; i++){
      const d = strips[i];
      d.style.transform = 'translateX(' + (t < 0.7 ? 0 : amp * Math.sin(i * 0.55 + t * 16)).toFixed(2) + 'px)';
      d.style.opacity = t < 0.45 ? 0 : vis;
    }
    noise.style.opacity = nop;
    noise.style.clipPath = clip;
    if(nop > 0.01){
      const u32 = new Uint32Array(nimg.data.buffer);
      for(let i = 0; i < u32.length; i++){ const v = (Math.random() * 255) | 0; u32[i] = 0xff000000 | (v << 16) | (v << 8) | v; }
      nctx.putImageData(nimg, 0, 0);
    }
    bar.style.top = (((t * 1.4) % 1) * 380 - 80) + 'px';
    bar.style.opacity = (t > 0.3 && t < 1.2) ? nop * 0.8 : 0;
  }

  function loop(now){
    const t = Math.min((now - t0) / 1000, DUR);
    draw(t);
    raf = t < DUR ? requestAnimationFrame(loop) : 0;
  }

  window.GLTCrt = {
    start(name){
      if(!built) build();
      title = cleanTitle(name);
      fill();
      root.style.display = 'block';
      root.querySelector('#crt-scr').style.transform = 'scale(' + (window.innerHeight / H) + ')';
      cancelAnimationFrame(raf);
      t0 = performance.now();
      draw(0);
      raf = requestAnimationFrame(loop);
      try{
        if(!audio) audio = new Audio('crt-start.wav');
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }catch(e){ /* no sound is fine */ }
      clearTimeout(failsafe);
      failsafe = setTimeout(() => window.GLTCrt.stop(), 12000); // never leave it covering the screen
    },
    stop(){
      clearTimeout(failsafe);
      cancelAnimationFrame(raf); raf = 0;
      if(root) root.style.display = 'none';
      try{ if(audio) audio.pause(); }catch(e){}
    }
  };
})();
