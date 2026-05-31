'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Penyimpanan data sederhana berbasis file JSON.
 * Menyimpan metadata akun (id, label) dan jadwal (jobs) ke data/db.json.
 *
 * Catatan: sesi login WhatsApp TIDAK disimpan di sini — itu ditangani oleh
 * LocalAuth (whatsapp-web.js) di folder .wwebjs_auth.
 */
class Store {
  constructor() {
    this.dataDir = path.resolve(__dirname, '..', config.dataDir);
    this.dbFile = path.join(this.dataDir, 'db.json');
    this.data = { accounts: [], jobs: [] };
    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf8');
        this.data = JSON.parse(raw);
      }
    } catch (err) {
      console.error('[store] Gagal membaca db.json, memakai data kosong:', err.message);
      this.data = { accounts: [], jobs: [] };
    }
    if (!Array.isArray(this.data.accounts)) this.data.accounts = [];
    if (!Array.isArray(this.data.jobs)) this.data.jobs = [];
  }

  _save() {
    try {
      const tmp = this.dbFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.dbFile); // tulis atomik
    } catch (err) {
      console.error('[store] Gagal menyimpan db.json:', err.message);
    }
  }

  // ---------- Accounts (metadata) ----------
  listAccounts() {
    return this.data.accounts.slice();
  }

  upsertAccount(meta) {
    const idx = this.data.accounts.findIndex((a) => a.id === meta.id);
    if (idx >= 0) this.data.accounts[idx] = { ...this.data.accounts[idx], ...meta };
    else this.data.accounts.push(meta);
    this._save();
    return meta;
  }

  removeAccount(id) {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    // Hapus juga semua jadwal milik akun ini.
    this.data.jobs = this.data.jobs.filter((j) => j.accountId !== id);
    this._save();
  }

  // ---------- Jobs (jadwal) ----------
  listJobs() {
    return this.data.jobs.slice();
  }

  listJobsByAccount(accountId) {
    return this.data.jobs.filter((j) => j.accountId === accountId);
  }

  getJob(id) {
    return this.data.jobs.find((j) => j.id === id) || null;
  }

  upsertJob(job) {
    const idx = this.data.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) this.data.jobs[idx] = job;
    else this.data.jobs.push(job);
    this._save();
    return job;
  }

  removeJob(id) {
    const job = this.getJob(id);
    this.data.jobs = this.data.jobs.filter((j) => j.id !== id);
    this._save();
    return job;
  }
}

module.exports = new Store();
