'use strict';

const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const config = require('../config');
const store = require('./store');

/**
 * Representasi satu akun WhatsApp beserta runtime state-nya.
 */
class Account {
  constructor(id, label) {
    this.id = id;
    this.label = label;
    this.client = null;
    this.state = 'uninitialized'; // uninitialized|initializing|qr|authenticated|ready|disconnected|auth_failure
    this.qrDataUrl = null;
    this.me = null; // { name, number }
    this.lastError = null;
  }

  toMeta() {
    return { id: this.id, label: this.label };
  }

  toStatus() {
    return {
      id: this.id,
      label: this.label,
      state: this.state,
      qr: this.state === 'qr' ? this.qrDataUrl : null,
      me: this.me,
      error: this.lastError,
    };
  }
}

/**
 * Mengelola banyak akun WhatsApp sekaligus dalam satu proses.
 */
class AccountManager {
  constructor() {
    this.accounts = new Map(); // id -> Account
  }

  /** Muat ulang akun yang tersimpan dari store, lalu inisialisasi sesinya. */
  restoreAll() {
    const metas = store.listAccounts();
    for (const meta of metas) {
      if (!this.accounts.has(meta.id)) {
        const acc = new Account(meta.id, meta.label);
        this.accounts.set(meta.id, acc);
        this._initClient(acc);
      }
    }
    console.log(`[am] Memulihkan ${metas.length} akun tersimpan.`);
  }

  list() {
    return [...this.accounts.values()];
  }

  get(id) {
    return this.accounts.get(id);
  }

  /** Tambah akun baru dan langsung inisialisasi (memunculkan QR). */
  add(label) {
    const id = 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const acc = new Account(id, label && label.trim() ? label.trim() : `Akun ${this.accounts.size + 1}`);
    this.accounts.set(id, acc);
    store.upsertAccount(acc.toMeta());
    this._initClient(acc);
    return acc;
  }

  /** Ubah label akun. */
  rename(id, label) {
    const acc = this.accounts.get(id);
    if (!acc) return null;
    acc.label = label && label.trim() ? label.trim() : acc.label;
    store.upsertAccount(acc.toMeta());
    return acc;
  }

  _initClient(acc) {
    if (acc.client) return;

    acc.state = 'initializing';
    acc.lastError = null;
    acc.qrDataUrl = null;

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: acc.id, dataPath: config.authDir }),
      puppeteer: config.puppeteer,
    });
    acc.client = client;

    client.on('qr', async (qr) => {
      try {
        acc.qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 300 });
        acc.state = 'qr';
        console.log(`[am:${acc.label}] QR diterima.`);
      } catch (err) {
        console.error(`[am:${acc.label}] Gagal membuat QR:`, err.message);
      }
    });

    client.on('authenticated', () => {
      acc.state = 'authenticated';
      acc.qrDataUrl = null;
    });

    client.on('auth_failure', (msg) => {
      acc.state = 'auth_failure';
      acc.lastError = msg;
      console.error(`[am:${acc.label}] Autentikasi gagal:`, msg);
    });

    client.on('ready', () => {
      acc.state = 'ready';
      acc.qrDataUrl = null;
      const info = client.info;
      acc.me = info ? { name: info.pushname, number: info.wid && info.wid.user } : null;
      console.log(`[am:${acc.label}] Siap. Login sebagai:`, acc.me);
    });

    client.on('disconnected', (reason) => {
      acc.state = 'disconnected';
      acc.lastError = reason;
      acc.me = null;
      console.warn(`[am:${acc.label}] Terputus:`, reason);
    });

    client.initialize().catch((err) => {
      acc.state = 'auth_failure';
      acc.lastError = err.message;
      console.error(`[am:${acc.label}] Gagal inisialisasi:`, err.message);
    });
  }

  /** Logout akun & reset sesi, lalu inisialisasi ulang agar muncul QR baru. */
  async logout(id) {
    const acc = this.accounts.get(id);
    if (!acc) return;
    if (acc.client) {
      try {
        await acc.client.logout();
      } catch (err) {
        console.warn(`[am:${acc.label}] Error logout:`, err.message);
      }
      try {
        await acc.client.destroy();
      } catch (err) {
        console.warn(`[am:${acc.label}] Error destroy:`, err.message);
      }
    }
    acc.client = null;
    acc.me = null;
    acc.qrDataUrl = null;
    acc.state = 'uninitialized';
    this._initClient(acc);
  }

  /** Hapus akun sepenuhnya (termasuk sesi tersimpan & jadwalnya di store). */
  async remove(id) {
    const acc = this.accounts.get(id);
    if (!acc) return;
    if (acc.client) {
      try {
        await acc.client.destroy();
      } catch (err) {
        console.warn(`[am:${acc.label}] Error destroy saat hapus:`, err.message);
      }
    }
    this.accounts.delete(id);
    store.removeAccount(id); // ikut menghapus jadwal milik akun ini

    // Hapus folder sesi LocalAuth milik akun ini.
    try {
      const sessionDir = path.resolve(__dirname, '..', config.authDir, `session-${id}`);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('[am] Gagal hapus folder sesi:', err.message);
    }
  }

  _assertReady(acc) {
    if (!acc) {
      const err = new Error('Akun tidak ditemukan.');
      err.code = 'NO_ACCOUNT';
      throw err;
    }
    if (acc.state !== 'ready' || !acc.client) {
      const err = new Error(`Akun "${acc.label}" belum siap. Scan QR terlebih dahulu.`);
      err.code = 'NOT_READY';
      throw err;
    }
  }

  /** Ambil daftar grup untuk satu akun. */
  async getGroups(id) {
    const acc = this.accounts.get(id);
    this._assertReady(acc);
    const chats = await acc.client.getChats();
    return chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({
        id: chat.id._serialized,
        name: chat.name || '(tanpa nama)',
        participants: Array.isArray(chat.participants) ? chat.participants.length : undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Kirim pesan ke beberapa grup dari satu akun, dengan jeda antar pengiriman.
   * @returns {Promise<Array<{groupId,ok,error?}>>}
   */
  async sendToGroups(id, { groupIds, caption, filePath, fileName }, onProgress) {
    const acc = this.accounts.get(id);
    this._assertReady(acc);

    if (!Array.isArray(groupIds) || groupIds.length === 0) {
      const err = new Error('Pilih minimal satu grup tujuan.');
      err.code = 'NO_GROUP';
      throw err;
    }
    if (!filePath && !(caption && caption.trim())) {
      const err = new Error('Isi teks atau lampirkan media terlebih dahulu.');
      err.code = 'EMPTY_CONTENT';
      throw err;
    }

    let media = null;
    if (filePath) {
      if (!fs.existsSync(filePath)) {
        const err = new Error('File media tidak ditemukan (mungkin sudah terhapus).');
        err.code = 'MEDIA_MISSING';
        throw err;
      }
      media = MessageMedia.fromFilePath(filePath);
      if (fileName) media.filename = fileName;
    }

    const results = [];
    for (let i = 0; i < groupIds.length; i++) {
      const groupId = groupIds[i];
      try {
        if (media) {
          await acc.client.sendMessage(groupId, media, {
            caption: caption && caption.trim() ? caption : undefined,
          });
        } else {
          await acc.client.sendMessage(groupId, caption);
        }
        const result = { groupId, ok: true };
        results.push(result);
        if (onProgress) onProgress(result);
      } catch (err) {
        const result = { groupId, ok: false, error: err.message };
        results.push(result);
        if (onProgress) onProgress(result);
      }

      if (i < groupIds.length - 1 && config.sendDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.sendDelayMs));
      }
    }
    return results;
  }
}

module.exports = new AccountManager();
