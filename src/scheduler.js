'use strict';

const config = require('../config');
const store = require('./store');
const accountManager = require('./account-manager');

/**
 * Penjadwal pengiriman post berulang.
 *
 * Setiap "job" akan dikirim setiap `intervalMinutes` menit. Agar pengiriman
 * tidak selalu jatuh tepat di detik :00, waktu eksekusi digeser ke detik acak
 * dalam rentang [minSecond, maxSecond] (default 13–55) — inilah "trigger second".
 */
class Scheduler {
  constructor() {
    this.timers = new Map(); // jobId -> Timeout handle
  }

  _randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** Bersihkan & validasi nilai job sesuai batasan config. */
  sanitizeJob(job) {
    const s = config.schedule;
    let interval = parseInt(job.intervalMinutes, 10);
    if (isNaN(interval)) interval = s.minIntervalMinutes;
    interval = Math.min(s.maxIntervalMinutes, Math.max(s.minIntervalMinutes, interval));

    let minSec = parseInt(job.minSecond, 10);
    let maxSec = parseInt(job.maxSecond, 10);
    if (isNaN(minSec)) minSec = s.minTriggerSecond;
    if (isNaN(maxSec)) maxSec = s.maxTriggerSecond;
    // Clamp ke rentang yang diizinkan.
    minSec = Math.min(s.maxTriggerSecond, Math.max(s.minTriggerSecond, minSec));
    maxSec = Math.min(s.maxTriggerSecond, Math.max(s.minTriggerSecond, maxSec));
    if (minSec > maxSec) [minSec, maxSec] = [maxSec, minSec];

    job.intervalMinutes = interval;
    job.minSecond = minSec;
    job.maxSecond = maxSec;
    return job;
  }

  /**
   * Hitung timestamp eksekusi berikutnya: sekarang + interval menit, lalu
   * detiknya digeser ke nilai acak dalam [minSecond, maxSecond].
   */
  computeNextRun(job) {
    const base = Date.now() + job.intervalMinutes * 60 * 1000;
    const d = new Date(base);
    const sec = this._randomInt(job.minSecond, job.maxSecond);
    d.setSeconds(sec, 0); // set detik acak, milidetik = 0
    let next = d.getTime();
    // Pastikan tidak di masa lalu (akibat pergeseran detik mundur).
    if (next <= Date.now()) next += 60 * 1000;
    return next;
  }

  /** Mulai / jadwalkan ulang sebuah job. */
  start(job) {
    this.stop(job.id);
    if (!job.enabled) return;

    this.sanitizeJob(job);
    const next = this.computeNextRun(job);
    job.nextRunAt = next;
    store.upsertJob(job);

    const delay = Math.max(1000, next - Date.now());
    const timer = setTimeout(() => this.fire(job.id), delay);
    // Jangan menahan proses keluar hanya karena timer (opsional).
    if (timer.unref) timer.unref();
    this.timers.set(job.id, timer);

    console.log(
      `[sched] Job "${job.name}" dijadwalkan: ${new Date(next).toLocaleString('id-ID')} ` +
        `(interval ${job.intervalMinutes} menit, detik ${job.minSecond}-${job.maxSecond}).`
    );
  }

  /** Hentikan timer sebuah job. */
  stop(jobId) {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }
  }

  /** Eksekusi pengiriman job, lalu jadwalkan siklus berikutnya. */
  async fire(jobId) {
    const job = store.getJob(jobId);
    if (!job) return;
    if (!job.enabled) return;

    console.log(`[sched] Menjalankan job "${job.name}"...`);
    await this._send(job);

    // Jadwalkan siklus berikutnya (job mungkin sudah diupdate di store).
    const fresh = store.getJob(jobId);
    if (fresh && fresh.enabled) this.start(fresh);
  }

  /** Jalankan job sekali sekarang (manual), tanpa mengubah jadwal berjalan. */
  async runNow(jobId) {
    const job = store.getJob(jobId);
    if (!job) {
      const err = new Error('Jadwal tidak ditemukan.');
      err.code = 'NO_JOB';
      throw err;
    }
    return this._send(job);
  }

  /** Inti pengiriman + pencatatan hasil. */
  async _send(job) {
    let summary;
    try {
      const results = await accountManager.sendToGroups(job.accountId, {
        groupIds: job.groupIds,
        caption: job.caption,
        filePath: job.mediaPath || null,
        fileName: job.mediaName || null,
      });
      const sent = results.filter((r) => r.ok).length;
      const failed = results.length - sent;
      summary = { at: Date.now(), sent, failed, results };
      console.log(`[sched] Job "${job.name}" selesai: ${sent} terkirim, ${failed} gagal.`);
    } catch (err) {
      summary = { at: Date.now(), error: err.message };
      console.error(`[sched] Job "${job.name}" gagal:`, err.message);
    }

    // Perbarui statistik job.
    const fresh = store.getJob(job.id) || job;
    fresh.lastRunAt = Date.now();
    fresh.runCount = (fresh.runCount || 0) + 1;
    fresh.lastResult = summary;
    store.upsertJob(fresh);
    return summary;
  }

  /** Muat ulang semua job dari store saat startup & jadwalkan yang aktif. */
  restoreAll() {
    const jobs = store.listJobs();
    let active = 0;
    for (const job of jobs) {
      if (job.enabled) {
        this.start(job);
        active++;
      }
    }
    console.log(`[sched] Memulihkan ${jobs.length} jadwal (${active} aktif).`);
  }
}

module.exports = new Scheduler();
