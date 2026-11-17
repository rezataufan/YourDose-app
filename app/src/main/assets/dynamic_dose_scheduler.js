/**
 * Prototipe Mesin Penjadwalan Obat Dynamic-Interval (Step 1: Fixed & Hardened Core Engine)
 * Menguji 5 skenario inti + proteksi input, double-tap, lintas tengah malam, shift malam, & immutability.
 */

// Helper: Konversi "HH:mm" ke total menit sejak 00:00
function parseMenit(hhmm) {
  if (typeof hhmm !== "string" || !/^\d{2}:\d{2}$/.test(hhmm)) {
    throw new Error(`Format jam tidak valid: "${hhmm}". Gunakan format HH:mm.`);
  }
  const [jam, menit] = hhmm.split(":").map(Number);
  if (jam < 0 || jam > 23 || menit < 0 || menit > 59) {
    throw new Error(`Nilai jam/menit di luar batas: "${hhmm}".`);
  }
  return jam * 60 + menit;
}

// Helper: Konversi total menit ke format "HH:mm" (mendukung lewat tengah malam)
function formatJam(totalMenit) {
  const norm = ((totalMenit % 1440) + 1440) % 1440;
  const jam = String(Math.floor(norm / 60)).padStart(2, "0");
  const menit = String(norm % 60).padStart(2, "0");
  const hariBerikutnya = totalMenit >= 1440 ? " (+1 hari)" : "";
  return `${jam}:${menit}${hariBerikutnya}`;
}

// ADDED: Temuan 2 - Hitung sleepCutoffMenit dengan dukungan jam tidur lewat tengah malam (misal "00:30")
function hitungSleepCutoffMenit(regimen) {
  const targetPagi = parseMenit(regimen.earliestWakeTime);
  let cutoff = parseMenit(regimen.sleepCutoffTime);
  if (cutoff <= targetPagi) {
    cutoff += 1440;
  }
  return cutoff;
}

// ADDED: Temuan 5 - Deep clone state agar fungsi murni (immutable) dan aman untuk Undo
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function tentukanAlarmMode(regimen, lewatTidur) {
  if (regimen.strictInterval) {
    return lewatTidur ? "FORCE_SOUND" : "NORMAL";
  }
  return regimen.silentVibrationOnly ? "VIBRATE_WORK" : "NORMAL";
}

/**
 * Inisialisasi jadwal harian berdasarkan aturan obat dan jam bangun aktual.
 */
function buatJadwalHarian(regimen, actualWakeTime) {
  if (!regimen || !regimen.dosisPerHari || regimen.dosisPerHari < 1) {
    throw new Error("Regimen harus memiliki dosisPerHari >= 1.");
  }
  if (!regimen.intervalMenit || regimen.intervalMenit < 15) {
    throw new Error("intervalMenit minimal 15 menit.");
  }
  // ADDED: Temuan 3 - Validasi lengkap minGapMenit, autoSnoozeMenit, dan maxSnoozeCount
  if (regimen.minGapMenit !== undefined && (regimen.minGapMenit < 0 || regimen.minGapMenit > regimen.intervalMenit)) {
    throw new Error("minGapMenit harus antara 0 dan intervalMenit.");
  }
  if (!regimen.autoSnoozeMenit || regimen.autoSnoozeMenit < 1) {
    throw new Error("autoSnoozeMenit minimal 1 menit.");
  }
  if (regimen.maxSnoozeCount === undefined || regimen.maxSnoozeCount < 0) {
    throw new Error("maxSnoozeCount minimal 0.");
  }

  const targetPagi = parseMenit(regimen.earliestWakeTime);
  const bangunAktual = parseMenit(actualWakeTime);

  // Wake-up trigger: pilih yang paling akhir agar tidak membangunkan pengguna
  const dosisPertamaMenit = Math.max(targetPagi, bangunAktual);
  const sleepCutoffMenit = hitungSleepCutoffMenit(regimen); // CHANGED: Temuan 2

  const jadwal = [];
  for (let i = 0; i < regimen.dosisPerHari; i++) {
    const waktuMenit = dosisPertamaMenit + i * regimen.intervalMenit;
    const lewatTidur = waktuMenit > sleepCutoffMenit;
    const ditundaTidur = lewatTidur && !regimen.strictInterval;

    jadwal.push({
      dosisKe: i + 1,
      waktuTerjadwalMenit: waktuMenit,
      waktuTerjadwal: formatJam(waktuMenit),
      status: ditundaTidur ? "DEFERRED_SLEEP" : "PENDING",
      alarmMode: ditundaTidur ? "MUTED" : tentukanAlarmMode(regimen, lewatTidur),
      snoozeCount: 0,
      waktuDiminum: null,
      waktuDiminumMenit: null,
      catatan: ditundaTidur
        ? "Melewati batas jam tidur"
        : lewatTidur && regimen.strictInterval
          ? "Mode Strict: tetap bunyi meski jam tidur"
          : ""
    });
  }

  return {
    regimen: cloneState(regimen), // CHANGED: Temuan 5
    dosisPertamaTrigger: bangunAktual > targetPagi ? "WAKE_UP_TRIGGER" : "TARGET_TIME",
    jadwal
  };
}

/**
 * Menandai dosis tertentu telah diminum pada jam aktual,
 * memvalidasi duplikasi & jarak minimum antar-dosis, lalu menggeser sisa dosis berikutnya.
 */
function catatDosisDiminum(state, dosisKe, waktuAktualMinumStr, options = {}) {
  const nextState = cloneState(state); // ADDED: Temuan 5 - Hindari mutasi in-place
  let waktuAktualAbsolut = parseMenit(waktuAktualMinumStr); // CHANGED: Temuan 1
  const sleepCutoffMenit = hitungSleepCutoffMenit(nextState.regimen); // CHANGED: Temuan 2
  const index = nextState.jadwal.findIndex((d) => d.dosisKe === dosisKe);

  if (index === -1) {
    return { ok: false, errorCode: "DOSE_NOT_FOUND", pesan: `Dosis ke-${dosisKe} tidak ditemukan.`, state: nextState };
  }

  if (nextState.jadwal[index].status === "TAKEN") {
    return {
      ok: false,
      errorCode: "ALREADY_TAKEN",
      pesan: `Dosis ke-${dosisKe} sudah tercatat diminum pada ${nextState.jadwal[index].waktuDiminum}.`,
      state: nextState
    };
  }

  const dosisSebelumnya = [...nextState.jadwal]
    .slice(0, index)
    .reverse()
    .find((d) => d.status === "TAKEN" && d.waktuDiminumMenit !== null);

  if (dosisSebelumnya) {
    // CHANGED: Temuan 1 - Sesuaikan waktuAktualAbsolut jika lintas tengah malam
    if (waktuAktualAbsolut < dosisSebelumnya.waktuDiminumMenit && options.lintasTengahMalam) {
      waktuAktualAbsolut += 1440;
    }

    const selisihMenit = waktuAktualAbsolut - dosisSebelumnya.waktuDiminumMenit;

    if (selisihMenit < 0) {
      return {
        ok: false,
        errorCode: "INVALID_TIME_ORDER",
        pesan: `Jam minum (${waktuAktualMinumStr}) lebih awal dari dosis ke-${dosisSebelumnya.dosisKe} (${dosisSebelumnya.waktuDiminum}).`,
        state: nextState
      };
    }

    const minGap = nextState.regimen.minGapMenit || 0;
    if (minGap > 0 && selisihMenit < minGap && !options.forceOverride) {
      return {
        ok: false,
        errorCode: "MIN_GAP_VIOLATION",
        selisihMenit,
        minGapMenit: minGap,
        pesan: `Ditolak: jarak dari dosis ke-${dosisSebelumnya.dosisKe} baru ${selisihMenit} menit (batas aman minimum ${minGap} menit).`,
        state: nextState
      };
    }
  }

  // Update dosis yang baru diminum
  nextState.jadwal[index].status = "TAKEN";
  nextState.jadwal[index].waktuDiminum = formatJam(waktuAktualAbsolut); // CHANGED: Temuan 1 - tampilkan (+1 hari) jika lewat tengah malam
  nextState.jadwal[index].waktuDiminumMenit = waktuAktualAbsolut; // CHANGED: Temuan 1 - simpan menit absolut
  nextState.jadwal[index].snoozeCount = 0;
  if (options.forceOverride) {
    nextState.jadwal[index].catatan = "Override batas minimum oleh pengguna";
  }

  // Hitung ulang semua dosis setelahnya relatif terhadap waktuAktualAbsolut
  let langkah = 1;
  for (let i = index + 1; i < nextState.jadwal.length; i++) {
    const waktuBaru = waktuAktualAbsolut + langkah * nextState.regimen.intervalMenit; // CHANGED: Temuan 1
    const lewatTidur = waktuBaru > sleepCutoffMenit;
    const ditundaTidur = lewatTidur && !nextState.regimen.strictInterval;

    nextState.jadwal[i].waktuTerjadwalMenit = waktuBaru;
    nextState.jadwal[i].waktuTerjadwal = formatJam(waktuBaru);
    nextState.jadwal[i].snoozeCount = 0;

    if (ditundaTidur) {
      nextState.jadwal[i].status = "DEFERRED_SLEEP";
      nextState.jadwal[i].alarmMode = "MUTED";
      nextState.jadwal[i].catatan = "Tergeser melewati batas jam tidur";
    } else {
      nextState.jadwal[i].status = "PENDING";
      nextState.jadwal[i].alarmMode = tentukanAlarmMode(nextState.regimen, lewatTidur);
      nextState.jadwal[i].catatan = lewatTidur
        ? "Mode Strict: tetap bunyi meski jam tidur"
        : "Digeser dinamis";
    }
    langkah++;
  }

  return { ok: true, state: nextState };
}

/**
 * Menangani alarm yang tidak direspons -> Auto-Snooze, DEFERRED_SLEEP, atau Missed.
 */
function tanganiAutoSnooze(state, dosisKe, waktuAlarmStr) {
  const nextState = cloneState(state); // ADDED: Temuan 5 - Hindari mutasi in-place
  const item = nextState.jadwal.find((d) => d.dosisKe === dosisKe);

  // CHANGED: Temuan 4 - Tambah guard status MISSED
  if (!item || item.status === "TAKEN" || item.status === "DEFERRED_SLEEP" || item.status === "MISSED") {
    return nextState;
  }

  let waktuAlarmMenit = parseMenit(waktuAlarmStr);
  // ADDED: Jika jadwal sudah berada di hari berikutnya (>= 1440), sesuaikan waktuAlarmMenit
  if (item.waktuTerjadwalMenit >= 1440 && waktuAlarmMenit < 1440) {
    waktuAlarmMenit += 1440;
  }

  const sleepCutoffMenit = hitungSleepCutoffMenit(nextState.regimen); // ADDED: Temuan 2 & 4

  if (item.snoozeCount < nextState.regimen.maxSnoozeCount) {
    const waktuSnoozeBaru = waktuAlarmMenit + nextState.regimen.autoSnoozeMenit;

    // ADDED: Temuan 4 - Jika non-strict dan snooze melewati jam tidur, tunda tidur
    if (waktuSnoozeBaru > sleepCutoffMenit && !nextState.regimen.strictInterval) {
      item.waktuTerjadwalMenit = waktuSnoozeBaru;
      item.waktuTerjadwal = formatJam(waktuSnoozeBaru);
      item.status = "DEFERRED_SLEEP";
      item.alarmMode = "MUTED";
      item.catatan = "Snooze melewati batas jam tidur";
    } else {
      item.snoozeCount += 1;
      item.waktuTerjadwalMenit = waktuSnoozeBaru;
      item.waktuTerjadwal = formatJam(waktuSnoozeBaru);
      item.status = "SNOOZED";
      item.alarmMode = tentukanAlarmMode(nextState.regimen, waktuSnoozeBaru > sleepCutoffMenit);
      item.catatan = `Auto-snooze #${item.snoozeCount} (+${nextState.regimen.autoSnoozeMenit} mnt)`;
    }
  } else {
    item.status = "MISSED";
    item.catatan = `Terlewat setelah ${nextState.regimen.maxSnoozeCount}x snooze`;
  }

  return nextState;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseMenit,
    formatJam,
    hitungSleepCutoffMenit,
    tentukanAlarmMode,
    buatJadwalHarian,
    catatDosisDiminum,
    tanganiAutoSnooze
  };
}