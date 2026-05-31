# Panel Bot WhatsApp — Posting Grup Terjadwal (Multi-Akun)

Panel web untuk **memposting foto/video + teks custom ke grup WhatsApp secara terjadwal**.
Mendukung **banyak akun WhatsApp sekaligus**, **interval kirim 1–360 menit**, dan **trigger detik acak (13–55 detik)** agar pengiriman tidak selalu jatuh di detik `:00`.

Dibangun dengan **Node.js + Express + [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)**. UI bertema **putih–hijau** khas WhatsApp.

---

## ⚠️ Peringatan Penting

> Tool ini memakai **WhatsApp Web yang tidak resmi (unofficial)**. Mengirim pesan massal/spam dapat
> menyebabkan nomor Anda **diblokir oleh WhatsApp**.
>
> - Kirim **hanya ke grup milik Anda** atau yang mengizinkan.
> - Gunakan **interval wajar** dan biarkan fitur **trigger detik acak** aktif.
> - Patuhi [Ketentuan Layanan WhatsApp](https://www.whatsapp.com/legal/terms-of-service).
>
> **Risiko ditanggung pengguna.**

---

## ✨ Fitur

- 🔐 **Multi-akun** — tambah banyak akun, scan QR masing-masing, jalan bersamaan dalam satu proses.
- ⏰ **Penjadwalan** — interval **1–360 menit** per jadwal.
- 🎯 **Trigger detik acak 13–55** — waktu kirim digeser ke detik acak (anti pola `:00`).
- 🖼️ **Upload foto / video** + **caption custom** (emoji didukung).
- 👥 **Pilih banyak grup** sebagai tujuan per jadwal.
- 🔁 **Aktif/nonaktif**, **edit**, **hapus**, dan **kirim manual** ("Kirim Sekarang").
- 💾 **Persisten** — akun & jadwal tersimpan; otomatis dipulihkan saat server/PM2 restart.

---

## 📁 Struktur Project

```
whatsapp/
├── server.js                # Express server + REST API
├── config.js                # Konfigurasi (port, batas, interval, dll)
├── ecosystem.config.js      # Konfigurasi PM2
├── src/
│   ├── account-manager.js   # Manajemen multi-akun WhatsApp
│   ├── scheduler.js         # Penjadwal + trigger detik acak
│   └── store.js             # Persistensi data (data/db.json)
├── public/                  # Frontend panel (HTML/CSS/JS)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── uploads/                 # Media yang di-upload (dipakai jadwal)
└── data/                    # db.json (akun & jadwal) — dibuat otomatis
```

---

## 🚀 Instalasi di Ubuntu 22.04 (aaPanel + Node.js + PM2)

Diasumsikan **aaPanel, Node.js, dan PM2 sudah terpasang**.

### 1. Install dependensi sistem untuk Chromium

`whatsapp-web.js` menjalankan Chromium (via Puppeteer) untuk membuka WhatsApp Web. Library berikut wajib ada di server:

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates fonts-liberation libappindicator3-1 libasound2 \
  libatk-bridge2.0-0 libatk1.0-0 libcups2 libdbus-1-3 libdrm2 \
  libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 xdg-utils wget
```

> Di Ubuntu 24.04 paket `libasound2` bernama `libasound2t64`. Sesuaikan bila perlu.

### 2. Upload / clone project

Letakkan folder project di server, misalnya `/www/wwwroot/wa-panel`.

```bash
# contoh via git
cd /www/wwwroot
git clone <URL_REPO_ANDA> wa-panel
cd wa-panel
```

> Di aaPanel, Anda juga bisa membuat website lalu meng-upload file ke folder root-nya.

### 3. Install dependency Node.js

```bash
cd /www/wwwroot/wa-panel
npm install
```

Perintah ini sekaligus mengunduh Chromium untuk Puppeteer (butuh beberapa menit).

> **Opsi hemat ruang:** Jika ingin memakai Chromium sistem (bukan unduhan Puppeteer),
> install dulu: `sudo apt-get install -y chromium-browser`, lalu set environment
> `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` (lihat langkah PM2 di bawah).

### 4. Uji jalan manual (opsional)

```bash
npm start
```

Buka `http://IP_SERVER:3000`. Jika panel tampil, hentikan dengan `Ctrl+C` lalu lanjut ke PM2.

### 5. Jalankan dengan PM2

Project sudah menyertakan `ecosystem.config.js`:

```bash
cd /www/wwwroot/wa-panel
pm2 start ecosystem.config.js
pm2 save                 # simpan agar otomatis jalan saat reboot
pm2 startup              # ikuti instruksi yang ditampilkan (sekali saja)
```

Perintah PM2 berguna lainnya:

```bash
pm2 logs wa-panel        # lihat log (QR juga muncul di sini bila perlu)
pm2 restart wa-panel
pm2 stop wa-panel
pm2 delete wa-panel
```

> **Penting:** jalankan **1 instance** saja (mode `fork`). Jangan pakai mode cluster,
> karena sesi WhatsApp & timer jadwal disimpan di dalam satu proses.

#### Memakai Chromium sistem (opsional)

Edit `ecosystem.config.js`, aktifkan baris di blok `env`:

```js
env: {
  NODE_ENV: 'production',
  PORT: 3000,
  PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium-browser',
},
```

Lalu: `pm2 restart wa-panel --update-env`.

### 6. Reverse proxy + domain via aaPanel (disarankan)

Agar bisa diakses lewat domain (dan HTTPS):

1. Di aaPanel: **Website → Add site**, isi domain Anda (mis. `panel.domainku.com`).
2. Buka site tersebut → menu **Reverse proxy / Proxy** → **Add reverse proxy**:
   - **Target URL:** `http://127.0.0.1:3000`
   - **Send Domain:** `$host`
3. Simpan. aaPanel akan menulis konfigurasi Nginx-nya.
4. (Opsional) Aktifkan **SSL → Let's Encrypt** untuk HTTPS.

> Jika tidak pakai domain, cukup buka port `3000` di firewall aaPanel
> (**Security → tambah port 3000**) dan akses via `http://IP_SERVER:3000`.

---

## 📖 Cara Pakai Panel

1. **Tab "Akun"** → klik **Tambah Akun** (boleh beri nama). Tunggu **QR** muncul.
2. Di HP: **WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat**, lalu scan QR.
   Ulangi untuk akun lain bila perlu (multi-akun).
3. **Tab "Buat Jadwal"**:
   - Pilih **Akun Pengirim** (harus berstatus *Terhubung*).
   - Tulis **caption**, lampirkan **foto/video** (opsional).
   - Klik **Muat Grup**, lalu centang **grup tujuan**.
   - Atur **Interval (1–360 menit)** dan **Trigger Detik (13–55)**.
   - Klik **Simpan Jadwal**.
4. **Tab "Daftar Jadwal"**: pantau **waktu kirim berikutnya** & hasil, gunakan tombol
   **Kirim Sekarang**, **Edit**, **Hapus**, atau **switch** untuk aktif/nonaktif.

---

## ⚙️ Konfigurasi (Environment Variable)

| Variabel                     | Default     | Keterangan                                    |
| ---------------------------- | ----------- | --------------------------------------------- |
| `PORT`                       | `3000`      | Port server panel.                            |
| `UPLOAD_DIR`                 | `uploads`   | Folder media upload.                          |
| `DATA_DIR`                   | `data`      | Folder data (akun & jadwal).                  |
| `AUTH_DIR`                   | `.wwebjs_auth` | Folder sesi login WhatsApp.                |
| `MAX_UPLOAD_BYTES`           | `67108864`  | Batas ukuran file (byte). Default 64 MB.      |
| `SEND_DELAY_MS`              | `4000`      | Jeda antar pengiriman ke tiap grup (ms).      |
| `PUPPETEER_EXECUTABLE_PATH`  | *(kosong)*  | Path Chromium sistem (opsional).              |

Batasan interval (1–360 menit) & trigger detik (13–55) diatur di `config.js` pada bagian `schedule`.

---

## 🔌 Ringkasan API

| Method | Endpoint                       | Keterangan                              |
| ------ | ------------------------------ | --------------------------------------- |
| GET    | `/api/accounts`                | Daftar akun + status/QR.                |
| POST   | `/api/accounts`                | Tambah akun `{ label }`.                |
| POST   | `/api/accounts/:id/logout`     | Logout & minta QR baru.                 |
| DELETE | `/api/accounts/:id`            | Hapus akun + jadwalnya.                 |
| GET    | `/api/accounts/:id/groups`     | Daftar grup akun.                       |
| GET    | `/api/jobs`                    | Daftar jadwal.                          |
| POST   | `/api/jobs`                    | Buat jadwal (multipart).                |
| PUT    | `/api/jobs/:id`                | Edit jadwal (multipart).                |
| POST   | `/api/jobs/:id/toggle`         | Aktif/nonaktif.                         |
| POST   | `/api/jobs/:id/run`            | Kirim sekarang.                         |
| DELETE | `/api/jobs/:id`                | Hapus jadwal.                           |

---

## 🛠️ Troubleshooting

- **QR tidak muncul / Chromium gagal jalan**
  Pastikan dependensi sistem di langkah 1 terpasang. Cek log: `pm2 logs wa-panel`.
  Coba pakai Chromium sistem (`PUPPETEER_EXECUTABLE_PATH`).

- **Error `Failed to launch the browser process` / sandbox**
  Sudah ditangani lewat argumen `--no-sandbox` di `config.js`. Jika tetap gagal, jalankan
  sebagai user non-root atau pastikan `--no-sandbox` aktif.

- **Akun "Terputus" terus / sesi rusak**
  Logout dari panel, atau hapus folder sesi akun tersebut di `.wwebjs_auth/` lalu scan ulang.

- **Beberapa grup gagal terkirim**
  Naikkan `SEND_DELAY_MS` (mis. `8000`) agar pengiriman tidak terlalu cepat.

- **Panel tidak bisa diakses dari luar**
  Buka port di firewall aaPanel, atau gunakan reverse proxy + domain (langkah 6).

- **Penggunaan RAM tinggi (banyak akun)**
  Tiap akun menjalankan satu Chromium. Sediakan RAM cukup (≈300–500 MB per akun) atau
  naikkan `max_memory_restart` di `ecosystem.config.js`.

---

## 📄 Lisensi

MIT — lihat berkas [LICENSE](LICENSE).
