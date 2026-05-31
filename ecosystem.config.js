// Konfigurasi PM2 untuk menjalankan panel di Ubuntu (aaPanel).
// Jalankan dengan: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'wa-panel',
      script: 'server.js',
      cwd: __dirname,
      instances: 1, // WAJIB 1 — multi-akun ditangani di dalam proses, jangan di-cluster
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '800M',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Aktifkan baris di bawah bila memakai Chromium bawaan sistem:
        // PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium-browser',
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
