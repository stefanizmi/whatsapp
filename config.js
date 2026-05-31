'use strict';

/**
 * Konfigurasi aplikasi panel bot WhatsApp (multi-akun + penjadwalan).
 * Nilai dapat dioverride lewat environment variable.
 */
module.exports = {
  // Port server panel
  port: parseInt(process.env.PORT || '3000', 10),

  // Folder penyimpanan file media yang di-upload (dipakai ulang oleh jadwal)
  uploadDir: process.env.UPLOAD_DIR || 'uploads',

  // Folder penyimpanan data (akun & jadwal) dalam bentuk JSON
  dataDir: process.env.DATA_DIR || 'data',

  // Folder sesi login WhatsApp (LocalAuth)
  authDir: process.env.AUTH_DIR || '.wwebjs_auth',

  // Batas ukuran file upload (dalam byte). Default 64 MB.
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || `${64 * 1024 * 1024}`, 10),

  // Jeda antar pengiriman ke grup (ms) untuk menghindari rate-limit / dianggap spam.
  sendDelayMs: parseInt(process.env.SEND_DELAY_MS || '4000', 10),

  // Batasan penjadwalan (sesuai kebutuhan).
  schedule: {
    minIntervalMinutes: 1,    // interval minimum
    maxIntervalMinutes: 360,  // interval maksimum
    minTriggerSecond: 13,     // trigger detik minimum (tidak boleh 00)
    maxTriggerSecond: 55,     // trigger detik maksimum
  },

  // Tipe MIME yang diizinkan untuk diupload (foto & video umum).
  allowedMime: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/3gpp',
    'video/quicktime',
  ],

  // Opsi puppeteer untuk whatsapp-web.js.
  // headless true agar berjalan tanpa GUI di server (VPS/aaPanel).
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
    // Jika ingin memakai Chromium sistem (mis. di Ubuntu aaPanel), set env
    // PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  },
};
