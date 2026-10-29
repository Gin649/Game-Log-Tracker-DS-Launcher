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

// A menu heading that opens and closes its submenu.
function wireSubmenu(name){
  $('#btn-' + name + '-heading').addEventListener('click', (e) => {
    e.stopPropagation();
    const submenu = $('#' + name + '-submenu');
    const isOpen = submenu.style.display === 'block';
    submenu.style.display = isOpen ? 'none' : 'block';
    $('#' + name + '-heading-arrow').textContent = isOpen ? '▸' : '▾';
  });
}
['ra', 'textsize', 'display'].forEach(wireSubmenu);

// Text size: every font size is in rem, so the size on <html> scales them all (art keeps its size).
const TEXTSIZE_MIN = 80, TEXTSIZE_MAX = 160, TEXTSIZE_STEP = 10, TEXTSIZE_DEFAULT = 100, TEXTSIZE_BASE_PX = 16;
const TEXTSIZE_KEY = 'app-text-size-pct';
let textSizePct = TEXTSIZE_DEFAULT;

function applyTextSize(){
  document.documentElement.style.fontSize = (TEXTSIZE_BASE_PX * textSizePct / 100) + 'px';
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
