'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const config = require('./config');
const store = require('./src/store');
const accountManager = require('./src/account-manager');
const scheduler = require('./src/scheduler');

const app = express();

// Pastikan folder yang dibutuhkan ada.
const uploadDir = path.resolve(__dirname, config.uploadDir);
for (const dir of [uploadDir, path.resolve(__dirname, config.dataDir)]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---- Multer (upload media) ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (req, file, cb) => {
    if (config.allowedMime.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipe file tidak didukung: ${file.mimetype}`));
  },
});

// ---- Middleware ----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Util ----
function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
function removeFileSafe(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') console.warn('[server] Gagal hapus file:', err.message);
  });
}
function parseGroupIds(raw) {
  let ids = raw;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch (_) {
      ids = [ids];
    }
  }
  if (!Array.isArray(ids)) ids = ids ? [ids] : [];
  return ids.filter(Boolean);
}
function statusCodeFor(err) {
  if (['NOT_READY'].includes(err.code)) return 409;
  if (['NO_ACCOUNT', 'NO_JOB'].includes(err.code)) return 404;
  if (['NO_GROUP', 'EMPTY_CONTENT', 'MEDIA_MISSING', 'VALIDATION'].includes(err.code)) return 400;
  return 500;
}

// ======================= API: AKUN =======================

// Daftar akun beserta status koneksi (+ QR bila perlu).
app.get('/api/accounts', (req, res) => {
  res.json({ ok: true, accounts: accountManager.list().map((a) => a.toStatus()) });
});

// Tambah akun baru.
app.post('/api/accounts', (req, res) => {
  const acc = accountManager.add(req.body && req.body.label);
  res.json({ ok: true, account: acc.toStatus() });
});

// Ganti nama akun.
app.patch('/api/accounts/:id', (req, res) => {
  const acc = accountManager.rename(req.params.id, req.body && req.body.label);
  if (!acc) return res.status(404).json({ ok: false, error: 'Akun tidak ditemukan.' });
  res.json({ ok: true, account: acc.toStatus() });
});

// Logout akun (reset sesi, minta QR baru).
app.post('/api/accounts/:id/logout', async (req, res) => {
  try {
    await accountManager.logout(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Hapus akun sepenuhnya.
app.delete('/api/accounts/:id', async (req, res) => {
  try {
    // Hentikan timer jadwal milik akun ini & hapus filenya.
    for (const job of store.listJobsByAccount(req.params.id)) {
      scheduler.stop(job.id);
      removeFileSafe(job.mediaPath);
    }
    await accountManager.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Daftar grup untuk satu akun.
app.get('/api/accounts/:id/groups', async (req, res) => {
  try {
    const groups = await accountManager.getGroups(req.params.id);
    res.json({ ok: true, groups });
  } catch (err) {
    res.status(statusCodeFor(err)).json({ ok: false, error: err.message });
  }
});

// ======================= API: JADWAL =======================

// Daftar semua jadwal (dengan info akun & rentang config).
app.get('/api/jobs', (req, res) => {
  const accLabels = {};
  for (const a of accountManager.list()) accLabels[a.id] = a.label;
  const jobs = store.listJobs().map((j) => ({ ...j, accountLabel: accLabels[j.accountId] || '(akun terhapus)' }));
  res.json({ ok: true, jobs, limits: config.schedule });
});

// Buat jadwal baru. (multipart: media opsional + field)
app.post('/api/jobs', upload.single('media'), (req, res) => {
  const filePath = req.file ? req.file.path : null;
  try {
    const b = req.body;
    const accountId = b.accountId;
    if (!accountId || !accountManager.get(accountId)) {
      const err = new Error('Pilih akun WhatsApp yang valid.');
      err.code = 'VALIDATION';
      throw err;
    }
    const groupIds = parseGroupIds(b.groupIds);
    if (groupIds.length === 0) {
      const err = new Error('Pilih minimal satu grup tujuan.');
      err.code = 'NO_GROUP';
      throw err;
    }
    const caption = b.caption || '';
    if (!filePath && !caption.trim()) {
      const err = new Error('Isi teks atau lampirkan media terlebih dahulu.');
      err.code = 'EMPTY_CONTENT';
      throw err;
    }

    const job = scheduler.sanitizeJob({
      id: genId('job'),
      accountId,
      name: (b.name && b.name.trim()) || 'Jadwal tanpa nama',
      caption,
      mediaPath: filePath,
      mediaName: req.file ? req.file.originalname : null,
      mediaMime: req.file ? req.file.mimetype : null,
      groupIds,
      intervalMinutes: b.intervalMinutes,
      minSecond: b.minSecond,
      maxSecond: b.maxSecond,
      enabled: b.enabled === 'false' ? false : true,
      nextRunAt: null,
      lastRunAt: null,
      runCount: 0,
      lastResult: null,
    });

    store.upsertJob(job);
    if (job.enabled) scheduler.start(job);

    res.json({ ok: true, job });
  } catch (err) {
    removeFileSafe(filePath); // gagal validasi → buang file
    res.status(statusCodeFor(err)).json({ ok: false, error: err.message });
  }
});

// Perbarui jadwal. (multipart: media opsional)
app.put('/api/jobs/:id', upload.single('media'), (req, res) => {
  const newFilePath = req.file ? req.file.path : null;
  try {
    const job = store.getJob(req.params.id);
    if (!job) {
      const err = new Error('Jadwal tidak ditemukan.');
      err.code = 'NO_JOB';
      throw err;
    }
    const b = req.body;

    if (b.accountId && accountManager.get(b.accountId)) job.accountId = b.accountId;
    if (typeof b.name === 'string' && b.name.trim()) job.name = b.name.trim();
    if (typeof b.caption === 'string') job.caption = b.caption;
    if (b.groupIds !== undefined) {
      const groupIds = parseGroupIds(b.groupIds);
      if (groupIds.length === 0) {
        const err = new Error('Pilih minimal satu grup tujuan.');
        err.code = 'NO_GROUP';
        throw err;
      }
      job.groupIds = groupIds;
    }
    if (b.intervalMinutes !== undefined) job.intervalMinutes = b.intervalMinutes;
    if (b.minSecond !== undefined) job.minSecond = b.minSecond;
    if (b.maxSecond !== undefined) job.maxSecond = b.maxSecond;
    if (b.enabled !== undefined) job.enabled = !(b.enabled === 'false' || b.enabled === false);

    // Ganti media bila ada upload baru.
    if (newFilePath) {
      removeFileSafe(job.mediaPath);
      job.mediaPath = newFilePath;
      job.mediaName = req.file.originalname;
      job.mediaMime = req.file.mimetype;
    } else if (b.removeMedia === 'true') {
      removeFileSafe(job.mediaPath);
      job.mediaPath = null;
      job.mediaName = null;
      job.mediaMime = null;
    }

    if (!job.mediaPath && !(job.caption && job.caption.trim())) {
      const err = new Error('Isi teks atau lampirkan media terlebih dahulu.');
      err.code = 'EMPTY_CONTENT';
      throw err;
    }

    scheduler.sanitizeJob(job);
    store.upsertJob(job);

    // Jadwalkan ulang sesuai status enabled.
    if (job.enabled) scheduler.start(job);
    else scheduler.stop(job.id);

    res.json({ ok: true, job });
  } catch (err) {
    removeFileSafe(newFilePath);
    res.status(statusCodeFor(err)).json({ ok: false, error: err.message });
  }
});

// Aktif/nonaktifkan jadwal.
app.post('/api/jobs/:id/toggle', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Jadwal tidak ditemukan.' });
  job.enabled = req.body && typeof req.body.enabled === 'boolean' ? req.body.enabled : !job.enabled;
  store.upsertJob(job);
  if (job.enabled) scheduler.start(job);
  else {
    scheduler.stop(job.id);
    job.nextRunAt = null;
    store.upsertJob(job);
  }
  res.json({ ok: true, job });
});

// Jalankan jadwal sekarang (manual).
app.post('/api/jobs/:id/run', async (req, res) => {
  try {
    const summary = await scheduler.runNow(req.params.id);
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(statusCodeFor(err)).json({ ok: false, error: err.message });
  }
});

// Hapus jadwal.
app.delete('/api/jobs/:id', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Jadwal tidak ditemukan.' });
  scheduler.stop(job.id);
  removeFileSafe(job.mediaPath);
  store.removeJob(job.id);
  res.json({ ok: true });
});

// Info konfigurasi (batasan) untuk frontend.
app.get('/api/config', (req, res) => {
  res.json({ ok: true, schedule: config.schedule, allowedMime: config.allowedMime, maxUploadBytes: config.maxUploadBytes });
});

// ---- Error handler (multer dsb) ----
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || /Tipe file tidak didukung/.test(err.message)) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ ok: false, error: err.message });
});

// ---- Start ----
app.listen(config.port, () => {
  console.log(`\n  ✅ Panel Bot WhatsApp berjalan di: http://localhost:${config.port}\n`);
  // Pulihkan akun & jadwal yang tersimpan.
  accountManager.restoreAll();
  scheduler.restoreAll();
});
