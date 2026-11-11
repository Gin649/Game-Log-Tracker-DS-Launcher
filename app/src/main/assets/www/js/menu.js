// Hamburger menu and text size.

function closeDropdownMenu(){
  $('#dropdown-menu').classList.remove('open');
}
$('#btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#dropdown-menu').classList.toggle('open');
});
document.addEventListener('click', (e) => {
  const wrap = $('#menu-wrap');
  if(wrap && !wrap.contains(e.target)) closeDropdownMenu();
});
document.querySelectorAll('.dropdown-item:not(.dropdown-heading)').forEach(item => {
  item.addEventListener('click', closeDropdownMenu);
});

// Only one menu section is open at a time. Called with the section that is opening (or none) to close the rest.
const MENU_SECTIONS = ['ra', 'display', 'pad'];
function collapseMenuSections(except){
  MENU_SECTIONS.forEach(n => {
    if(n === except) return;
    const sub = $('#' + n + '-submenu'), arrow = $('#' + n + '-heading-arrow');
    if(sub) sub.style.display = 'none';
    if(arrow) arrow.textContent = '▸';
  });
}
// Brings an opened section's heading to the top of the menu list, so the whole section shows without scrolling.
function scrollMenuTo(name){
  requestAnimationFrame(() => {
    const menu = $('#dropdown-menu'), head = $('#btn-' + name + '-heading');
    if(menu && head) menu.scrollTop = head.offsetTop - menu.offsetTop;
  });
}
// A menu heading that opens and closes its submenu.
function wireSubmenu(name){
  $('#btn-' + name + '-heading').addEventListener('click', (e) => {
    e.stopPropagation();
    const submenu = $('#' + name + '-submenu');
    const isOpen = submenu.style.display === 'block';
    if(!isOpen) collapseMenuSections(name);
    submenu.style.display = isOpen ? 'none' : 'block';
    $('#' + name + '-heading-arrow').textContent = isOpen ? '▸' : '▾';
    if(!isOpen) scrollMenuTo(name);
  });
}
['ra', 'display'].forEach(wireSubmenu);

// Text size: every font size is in rem, so the size on <html> scales them all (art keeps its size).
const TEXTSIZE_MIN = 80, TEXTSIZE_MAX = 160, TEXTSIZE_STEP = 10, TEXTSIZE_DEFAULT = 100, TEXTSIZE_BASE_PX = 16;
const TEXTSIZE_KEY = 'app-text-size-pct';
let textSizePct = TEXTSIZE_DEFAULT;

function applyTextSize(){
  // NES's pixel font is very wide, so its text is scaled down to sit like the others.
  const themeScale = document.documentElement.getAttribute('data-theme') === 'nintendo' ? 0.7 : 1;
  document.documentElement.style.fontSize = (TEXTSIZE_BASE_PX * textSizePct / 100 * themeScale) + 'px';
  $('#textsize-label').textContent = textSizePct + '%';
  $('#textsize-dec').disabled = textSizePct <= TEXTSIZE_MIN;
  $('#textsize-inc').disabled = textSizePct >= TEXTSIZE_MAX;
}
async function saveTextSize(){
  try{ await window.storage.set(TEXTSIZE_KEY, String(textSizePct), false); }catch(e){}
}
async function initTextSize(){
  try{
    const saved = await window.storage.get(TEXTSIZE_KEY, false);
    const n = saved ? parseInt(saved.value, 10) : NaN;
    if(!isNaN(n) && n >= TEXTSIZE_MIN && n <= TEXTSIZE_MAX) textSizePct = n;
  }catch(e){}
  applyTextSize();
}
initTextSize();

$('#textsize-dec').addEventListener('click', (e) => {
  e.stopPropagation();
  textSizePct = Math.max(TEXTSIZE_MIN, textSizePct - TEXTSIZE_STEP);
  applyTextSize(); saveTextSize();
});
$('#textsize-inc').addEventListener('click', (e) => {
  e.stopPropagation();
  textSizePct = Math.min(TEXTSIZE_MAX, textSizePct + TEXTSIZE_STEP);
  applyTextSize(); saveTextSize();
});
$('#textsize-reset').addEventListener('click', (e) => {
  e.stopPropagation();
  textSizePct = TEXTSIZE_DEFAULT;
  applyTextSize(); saveTextSize();
});

// The main menu entries alternate gold and white. Items that are hidden don't count, so the pattern stays unbroken.
function colorMenuItems(){
  const menu = $('#dropdown-menu');
  if(!menu) return;
  let n = 0;
  Array.from(menu.children).forEach(el => {
    if(!el.classList.contains('dropdown-item')) return;
    if(getComputedStyle(el).display === 'none') return;
    el.classList.toggle('menu-gold', n % 2 === 0);
    el.classList.toggle('menu-white', n % 2 === 1);
    n++;
  });
}
$('#btn-menu').addEventListener('click', colorMenuItems);
setTimeout(colorMenuItems, 300);


// Game view: Game Library and Backlog as a list (default) or as tiles. A pinch sets the tiles per row, 2 to 6 (pinch-tiles.js).
const GAMEVIEW_KEY = 'app-game-view', TILECOLS_KEY = 'app-tile-cols', CONSOLEBAR_KEY = 'app-console-bar';
function applyGameViewButtons(){
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('on', b.dataset.view === gameView));
}
function applyConsoleBarButtons(){
  document.querySelectorAll('.bar-btn').forEach(b => b.classList.toggle('on', b.dataset.bar === consoleBar));
}
function redrawGameViews(){
  try{ if(libraryData && libraryData.length){ renderLibrary(); renderBacklog(); } }catch(e){}
}
async function initGameView(){
  try{
    const v = await window.storage.get(GAMEVIEW_KEY, false);
    if(v && (v.value === 'tile' || v.value === 'list')) gameView = v.value;
    const c = await window.storage.get(TILECOLS_KEY, false);
    const n = c ? parseInt(c.value, 10) : NaN;
    if(n >= 2 && n <= 6) tileCols = n;
    const bar = await window.storage.get(CONSOLEBAR_KEY, false);
    if(bar && (bar.value === 'logos' || bar.value === 'names')) consoleBar = bar.value;
  }catch(e){}
  applyGameViewButtons();
  applyConsoleBarButtons();
  redrawGameViews();
}
initGameView();
document.querySelectorAll('.view-btn').forEach(b => b.addEventListener('click', (e) => {
  e.stopPropagation();
  gameView = b.dataset.view === 'tile' ? 'tile' : 'list';
  applyGameViewButtons(); redrawGameViews();
  try{ window.storage.set(GAMEVIEW_KEY, gameView, false); }catch(err){}
}));
// Console bar: the consoles by name, or by their logos.
document.querySelectorAll('.bar-btn').forEach(b => b.addEventListener('click', (e) => {
  e.stopPropagation();
  consoleBar = b.dataset.bar === 'logos' ? 'logos' : 'names';
  applyConsoleBarButtons();
  try{ renderSystemChips(); }catch(err){}
  try{ window.storage.set(CONSOLEBAR_KEY, consoleBar, false); }catch(err){}
}));


// Theme picker (Display Options). RETRO is the original look; the rest set CSS variables on <html>.
(function(){
  const buttons = document.querySelectorAll('.theme-btn');
  function mark(id){ buttons.forEach(b => b.classList.toggle('on', b.dataset.themeId === id)); }
  function apply(id){
    if(id === 'retro') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', id);
    try{ localStorage.setItem('glt-theme', id); }catch(e){}
    try{ if(typeof thorBridge !== 'undefined' && thorBridge && thorBridge.setTheme) thorBridge.setTheme(id); }catch(e){} // the top screen follows
    mark(id);
    applyTextSize();
  }
  let cur = 'retro';
  try{ cur = localStorage.getItem('glt-theme') || 'retro'; }catch(e){}
  cur = ({ nes: 'nintendo', psx: 'playstation', snes: 'retro' })[cur] || cur; // renamed or removed themes
  mark(cur);
  try{ if(typeof thorBridge !== 'undefined' && thorBridge && thorBridge.setTheme) thorBridge.setTheme(cur); }catch(e){}
  buttons.forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); apply(b.dataset.themeId); }));
})();


