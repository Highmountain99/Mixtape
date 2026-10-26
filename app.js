import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const DEMO = SUPABASE_URL.startsWith('YOUR_') || SUPABASE_ANON_KEY.startsWith('YOUR_');
const sb = DEMO ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = document.getElementById('app');
const headerUser = document.getElementById('header-user');

const state = {
  session: null,
  me: null,
  members: [],
  settings: null,
  mixtapes: [],
  showAdmin: false,
  editing: false,
  draft: null,
};

// ---------- Helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 86400000;
const mod = (a, n) => ((a % n) + n) % n;

function stockholmToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function mondayOf(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function addWeeks(iso, n) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 7 * DAY).toISOString().slice(0, 10);
}
function weeksBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / (7 * DAY));
}
function fmtDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const currentWeek = () => mondayOf(stockholmToday());
const weekNo = (week) => weeksBetween(state.settings.start_week, week) + 1;

// Same ordering as curator_for_week() in supabase/schema.sql – keep them in sync.
function rotation() {
  return [...state.members].sort((a, b) => a.rotation_order - b.rotation_order || String(a.created_at).localeCompare(String(b.created_at)));
}
function curatorFor(week) {
  const r = rotation();
  if (!r.length || !state.settings) return null;
  return r[mod(weeksBetween(state.settings.start_week, week) + (state.settings.rotation_offset || 0), r.length)];
}
// Offset that keeps this week's curator in place after the rotation changes.
// `newOrder` is the new rotation (member ids, or a placeholder for a not-yet-created member);
// `keepIndex` is the index in `newOrder` that should have the current week.
function offsetFor(newOrder, keepIndex) {
  return mod(keepIndex - weeksBetween(state.settings.start_week, currentWeek()), newOrder.length);
}

function parseSpotify(input) {
  const s = (input || '').trim();
  const m = s.match(/^spotify:(playlist|album):([A-Za-z0-9]+)$/i)
    || s.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]+)/i);
  if (!m) return null;
  const type = m[1].toLowerCase();
  return { type, id: m[2], url: `https://open.spotify.com/${type}/${m[2]}` };
}
async function fetchOembed(url) {
  const res = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(url));
  if (!res.ok) throw new Error('oEmbed failed');
  return res.json();
}
const embedUrl = (url) => {
  const p = parseSpotify(url);
  return p ? `https://open.spotify.com/embed/${p.type}/${p.id}?utm_source=generator&theme=0` : null;
};

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3200);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
const siteUrl = () => location.origin + location.pathname;

// ---------- Data layer ----------
// Every write goes through here so demo mode can fake it locally.

function check({ error }) {
  if (error) throw error;
}

const db = {
  async load() {
    if (DEMO) return; // demo data is already in state
    const [mem, set, mix] = await Promise.all([
      sb.from('members').select('*'),
      sb.from('settings').select('*').eq('id', 1).maybeSingle(),
      sb.from('mixtapes').select('*').order('week_start', { ascending: false }),
    ]);
    state.members = mem.data || [];
    state.settings = set.data;
    state.mixtapes = mix.data || [];
  },
  async upsertMixtape(row) {
    if (DEMO) {
      const curator = state.members.find((m) => m.id === row.member_id);
      state.mixtapes = state.mixtapes.filter((m) => m.week_start !== row.week_start);
      state.mixtapes.push({ id: crypto.randomUUID(), curator_name: curator?.display_name, created_at: new Date().toISOString(), ...row });
      state.mixtapes.sort((a, b) => b.week_start.localeCompare(a.week_start));
      return;
    }
    check(await sb.from('mixtapes').upsert(row, { onConflict: 'week_start' }));
  },
  async deleteMixtape(id) {
    if (DEMO) { state.mixtapes = state.mixtapes.filter((m) => m.id !== id); return; }
    check(await sb.from('mixtapes').delete().eq('id', id));
  },
  async addMember(row) {
    if (DEMO) { state.members.push({ id: crypto.randomUUID(), is_admin: false, created_at: new Date().toISOString(), ...row }); return; }
    check(await sb.from('members').insert(row));
  },
  async updateMember(id, patch) {
    if (DEMO) { Object.assign(state.members.find((m) => m.id === id), patch); return; }
    check(await sb.from('members').update(patch).eq('id', id));
  },
  async deleteMember(id) {
    if (DEMO) { state.members = state.members.filter((m) => m.id !== id); return; }
    check(await sb.from('members').delete().eq('id', id));
  },
  async updateSettings(patch) {
    if (DEMO) { Object.assign(state.settings, patch); return; }
    check(await sb.from('settings').update(patch).eq('id', 1));
  },
};

async function refresh() {
  await db.load();
  const email = state.session?.user?.email?.toLowerCase();
  state.me = state.members.find((m) => m.email === email) || null;
  render();
}

// ---------- Rendering ----------

function render() {
  renderHeader();
  if (!state.session) return renderLogin();
  if (!state.me) return renderNotInvited();
  renderMain();
}

function renderHeader() {
  if (!state.session) { headerUser.innerHTML = ''; return; }
  const name = state.me?.display_name || state.session.user.email;
  headerUser.innerHTML = `
    <span class="name">${esc(name)}</span>
    ${state.me?.is_admin ? `<button class="btn ghost small" id="toggle-admin">${state.showAdmin ? 'Stäng admin' : 'Admin'}</button>` : ''}
    ${DEMO ? '' : '<button class="btn ghost small" id="logout">Logga ut</button>'}`;
  headerUser.querySelector('#logout')?.addEventListener('click', () => sb.auth.signOut());
  headerUser.querySelector('#toggle-admin')?.addEventListener('click', () => {
    state.showAdmin = !state.showAdmin;
    render();
    if (state.showAdmin) document.getElementById('admin')?.scrollIntoView({ behavior: 'smooth' });
  });
}

const cassette = () => '<div class="cassette" aria-hidden="true"><div class="reel l"></div><div class="reel r"></div></div>';

function renderLogin() {
  app.innerHTML = `
    <section class="login card">
      ${cassette()}
      <h1>MIX<span>TAPE</span></h1>
      <p>En ny spellista varje vecka – från en ny vän.</p>
      <form id="login-form">
        <label for="email">Din e-post</label>
        <input id="email" type="email" required autocomplete="email" placeholder="namn@exempel.se">
        <button class="btn" type="submit">Skicka inloggningslänk</button>
      </form>
      <form id="otp-form" hidden>
        <p>Kolla mejlen! Klicka på länken, eller skriv in koden här:</p>
        <input id="otp" inputmode="numeric" autocomplete="one-time-code" placeholder="123456">
        <button class="btn" type="submit">Logga in</button>
      </form>
    </section>`;
  const loginForm = app.querySelector('#login-form');
  const otpForm = app.querySelector('#otp-form');
  let email = '';
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    email = loginForm.email.value.trim().toLowerCase();
    const btn = loginForm.querySelector('button');
    btn.disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: siteUrl() } });
    btn.disabled = false;
    if (error) return toast(error.message, true);
    loginForm.hidden = true;
    otpForm.hidden = false;
  });
  otpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.verifyOtp({ email, token: otpForm.otp.value.trim(), type: 'email' });
    if (error) toast('Fel kod – prova igen', true);
  });
}

function renderNotInvited() {
  app.innerHTML = `
    <section class="login card">
      ${cassette()}
      <h1>Nästan!</h1>
      <p>Du är inloggad som <strong>${esc(state.session.user.email)}</strong>, men den adressen är inte inbjuden än.
      Be admin lägga till dig – sedan är det bara att ladda om sidan.</p>
    </section>`;
}

function renderMain() {
  const week = currentWeek();
  const started = weeksBetween(state.settings.start_week, week) >= 0;
  const current = state.mixtapes.find((m) => m.week_start === week);
  const curator = curatorFor(week);
  const isMine = curator?.id === state.me.id;
  const archive = state.mixtapes.filter((m) => m.week_start < week);

  app.innerHTML = `
    <section class="hero">${renderHero({ week, started, current, curator, isMine })}</section>
    ${renderUpNext(week, started)}
    <section>
      <h2 class="section-title">Tidigare veckor</h2>
      ${archive.length
        ? `<div class="grid">${archive.map(renderTape).join('')}</div>`
        : '<p class="empty">Inga tidigare mixtapes än – det här är början på något fint.</p>'}
    </section>
    ${state.me.is_admin && state.showAdmin ? renderAdmin(week) : ''}`;

  bindHero({ week, isMine });
  bindArchive();
  if (state.me.is_admin && state.showAdmin) bindAdmin();
}

function renderHero({ week, started, current, curator, isMine }) {
  if (!curator) {
    return `<div class="card waiting">${cassette()}<div>
      <h1>Ingen i rotationen än</h1>
      <p>${state.me.is_admin ? 'Öppna Admin och bjud in dina vänner.' : 'Admin behöver lägga till folk i rotationen.'}</p></div></div>`;
  }
  if (!started) {
    const first = curatorFor(state.settings.start_week);
    return `<div class="card waiting">${cassette()}<div>
      <div class="eyebrow">Snart</div>
      <h1>Första mixtapet släpps <span class="marker">${esc(fmtDate(state.settings.start_week))}</span></h1>
      <p>${esc(first.display_name)} kör igång.</p></div></div>`;
  }

  const head = `
    <div class="hero-head">
      <div>
        <div class="eyebrow">Veckans mixtape · Vecka ${weekNo(week)} · ${esc(fmtDate(week))}</div>
        <h1>${current
          ? `<span class="marker">${esc(current.curator_name || curator.display_name)}</span>s val`
          : isMine
            ? `Din tur, <span class="marker">${esc(state.me.display_name)}</span>!`
            : `<span class="marker">${esc(curator.display_name)}</span> har veckan`}</h1>
      </div>
      ${current && (isMine || state.me.is_admin) && !state.editing ? '<button class="btn ghost small" id="edit-link">Byt länk</button>' : ''}
    </div>`;

  if (current && !state.editing) {
    return `${head}<iframe src="${esc(embedUrl(current.spotify_url))}" height="352" loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" title="${esc(current.title || 'Spotify')}"></iframe>`;
  }

  if (isMine || (state.editing && state.me.is_admin)) {
    return `${head}${renderSubmit(current)}`;
  }

  return `${head}<div class="card waiting">${cassette()}<div>
    <h2 style="margin:0">Bandet spolas…</h2>
    <p>${esc(curator.display_name)} har inte lagt upp veckans mixtape än.</p></div></div>`;
}

function renderSubmit(current) {
  const d = state.draft;
  return `
    <div class="card submit">
      <h2>${current ? 'Byt veckans länk' : 'Klistra in din <span class="marker">mixtape</span>'}</h2>
      <p>I Spotify: öppna spellistan → <strong>Dela</strong> → <strong>Kopiera länk</strong>. Klistra sedan in den här.</p>
      <div class="paste-row">
        <input id="link" type="url" inputmode="url" placeholder="https://open.spotify.com/playlist/…" value="${esc(d?.url || '')}" autocomplete="off">
        <button class="btn ghost" id="paste-btn" type="button">📋 Klistra in</button>
      </div>
      <div class="hint" id="hint"></div>
      <div id="preview">${d?.title ? renderPreview(d) : ''}</div>
      <div class="submit-actions">
        <button class="btn" id="publish" ${d?.title ? '' : 'disabled'}>Publicera</button>
        ${current ? '<button class="btn ghost" id="cancel-edit">Avbryt</button>' : ''}
      </div>
    </div>`;
}

const renderPreview = (d) => `
  <div class="preview">
    ${d.cover ? `<img src="${esc(d.cover)}" alt="">` : ''}
    <div><strong>${esc(d.title)}</strong><span>Ser bra ut – tryck Publicera</span></div>
  </div>`;

function renderUpNext(week, started) {
  const r = rotation();
  if (r.length < 2) return '<div class="upnext"></div>';
  const from = started ? 1 : weeksBetween(week, state.settings.start_week) + 1;
  const chips = [0, 1, 2].slice(0, Math.min(3, r.length - 1)).map((i) => {
    const w = addWeeks(week, from + i);
    const c = curatorFor(w);
    return `<span class="chip">${esc(c.display_name)}<small>v.${weekNo(w)}</small></span>`;
  });
  return `<div class="upnext">Härnäst: ${chips.join('')}</div>`;
}

function renderTape(m) {
  return `
    <div class="tape">
      <a href="${esc(m.spotify_url)}" target="_blank" rel="noopener">
        <div class="cover">${m.cover_url ? `<img src="${esc(m.cover_url)}" alt="" loading="lazy">` : ''}</div>
        <div class="meta">
          <div class="week">Vecka ${weekNo(m.week_start)} · ${esc(fmtDate(m.week_start))}</div>
          <span class="title">${esc(m.title || 'Namnlös mixtape')}</span>
          <span class="by">${esc(m.curator_name || '')}</span>
        </div>
      </a>
      ${state.me.is_admin ? `<button class="icon-btn del" data-del="${esc(m.id)}" title="Ta bort" aria-label="Ta bort">✕</button>` : ''}
    </div>`;
}

function renderAdmin(week) {
  const r = rotation();
  const curr = curatorFor(week);
  return `
    <section class="admin" id="admin">
      <h2 class="section-title">Admin</h2>
      <div class="admin-grid">
        <div class="card panel">
          <h3>Rotation</h3>
          <p>Turen går ett steg ner i listan varje måndag. Den som har veckan behåller den även om du ändrar i listan.</p>
          <ul class="member-list">
            ${r.map((m, i) => `
              <li>
                <div class="who">
                  <strong>${esc(m.display_name)}${m.is_admin ? '<span class="badge">admin</span>' : ''}${m.id === curr?.id ? '<span class="now">● nu</span>' : ''}</strong>
                  <span>${esc(m.email)}</span>
                </div>
                <div class="actions">
                  <button class="icon-btn" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Flytta upp" aria-label="Flytta upp">↑</button>
                  <button class="icon-btn" data-move="${i}" data-dir="1" ${i === r.length - 1 ? 'disabled' : ''} title="Flytta ner" aria-label="Flytta ner">↓</button>
                  <button class="icon-btn" data-invite="${esc(m.id)}" title="Kopiera inbjudan" aria-label="Kopiera inbjudan">✉</button>
                  ${m.id === state.me.id ? '' : `<button class="icon-btn" data-remove="${esc(m.id)}" title="Ta bort" aria-label="Ta bort">✕</button>`}
                </div>
              </li>`).join('')}
          </ul>
          <h3>Bjud in en vän</h3>
          <form id="add-member" class="form-row">
            <input name="name" required placeholder="Namn">
            <input name="email" type="email" required placeholder="E-post">
            <button class="btn" type="submit">Lägg till</button>
          </form>
        </div>
        <div class="stack">
          <div class="card panel">
            <h3>Startvecka</h3>
            <p>Vecka 1 i rotationen. Sparar du en ny startvecka börjar turordningen om från toppen av listan.</p>
            <form id="settings" class="form-row">
              <input name="start" type="date" required value="${esc(state.settings.start_week)}">
              <button class="btn" type="submit">Spara</button>
            </form>
          </div>
          <div class="card panel">
            <h3>Lägg till mixtape i efterhand</h3>
            <p>För veckor som missats eller från innan sajten fanns.</p>
            <form id="backfill" class="stacked">
              <input name="week" type="date" required value="${esc(addWeeks(week, -1))}">
              <select name="member" required>${r.map((m) => `<option value="${esc(m.id)}">${esc(m.display_name)}</option>`).join('')}</select>
              <input name="link" required placeholder="Spotify-länk">
              <button class="btn" type="submit">Spara</button>
            </form>
          </div>
        </div>
      </div>
    </section>`;
}

// ---------- Events ----------

function bindHero({ week, isMine }) {
  app.querySelector('#edit-link')?.addEventListener('click', () => { state.editing = true; state.draft = null; render(); });
  app.querySelector('#cancel-edit')?.addEventListener('click', () => { state.editing = false; state.draft = null; render(); });

  const input = app.querySelector('#link');
  if (!input) return;
  const hint = app.querySelector('#hint');
  const preview = app.querySelector('#preview');
  const publish = app.querySelector('#publish');

  let seq = 0;
  async function handle(value) {
    const mine = ++seq;
    state.draft = null;
    publish.disabled = true;
    preview.innerHTML = '';
    hint.className = 'hint';
    hint.textContent = '';
    if (!value.trim()) return;
    const parsed = parseSpotify(value);
    if (!parsed) {
      hint.className = 'hint error';
      hint.textContent = value.includes('spotify.link')
        ? 'Kortlänkar (spotify.link) funkar inte – öppna länken och kopiera adressen från open.spotify.com.'
        : 'Det där ser inte ut som en Spotify-länk till en spellista eller ett album.';
      return;
    }
    hint.textContent = 'Hämtar omslag…';
    try {
      const o = await fetchOembed(parsed.url);
      if (mine !== seq) return;
      state.draft = { url: parsed.url, title: o.title, cover: o.thumbnail_url };
      hint.textContent = '';
      preview.innerHTML = renderPreview(state.draft);
      publish.disabled = false;
    } catch {
      if (mine !== seq) return;
      hint.className = 'hint error';
      hint.textContent = 'Kunde inte hämta spellistan – är den publik?';
    }
  }

  input.addEventListener('input', () => handle(input.value));
  app.querySelector('#paste-btn').addEventListener('click', async () => {
    try {
      input.value = await navigator.clipboard.readText();
      handle(input.value);
    } catch {
      input.focus();
      toast('Tryck och håll i fältet och välj Klistra in');
    }
  });
  if (!state.draft) input.focus();

  publish.addEventListener('click', async () => {
    if (!state.draft) return;
    publish.disabled = true;
    const existing = state.mixtapes.find((m) => m.week_start === week);
    try {
      await db.upsertMixtape({
        week_start: week,
        member_id: isMine ? state.me.id : (existing?.member_id ?? curatorFor(week).id),
        spotify_url: state.draft.url,
        title: state.draft.title,
        cover_url: state.draft.cover,
      });
      state.draft = null;
      state.editing = false;
      toast('Veckans mixtape är ute! 🎉');
      await refresh();
    } catch (err) {
      publish.disabled = false;
      toast(err.message || 'Något gick fel', true);
    }
  });
}

function bindArchive() {
  app.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Ta bort det här mixtapet?')) return;
    await run(() => db.deleteMixtape(btn.dataset.del), 'Borttaget');
  }));
}

async function run(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await refresh();
  } catch (err) {
    toast(err.message || 'Något gick fel', true);
  }
}

function bindAdmin() {
  const r = rotation();
  const now = curatorFor(currentWeek());
  const keepOffset = (order) => db.updateSettings({ rotation_offset: offsetFor(order, Math.max(0, order.indexOf(now?.id))) });

  app.querySelectorAll('[data-move]').forEach((btn) => btn.addEventListener('click', () => {
    const i = Number(btn.dataset.move);
    const j = i + Number(btn.dataset.dir);
    const order = [...r];
    [order[i], order[j]] = [order[j], order[i]];
    run(async () => {
      await Promise.all(order.map((m, k) => db.updateMember(m.id, { rotation_order: (k + 1) * 10 })));
      await keepOffset(order.map((m) => m.id));
    });
  }));

  app.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
    const m = r.find((x) => x.id === btn.dataset.remove);
    if (!confirm(`Ta bort ${m.display_name} från gänget? Deras gamla mixtapes ligger kvar.`)) return;
    const order = r.filter((x) => x.id !== m.id).map((x) => x.id);
    run(async () => {
      await db.deleteMember(m.id);
      if (!order.length) return;
      // If the removed person had this week, the next one in line takes over.
      const keep = m.id === now?.id ? r.indexOf(m) % order.length : order.indexOf(now?.id);
      await db.updateSettings({ rotation_offset: offsetFor(order, keep) });
    }, `${m.display_name} borttagen`);
  }));

  app.querySelectorAll('[data-invite]').forEach((btn) => btn.addEventListener('click', async () => {
    const m = r.find((x) => x.id === btn.dataset.invite);
    const text = `Hej ${m.display_name}! Du är med i vårt Mixtape-gäng 📼 Varje vecka delar en av oss en spellista. Logga in med ${m.email} här: ${siteUrl()}`;
    toast((await copyText(text)) ? 'Inbjudan kopierad – skicka den till din vän' : 'Kunde inte kopiera', false);
  }));

  app.querySelector('#add-member').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim().toLowerCase();
    if (state.members.some((m) => m.email === email)) return toast('Den adressen finns redan', true);
    const maxOrder = Math.max(0, ...state.members.map((m) => m.rotation_order));
    run(async () => {
      await db.addMember({ display_name: f.name.value.trim(), email, rotation_order: maxOrder + 10 });
      await keepOffset([...r.map((m) => m.id), 'new']);
    }, `${f.name.value.trim()} tillagd – tryck ✉ för att kopiera inbjudan`);
  });

  app.querySelector('#settings').addEventListener('submit', (e) => {
    e.preventDefault();
    // A new start week restarts the rotation: week 1 belongs to the first person in the list.
    run(() => db.updateSettings({ start_week: mondayOf(e.target.start.value), rotation_offset: 0 }), 'Sparat');
  });

  app.querySelector('#backfill').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const parsed = parseSpotify(f.link.value);
    if (!parsed) return toast('Ogiltig Spotify-länk', true);
    let o = {};
    try { o = await fetchOembed(parsed.url); } catch { /* save without cover */ }
    run(() => db.upsertMixtape({
      week_start: mondayOf(f.week.value),
      member_id: f.member.value,
      spotify_url: parsed.url,
      title: o.title || null,
      cover_url: o.thumbnail_url || null,
    }), 'Mixtape tillagt');
  });
}

// ---------- Boot ----------

async function bootDemo() {
  document.getElementById('demo-banner').hidden = false;
  const week = currentWeek();
  const names = ['Magnus', 'Elin', 'Johan', 'Sara', 'Ali', 'Linnea'];
  state.members = names.map((n, i) => ({
    id: `demo-${i}`, display_name: n, email: `${n.toLowerCase()}@exempel.se`,
    is_admin: i === 0, rotation_order: (i + 1) * 10, created_at: `2026-01-0${i + 1}T00:00:00Z`,
  }));
  // Start the rotation so that it's Magnus' turn this week, with nine weeks of history.
  state.settings = { start_week: addWeeks(week, -12), rotation_offset: 0 };
  state.session = { user: { email: 'magnus@exempel.se' } };
  state.me = state.members[0];

  const ids = ['37i9dQZF1DXcBWIGoYBM5M', '37i9dQZF1DX4sWSpwq3LiO', '37i9dQZF1DWXRqgorJj26U', '37i9dQZF1DX0XUsuxWHRQd',
    '37i9dQZF1DX4dyzvuaRJ0n', '37i9dQZF1DWWQRwui0ExPn', '37i9dQZF1DX4WYpdgoIcn6', '37i9dQZF1DX0SM0LYsmbMT', '37i9dQZF1DWZd79rJ6a7lp'];
  const rows = await Promise.all(ids.map(async (id, i) => {
    const w = addWeeks(week, -(i + 1));
    const url = `https://open.spotify.com/playlist/${id}`;
    let o = {};
    try { o = await fetchOembed(url); } catch { /* offline */ }
    return { id: `mix-${i}`, week_start: w, member_id: curatorFor(w).id, curator_name: curatorFor(w).display_name,
      spotify_url: url, title: o.title, cover_url: o.thumbnail_url };
  }));
  state.mixtapes = rows;
  render();
}

if (DEMO) {
  bootDemo();
} else {
  sb.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    // Defer so we don't call Supabase from inside the auth callback (can deadlock).
    setTimeout(() => (session ? refresh() : render()), 0);
  });
}
