'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// State global
let limits = { minIntervalMinutes: 1, maxIntervalMinutes: 360, minTriggerSecond: 13, maxTriggerSecond: 55 };
let accountsCache = [];
let groupsCache = []; // grup untuk akun terpilih di form
let selectedGroups = new Set();
let editingJobId = null;

// ---------- Util ----------
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer = null;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok || data.ok === false) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
}

const STATE_LABEL = {
  ready: ['Terhubung', 'dot-ready'],
  qr: ['Scan QR', 'dot-wait'],
  authenticated: ['Menyiapkan...', 'dot-wait'],
  initializing: ['Menghubungkan...', 'dot-wait'],
  uninitialized: ['Belum siap', 'dot-idle'],
  disconnected: ['Terputus', 'dot-err'],
  auth_failure: ['Gagal Auth', 'dot-err'],
};

// ---------- Tabs ----------
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`#tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'jobs') loadJobs();
    if (tab.dataset.tab === 'create') refreshAccountSelect();
  });
});

// ============================================================
// AKUN
// ============================================================
async function loadAccounts() {
  try {
    const data = await api('/api/accounts');
    accountsCache = data.accounts;
    renderAccounts();
    refreshAccountSelect();
  } catch (err) {
    console.error(err);
  }
}

function renderAccounts() {
  const grid = $('#accountGrid');
  if (accountsCache.length === 0) {
    grid.innerHTML = '<p class="muted empty">Belum ada akun. Klik "Tambah Akun" untuk memulai.</p>';
    return;
  }
  grid.innerHTML = '';
  for (const acc of accountsCache) {
    const [label, dotClass] = STATE_LABEL[acc.state] || ['Tidak diketahui', 'dot-idle'];
    const card = document.createElement('div');
    card.className = 'account-card';

    let body = '';
    if (acc.state === 'qr' && acc.qr) {
      body = `<div class="qr"><img src="${acc.qr}" alt="QR" /><p>Buka WhatsApp &rarr; Perangkat Tertaut &rarr; Tautkan Perangkat, lalu scan.</p></div>`;
    } else if (acc.state === 'ready' && acc.me) {
      body = `<div class="me">Login sebagai <strong>${escapeHtml(acc.me.name || '-')}</strong><br>${escapeHtml(acc.me.number || '-')}</div>`;
    } else {
      body = `<p class="state-text">${escapeHtml(acc.error || label)}</p>`;
    }

    card.innerHTML = `
      <h3><span class="dot ${dotClass}"></span>${escapeHtml(acc.label)}</h3>
      <div class="state-text">${label}</div>
      ${body}
      <div class="card-actions">
        <button class="btn btn-mini" data-act="logout" data-id="${acc.id}">Logout / QR Baru</button>
        <button class="btn btn-mini btn-danger" data-act="delete" data-id="${acc.id}">Hapus</button>
      </div>
    `;
    grid.appendChild(card);
  }

  grid.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => handleAccountAction(btn.dataset.act, btn.dataset.id));
  });
}

async function handleAccountAction(act, id) {
  const acc = accountsCache.find((a) => a.id === id);
  if (act === 'logout') {
    if (!confirm(`Logout akun "${acc?.label}"? Anda perlu scan QR lagi.`)) return;
    try { await api(`/api/accounts/${id}/logout`, { method: 'POST' }); toast('Logout berhasil. Menunggu QR baru...', 'ok'); loadAccounts(); }
    catch (err) { toast(err.message, 'err'); }
  } else if (act === 'delete') {
    if (!confirm(`Hapus akun "${acc?.label}" beserta semua jadwalnya? Tindakan ini permanen.`)) return;
    try { await api(`/api/accounts/${id}`, { method: 'DELETE' }); toast('Akun dihapus.', 'ok'); loadAccounts(); }
    catch (err) { toast(err.message, 'err'); }
  }
}

$('#btnAddAccount').addEventListener('click', async () => {
  const label = $('#newAccountLabel').value.trim();
  try {
    await api('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    $('#newAccountLabel').value = '';
    toast('Akun ditambahkan. Tunggu QR muncul, lalu scan.', 'ok');
    loadAccounts();
  } catch (err) { toast(err.message, 'err'); }
});

// ============================================================
// FORM JADWAL
// ============================================================
function refreshAccountSelect() {
  const sel = $('#fAccount');
  const current = sel.value;
  sel.innerHTML = '';
  if (accountsCache.length === 0) {
    sel.innerHTML = '<option value="">-- Belum ada akun --</option>';
    return;
  }
  for (const acc of accountsCache) {
    const opt = document.createElement('option');
    opt.value = acc.id;
    const status = acc.state === 'ready' ? '● ' : '○ ';
    opt.textContent = `${status}${acc.label}${acc.state === 'ready' ? '' : ' (' + (STATE_LABEL[acc.state]?.[0] || acc.state) + ')'}`;
    sel.appendChild(opt);
  }
  if (current && accountsCache.some((a) => a.id === current)) sel.value = current;
}

async function loadGroups() {
  const accountId = $('#fAccount').value;
  const list = $('#groupList');
  if (!accountId) { toast('Pilih akun terlebih dahulu.', 'err'); return; }
  list.innerHTML = '<p class="muted">Memuat daftar grup...</p>';
  try {
    const data = await api(`/api/accounts/${accountId}/groups`);
    groupsCache = data.groups;
    renderGroups();
    toast(`Memuat ${groupsCache.length} grup.`, 'ok');
  } catch (err) {
    list.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

function renderGroups() {
  const q = $('#groupSearch').value.trim().toLowerCase();
  const list = groupsCache.filter((g) => g.name.toLowerCase().includes(q));
  const box = $('#groupList');
  if (groupsCache.length === 0) { box.innerHTML = '<p class="muted">Tidak ada grup. Klik "Muat Grup".</p>'; return; }
  if (list.length === 0) { box.innerHTML = '<p class="muted">Tidak ada grup yang cocok.</p>'; return; }
  box.innerHTML = '';
  for (const g of list) {
    const item = document.createElement('label');
    item.className = 'group-item';
    const checked = selectedGroups.has(g.id) ? 'checked' : '';
    const meta = g.participants ? `${g.participants} anggota` : '';
    item.innerHTML = `
      <input type="checkbox" value="${escapeHtml(g.id)}" ${checked} />
      <span class="g-name">${escapeHtml(g.name)}</span>
      <span class="g-meta">${meta}</span>`;
    const cb = item.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) selectedGroups.add(g.id); else selectedGroups.delete(g.id);
      updateGroupCount();
    });
    box.appendChild(item);
  }
}

function updateGroupCount() { $('#groupCount').textContent = `${selectedGroups.size} grup dipilih`; }

$('#btnReloadGroups').addEventListener('click', loadGroups);
$('#groupSearch').addEventListener('input', renderGroups);
$('#fAccount').addEventListener('change', () => { groupsCache = []; selectedGroups.clear(); renderGroups(); updateGroupCount(); });
$('#btnSelectAll').addEventListener('click', () => { groupsCache.forEach((g) => selectedGroups.add(g.id)); renderGroups(); updateGroupCount(); });
$('#btnClearAll').addEventListener('click', () => { selectedGroups.clear(); renderGroups(); updateGroupCount(); });

// Preview media
$('#fMedia').addEventListener('change', () => {
  const file = $('#fMedia').files[0];
  const box = $('#mediaPreview');
  box.innerHTML = '';
  if (!file) { box.classList.add('hidden'); return; }
  const url = URL.createObjectURL(file);
  const node = file.type.startsWith('video/') ? document.createElement('video') : document.createElement('img');
  if (file.type.startsWith('video/')) node.controls = true;
  node.src = url;
  box.appendChild(node);
  box.classList.remove('hidden');
});

// Submit form (create / edit)
$('#jobForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (selectedGroups.size === 0) return toast('Pilih minimal satu grup tujuan.', 'err');

  const fd = new FormData();
  fd.append('accountId', $('#fAccount').value);
  fd.append('name', $('#fName').value);
  fd.append('caption', $('#fCaption').value);
  fd.append('groupIds', JSON.stringify([...selectedGroups]));
  fd.append('intervalMinutes', $('#fInterval').value);
  fd.append('minSecond', $('#fMinSecond').value);
  fd.append('maxSecond', $('#fMaxSecond').value);
  fd.append('enabled', $('#fEnabled').checked ? 'true' : 'false');
  if ($('#fMedia').files[0]) fd.append('media', $('#fMedia').files[0]);
  if (editingJobId && $('#fRemoveMedia').checked) fd.append('removeMedia', 'true');

  const btn = $('#btnSaveJob');
  btn.disabled = true; btn.textContent = 'Menyimpan...';
  try {
    if (editingJobId) {
      await api(`/api/jobs/${editingJobId}`, { method: 'PUT', body: fd });
      toast('Jadwal diperbarui.', 'ok');
    } else {
      await api('/api/jobs', { method: 'POST', body: fd });
      toast('Jadwal dibuat.', 'ok');
    }
    resetForm();
    // pindah ke tab daftar
    $('.tab[data-tab="jobs"]').click();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = editingJobId ? 'Simpan Perubahan' : 'Simpan Jadwal';
  }
});

$('#btnCancelEdit').addEventListener('click', resetForm);

function resetForm() {
  editingJobId = null;
  $('#jobForm').reset();
  $('#jobId').value = '';
  selectedGroups.clear();
  groupsCache = [];
  renderGroups();
  updateGroupCount();
  $('#mediaPreview').classList.add('hidden');
  $('#mediaPreview').innerHTML = '';
  $('#currentMediaRow').classList.add('hidden');
  $('#fRemoveMedia').checked = false;
  $('#formTitle').textContent = 'Buat Jadwal Posting';
  $('#btnSaveJob').textContent = 'Simpan Jadwal';
  $('#btnCancelEdit').classList.add('hidden');
  $('#fInterval').value = 30;
  $('#fMinSecond').value = limits.minTriggerSecond;
  $('#fMaxSecond').value = limits.maxTriggerSecond;
}

// ============================================================
// DAFTAR JADWAL
// ============================================================
async function loadJobs() {
  const box = $('#jobList');
  try {
    const data = await api('/api/jobs');
    renderJobs(data.jobs);
  } catch (err) {
    box.innerHTML = `<p class="muted empty">${escapeHtml(err.message)}</p>`;
  }
}

function renderJobs(jobs) {
  const box = $('#jobList');
  if (!jobs || jobs.length === 0) { box.innerHTML = '<p class="muted empty">Belum ada jadwal.</p>'; return; }
  box.innerHTML = '';
  for (const job of jobs) {
    const card = document.createElement('div');
    card.className = 'job-card' + (job.enabled ? '' : ' disabled');

    let resultHtml = '';
    if (job.lastResult) {
      if (job.lastResult.error) {
        resultHtml = `<div class="job-result"><span class="err">Gagal:</span> ${escapeHtml(job.lastResult.error)} <span class="muted">(${fmtTime(job.lastResult.at)})</span></div>`;
      } else {
        resultHtml = `<div class="job-result"><span class="ok">${job.lastResult.sent} terkirim</span>, <span class="err">${job.lastResult.failed} gagal</span> <span class="muted">(${fmtTime(job.lastResult.at)})</span></div>`;
      }
    }

    const mediaChip = job.mediaName
      ? `<span class="chip">📎 ${escapeHtml(job.mediaName)}</span>`
      : '<span class="chip gray">Teks saja</span>';

    card.innerHTML = `
      <div class="job-top">
        <div>
          <h3>${escapeHtml(job.name)}</h3>
          <div class="job-meta">Akun: <strong>${escapeHtml(job.accountLabel)}</strong></div>
        </div>
        <label class="switch" title="Aktif/Nonaktif">
          <input type="checkbox" data-act="toggle" data-id="${job.id}" ${job.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="job-chips">
        <span class="chip">⏱ ${job.intervalMinutes} menit</span>
        <span class="chip">🎯 detik ${job.minSecond}-${job.maxSecond}</span>
        <span class="chip">👥 ${job.groupIds.length} grup</span>
        ${mediaChip}
        <span class="chip gray">${job.runCount || 0}x terkirim</span>
      </div>
      ${job.caption ? `<div class="job-caption">${escapeHtml(job.caption)}</div>` : ''}
      <div class="job-meta">Berikutnya: <strong>${job.enabled ? fmtTime(job.nextRunAt) : 'nonaktif'}</strong> &middot; Terakhir: ${fmtTime(job.lastRunAt)}</div>
      ${resultHtml}
      <div class="job-actions">
        <button class="btn btn-mini btn-ghost" data-act="run" data-id="${job.id}">▶ Kirim Sekarang</button>
        <button class="btn btn-mini" data-act="edit" data-id="${job.id}">✎ Edit</button>
        <button class="btn btn-mini btn-danger" data-act="delete" data-id="${job.id}">🗑 Hapus</button>
      </div>
    `;
    box.appendChild(card);
  }

  box.querySelectorAll('[data-act]').forEach((el) => {
    const act = el.dataset.act, id = el.dataset.id;
    if (act === 'toggle') el.addEventListener('change', () => toggleJob(id, el.checked));
    else el.addEventListener('click', () => handleJobAction(act, id));
  });
}

async function toggleJob(id, enabled) {
  try {
    await api(`/api/jobs/${id}/toggle`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    toast(enabled ? 'Jadwal diaktifkan.' : 'Jadwal dinonaktifkan.', 'ok');
    loadJobs();
  } catch (err) { toast(err.message, 'err'); loadJobs(); }
}

async function handleJobAction(act, id) {
  if (act === 'run') {
    toast('Mengirim sekarang...', '');
    try {
      const data = await api(`/api/jobs/${id}/run`, { method: 'POST' });
      const s = data.summary;
      if (s.error) toast('Gagal: ' + s.error, 'err');
      else toast(`Selesai: ${s.sent} terkirim, ${s.failed} gagal.`, 'ok');
      loadJobs();
    } catch (err) { toast(err.message, 'err'); }
  } else if (act === 'delete') {
    if (!confirm('Hapus jadwal ini?')) return;
    try { await api(`/api/jobs/${id}`, { method: 'DELETE' }); toast('Jadwal dihapus.', 'ok'); loadJobs(); }
    catch (err) { toast(err.message, 'err'); }
  } else if (act === 'edit') {
    startEdit(id);
  }
}

async function startEdit(id) {
  try {
    const data = await api('/api/jobs');
    const job = data.jobs.find((j) => j.id === id);
    if (!job) return toast('Jadwal tidak ditemukan.', 'err');

    editingJobId = id;
    $('#formTitle').textContent = 'Edit Jadwal';
    $('#btnSaveJob').textContent = 'Simpan Perubahan';
    $('#btnCancelEdit').classList.remove('hidden');

    refreshAccountSelect();
    $('#fAccount').value = job.accountId;
    $('#fName').value = job.name;
    $('#fCaption').value = job.caption || '';
    $('#fInterval').value = job.intervalMinutes;
    $('#fMinSecond').value = job.minSecond;
    $('#fMaxSecond').value = job.maxSecond;
    $('#fEnabled').checked = job.enabled;

    selectedGroups = new Set(job.groupIds);
    updateGroupCount();

    // media saat ini
    if (job.mediaName) {
      $('#currentMediaRow').classList.remove('hidden');
      $('#fRemoveMedia').checked = false;
    } else {
      $('#currentMediaRow').classList.add('hidden');
    }
    $('#mediaPreview').classList.add('hidden');
    $('#mediaPreview').innerHTML = '';

    // muat grup akun agar bisa centang ulang
    await loadGroups();

    $('.tab[data-tab="create"]').click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) { toast(err.message, 'err'); }
}

$('#btnReloadJobs').addEventListener('click', loadJobs);

// ============================================================
// INIT
// ============================================================
async function init() {
  try {
    const cfg = await api('/api/config');
    limits = cfg.schedule;
    $('#fInterval').min = limits.minIntervalMinutes;
    $('#fInterval').max = limits.maxIntervalMinutes;
    $('#fMinSecond').min = $('#fMaxSecond').min = limits.minTriggerSecond;
    $('#fMinSecond').max = $('#fMaxSecond').max = limits.maxTriggerSecond;
    $('#fMinSecond').value = limits.minTriggerSecond;
    $('#fMaxSecond').value = limits.maxTriggerSecond;
    $('#intervalHint').textContent = `Antara ${limits.minIntervalMinutes} - ${limits.maxIntervalMinutes} menit.`;
    $('#secondHint').textContent = `Pengiriman jatuh di detik acak ${limits.minTriggerSecond} - ${limits.maxTriggerSecond} (bukan detik 00).`;
  } catch (_) {}

  loadAccounts();
  // Polling status akun tiap 3 detik (untuk QR & status koneksi).
  setInterval(loadAccounts, 3000);
}

init();
