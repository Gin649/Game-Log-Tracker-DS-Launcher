// Play log: for games on consoles with no emulator to count time on (PlayStation 5, Xbox Series X|S, Nintendo Switch 2, PC),
// you log each session by hand: the date played and the time in hours and minutes. Sessions are saved with the game.
// The total is the game's Playtime, and the newest session date decides where it sits in Last Played.

// Only these systems for now (a PC game is "PC (Microsoft Windows)"; PC Engine and the like are emulated, so they are not here).
function usesPlayLog(consoleName){
  return /playstation\s*5|\bps5\b|xbox\s*series|switch\s*2|microsoft windows|^\s*(pc|windows)\s*$/i.test(String(consoleName || ''));
}

function playLogSessions(g){
  return Array.isArray(g && g.playLog) ? g.playLog.filter(s => s && s.date && Number(s.min) > 0) : [];
}

function playLogMinutes(g){
  return playLogSessions(g).reduce((n, s) => n + Number(s.min), 0);
}

function playLogTime(min){
  min = Math.round(Number(min) || 0);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function playLogDateLabel(dateStr){
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, (mo || 1) - 1, d || 1);
  return isNaN(dt.getTime()) ? dateStr : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function playLogToday(){
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

// When the newest session was: a session logged for today counts as now (so it sorts first), an older day as noon that day.
function playLogLastPlayed(sessions){
  if(!sessions.length) return null;
  const newest = sessions.map(s => s.date).sort().pop();
  if(newest === playLogToday()) return new Date().toISOString();
  const [y, mo, d] = newest.split('-').map(Number);
  return new Date(y, mo - 1, d, 12, 0, 0).toISOString();
}

// Saves the session list on the game, keeps lastPlayed in step, and ticks Now Playing once the first session is logged.
async function savePlayLog(gameId, sessions){
  return enqueueTask(async () => {
    const idx = libraryData.findIndex(g => g.GameID === gameId);
    if(idx === -1) return;
    const patch = { playLog: sessions, lastPlayed: playLogLastPlayed(sessions) };
    if(sessions.length && !libraryData[idx].manualStarted && !libraryData[idx].manualBeaten) patch.manualStarted = true;
    libraryData[idx] = { ...libraryData[idx], ...patch };
    const manual = await loadManualGames();
    const mi = manual.findIndex(g => g.GameID === gameId);
    if(mi !== -1){
      manual[mi] = { ...manual[mi], ...patch };
      await saveManualGames(manual);
    }
    renderSystemChips();
    renderBacklog();
    renderLibrary();
    renderByYear();
    try{ renderRecentGames(recentGamesData); }catch(e){}
  });
}

// The collapsed "Play log" panel on a game's profile. onChange(total minutes, lastPlayed) lets the profile refresh its rows.
function setupPlayLogUI(gameId, card, onChange){
  const btn = card.querySelector('#modal-playlog-btn');
  const panel = card.querySelector('#modal-playlog-panel');
  if(!btn || !panel) return;
  let editing = null; // id of the session being edited, '' for a new one

  const current = () => playLogSessions(libraryData.find(g => g.GameID === gameId) || {});
  const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  const label = () => {
    const mins = current().reduce((n, s) => n + Number(s.min), 0);
    btn.innerHTML = `<span class="arrow">▸</span> Play log${mins ? ` · ${playLogTime(mins)}` : ''}`;
    btn.classList.toggle('open', panel.style.display !== 'none');
  };

  const formHtml = (s) => `
    <div class="pl-form">
      <div class="pl-label">${s ? 'Edit session' : 'Add a play session'}</div>
      <div class="pl-fields">
        <div class="field"><label>Date played</label><input type="date" id="pl-date" value="${s ? s.date : playLogToday()}" max="${playLogToday()}"></div>
        <div class="field sm"><label>Hours</label><input type="number" id="pl-h" min="0" max="999" inputmode="numeric" value="${s ? Math.floor(s.min / 60) : ''}"></div>
        <div class="field sm"><label>Minutes</label><input type="number" id="pl-m" min="0" max="59" inputmode="numeric" value="${s ? s.min % 60 : ''}"></div>
      </div>
      <div class="pl-error" id="pl-error" style="display:none;"></div>
      <div class="pl-btns">
        <button class="btn-primary" id="pl-save" type="button">${s ? 'Save changes' : 'Save session'}</button>
        ${s ? '<button class="btn-ghost" id="pl-cancel" type="button">Cancel</button><button class="btn-ghost pl-del" id="pl-del" type="button">Delete</button>' : ''}
      </div>
    </div>`;

  const draw = () => {
    const list = current().slice().sort((a, b) => b.date.localeCompare(a.date));
    const total = list.reduce((n, s) => n + Number(s.min), 0);
    const rows = list.map(s => `
      <div class="pl-row"><span class="pl-date">${playLogDateLabel(s.date)}</span><span class="pl-time">${playLogTime(s.min)}</span>
      <button class="pl-edit" type="button" data-id="${s.id}">Edit</button></div>`).join('');
    const editSession = editing ? list.find(s => s.id === editing) : null;
    panel.innerHTML = `
      <div class="pl-head"><span class="pl-label">PLAY LOG</span><span class="pl-total">${total ? playLogTime(total) + ' total' : 'No sessions yet'}</span></div>
      ${rows ? `<div class="pl-list">${rows}</div>` : ''}
      ${formHtml(editSession)}`;
    panel.querySelectorAll('.pl-edit').forEach(b => b.addEventListener('click', () => { editing = b.dataset.id; draw(); }));
    const err = msg => { const e = panel.querySelector('#pl-error'); e.textContent = msg; e.style.display = 'block'; };
    panel.querySelector('#pl-save').addEventListener('click', async () => {
      const date = panel.querySelector('#pl-date').value;
      const min = (parseInt(panel.querySelector('#pl-h').value, 10) || 0) * 60 + (parseInt(panel.querySelector('#pl-m').value, 10) || 0);
      if(!date) return err('Pick the date you played.');
      if(date > playLogToday()) return err('That date is in the future.');
      if(min <= 0) return err('Enter the time you played, in hours and minutes.');
      const sessions = current();
      if(editSession){ const s = sessions.find(x => x.id === editSession.id); if(s){ s.date = date; s.min = min; } }
      else sessions.push({ id: newId(), date, min });
      editing = null;
      await savePlayLog(gameId, sessions);
      draw(); label(); onChange();
    });
    const cancel = panel.querySelector('#pl-cancel');
    if(cancel) cancel.addEventListener('click', () => { editing = null; draw(); });
    const del = panel.querySelector('#pl-del');
    if(del) del.addEventListener('click', async () => {
      const sessions = current().filter(s => s.id !== editSession.id);
      editing = null;
      await savePlayLog(gameId, sessions);
      draw(); label(); onChange();
    });
  };

  btn.addEventListener('click', () => {
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    if(open) draw();
    label();
  });
  label();
}
