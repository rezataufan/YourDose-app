/**
 * Step 2: Manajemen Multi-Obat, Epoch Timestamp & State Persistence (Fixed & Hardened)
 * Terhubung ke Core Engine (dynamic_dose_scheduler.js) untuk mendukung:
 * 1. Kalkulasi Epoch Timestamp penuh (lintas hari otomatis tanpa flag manual).
 * 2. Banyak obat sekaligus dalam satu profil pasien dengan ID unik.
 * 3. Deteksi bentrok/kedekatan jadwal antar-obat (misal jeda < 15 menit).
 * 4. Simpan/muat state JSON lokal + dukungan Undo riwayat aksi.
 */

const scheduler =
  typeof require !== "undefined"
    ? require("./dynamic_dose_scheduler.js")
    : globalThis;

const {
  parseMenit,
  formatJam,
  hitungSleepCutoffMenit,
  tentukanAlarmMode,
  buatJadwalHarian,
  catatDosisDiminum,
  tanganiAutoSnooze
} = scheduler;

const STORE_VERSION = 1;
const MAX_HISTORY = 20;

// CHANGED: Temuan 1 - Validasi kalender ketat agar tanggal seperti 2026-02-30 tidak rollover
function toEpochMs(tanggalStr, hhmmStr) {
  if (typeof tanggalStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(tanggalStr)) {
    throw new Error(`Format tanggal tidak valid: "${tanggalStr}". Gunakan YYYY-MM-DD.`);
  }
  const menit = parseMenit(hhmmStr);
  const [tahun, bulan, hari] = tanggalStr.split("-").map(Number);
  const jam = Math.floor(menit / 60);
  const mnt = menit % 60;
  const epoch = Date.UTC(tahun, bulan - 1, hari, jam, mnt, 0, 0);

  const cek = new Date(epoch);
  if (cek.getUTCFullYear() !== tahun || cek.getUTCMonth() !== bulan - 1 || cek.getUTCDate() !== hari) {
    throw new Error(`Tanggal kalender tidak valid: "${tanggalStr}".`);
  }
  return epoch;
}

// Helper: Konversi base tanggal "YYYY-MM-DD" + offset menit relatif (bisa >= 1440) ke epoch ms
function baseTanggalDanMenitKeEpoch(tanggalStr, totalMenit) {
  const baseMidnightUtc = toEpochMs(tanggalStr, "00:00");
  return baseMidnightUtc + totalMenit * 60 * 1000;
}

// Helper: Format epochMs menjadi { tanggal: "YYYY-MM-DD", jam: "HH:mm" }
function formatEpoch(epochMs) {
  const d = new Date(epochMs);
  const tahun = d.getUTCFullYear();
  const bulan = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hari = String(d.getUTCDate()).padStart(2, "0");
  const jam = String(d.getUTCHours()).padStart(2, "0");
  const mnt = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    tanggal: `${tahun}-${bulan}-${hari}`,
    jam: `${jam}:${mnt}`,
    label: `${tahun}-${bulan}-${hari} ${jam}:${mnt}`
  };
}

function buatMedIdUnik() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MED-${ts}-${rand}`;
}

function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buatStore(tanggalAktif = "2026-11-16", wakeTimeAktual = "07:00") {
  toEpochMs(tanggalAktif, wakeTimeAktual);
  return {
    version: STORE_VERSION,
    tanggalAktif,
    wakeTimeAktual,
    meds: {},
    history: []
  };
}

function sinkronkanEpochJadwal(medState, tanggalBase) {
  medState.tanggalBase = tanggalBase;
  medState.jadwal = medState.jadwal.map((d) => ({
    ...d,
    scheduledEpochMs: baseTanggalDanMenitKeEpoch(tanggalBase, d.waktuTerjadwalMenit),
    takenEpochMs:
      d.waktuDiminumMenit !== null
        ? baseTanggalDanMenitKeEpoch(tanggalBase, d.waktuDiminumMenit)
        : null
  }));
  return medState;
}

function tambahObat(store, regimen, tanggalStr, actualWakeTime) {
  const nextStore = cloneDeep(store);
  const tgl = tanggalStr || nextStore.tanggalAktif;
  const wake = actualWakeTime || nextStore.wakeTimeAktual;

  const medId = regimen.id || buatMedIdUnik();
  if (nextStore.meds[medId]) {
    return {
      ok: false,
      errorCode: "DUPLICATE_MED_ID",
      pesan: `Obat dengan ID "${medId}" sudah terdaftar.`,
      store: nextStore
    };
  }

  const medState = buatJadwalHarian({ ...regimen, id: medId }, wake);
  sinkronkanEpochJadwal(medState, tgl);

  nextStore.meds[medId] = medState;
  return { ok: true, medId, store: nextStore };
}

function simpanSnapshotHistory(storeObj, labelAksi) {
  const snapshot = {
    labelAksi,
    timestamp: Date.now(),
    meds: cloneDeep(storeObj.meds)
  };
  storeObj.history.push(snapshot);
  if (storeObj.history.length > MAX_HISTORY) {
    storeObj.history.shift();
  }
}

/**
 * Mencatat dosis diminum menggunakan tanggal & jam aktual penuh (otomatis mendeteksi lintas hari).
 */
function catatMinumObat(store, medId, dosisKe, tanggalAktualStr, jamAktualStr, options = {}) {
  const nextStore = cloneDeep(store);
  const medState = nextStore.meds[medId];

  if (!medState) {
    return { ok: false, errorCode: "MED_NOT_FOUND", pesan: `Obat "${medId}" tidak ditemukan.`, store: nextStore };
  }

  const epochTglAktual = toEpochMs(tanggalAktualStr, "00:00");
  const epochAktual = toEpochMs(tanggalAktualStr, jamAktualStr);
  const epochBase = toEpochMs(medState.tanggalBase, "00:00");
  const selisihHari = Math.round((epochTglAktual - epochBase) / (1440 * 60 * 1000));

  // ADDED: Temuan 2 - Tolak tanggal mundur sebelum tanggalBase
  if (selisihHari < 0) {
    return {
      ok: false,
      errorCode: "DATE_BEFORE_BASE",
      pesan: `Tanggal minum (${tanggalAktualStr}) lebih awal dari tanggal mulai jadwal (${medState.tanggalBase}).`,
      store: nextStore
    };
  }

  // ADDED: Temuan 2 - Validasi jarak minimum berbasis Epoch penuh jika lintas hari (selisihHari >= 1)
  let bypassStep1Gap = false;
  if (selisihHari >= 1) {
    const idxTarget = medState.jadwal.findIndex((d) => d.dosisKe === dosisKe);
    const prevTaken = idxTarget > 0
      ? [...medState.jadwal].slice(0, idxTarget).reverse().find((d) => d.status === "TAKEN" && d.takenEpochMs !== null)
      : null;

    if (prevTaken) {
      const gapMenitEpoch = Math.round((epochAktual - prevTaken.takenEpochMs) / 60000);
      if (gapMenitEpoch < 0) {
        return {
          ok: false,
          errorCode: "INVALID_TIME_ORDER",
          pesan: `Waktu minum (${tanggalAktualStr} ${jamAktualStr}) lebih awal dari dosis ke-${prevTaken.dosisKe}.`,
          store: nextStore
        };
      }
      const minGap = medState.regimen.minGapMenit || 0;
      if (minGap > 0 && gapMenitEpoch < minGap && !options.forceOverride) {
        return {
          ok: false,
          errorCode: "MIN_GAP_VIOLATION",
          selisihMenit: gapMenitEpoch,
          minGapMenit: minGap,
          pesan: `Ditolak: jarak dari dosis ke-${prevTaken.dosisKe} baru ${gapMenitEpoch} menit (batas aman minimum ${minGap} menit).`,
          store: nextStore
        };
      }
      bypassStep1Gap = true;
    }
  }

  const hasil = catatDosisDiminum(medState, dosisKe, jamAktualStr, {
    ...options,
    lintasTengahMalam: selisihHari >= 1,
    forceOverride: options.forceOverride || bypassStep1Gap
  });

  if (!hasil.ok) {
    return { ...hasil, store: nextStore };
  }

  // ADDED: Temuan 2 - Pastikan waktuDiminumMenit & sisa dosis memakai offset selisihHari * 1440
  if (selisihHari >= 1) {
    const idx = hasil.state.jadwal.findIndex((d) => d.dosisKe === dosisKe);
    const menitAbsolutPenuh = selisihHari * 1440 + parseMenit(jamAktualStr);
    if (!options.forceOverride && bypassStep1Gap) {
      hasil.state.jadwal[idx].catatan = "";
    }
    if (hasil.state.jadwal[idx].waktuDiminumMenit !== menitAbsolutPenuh) {
      hasil.state.jadwal[idx].waktuDiminumMenit = menitAbsolutPenuh;
      hasil.state.jadwal[idx].waktuDiminum = formatJam(menitAbsolutPenuh);
      const sleepCutoffMenit = hitungSleepCutoffMenit(hasil.state.regimen);
      let langkah = 1;
      for (let i = idx + 1; i < hasil.state.jadwal.length; i++) {
        const waktuBaru = menitAbsolutPenuh + langkah * hasil.state.regimen.intervalMenit;
        const lewatTidur = waktuBaru > sleepCutoffMenit;
        const ditundaTidur = lewatTidur && !hasil.state.regimen.strictInterval;
        hasil.state.jadwal[i].waktuTerjadwalMenit = waktuBaru;
        hasil.state.jadwal[i].waktuTerjadwal = formatJam(waktuBaru);
        hasil.state.jadwal[i].status = ditundaTidur ? "DEFERRED_SLEEP" : "PENDING";
        hasil.state.jadwal[i].alarmMode = ditundaTidur ? "MUTED" : tentukanAlarmMode(hasil.state.regimen, lewatTidur);
        langkah++;
      }
    }
  }

  simpanSnapshotHistory(nextStore, `Minum ${medState.regimen.namaObat} dosis #${dosisKe}`);
  nextStore.meds[medId] = sinkronkanEpochJadwal(hasil.state, medState.tanggalBase);

  return { ok: true, store: nextStore, selisihHari };
}

/**
 * Menangani Auto-Snooze untuk obat tertentu di dalam store.
 */
function snoozeObat(store, medId, dosisKe, jamAlarmStr) {
  const nextStore = cloneDeep(store);
  const medState = nextStore.meds[medId];

  if (!medState) {
    return { ok: false, errorCode: "MED_NOT_FOUND", pesan: `Obat "${medId}" tidak ditemukan.`, store: nextStore };
  }

  // ADDED: Temuan 3 - Cek status dosis sebelum menyimpan snapshot history
  const targetDosis = medState.jadwal.find((d) => d.dosisKe === dosisKe);
  if (
    !targetDosis ||
    targetDosis.status === "TAKEN" ||
    targetDosis.status === "DEFERRED_SLEEP" ||
    targetDosis.status === "MISSED"
  ) {
    return {
      ok: false,
      errorCode: "CANNOT_SNOOZE",
      pesan: `Dosis #${dosisKe} tidak dapat di-snooze (status: ${targetDosis ? targetDosis.status : "NOT_FOUND"}).`,
      store: nextStore
    };
  }

  simpanSnapshotHistory(nextStore, `Snooze ${medState.regimen.namaObat} dosis #${dosisKe}`);
  const updatedMed = tanganiAutoSnooze(medState, dosisKe, jamAlarmStr);
  nextStore.meds[medId] = sinkronkanEpochJadwal(updatedMed, medState.tanggalBase);

  return { ok: true, store: nextStore };
}

function undoTerakhir(store) {
  const nextStore = cloneDeep(store);
  if (!nextStore.history || nextStore.history.length === 0) {
    return { ok: false, errorCode: "NOTHING_TO_UNDO", pesan: "Tidak ada riwayat untuk dibatalkan.", store: nextStore };
  }
  const last = nextStore.history.pop();
  nextStore.meds = last.meds;
  return { ok: true, undoneAction: last.labelAksi, store: nextStore };
}

function ambilAntreanJadwal(store) {
  const antrean = [];
  for (const [medId, medState] of Object.entries(store.meds)) {
    for (const d of medState.jadwal) {
      if (d.status === "PENDING" || d.status === "SNOOZED") {
        antrean.push({
          medId,
          namaObat: medState.regimen.namaObat,
          dosisKe: d.dosisKe,
          scheduledEpochMs: d.scheduledEpochMs,
          waktuLabel: formatEpoch(d.scheduledEpochMs).label,
          status: d.status,
          alarmMode: d.alarmMode
        });
      }
    }
  }
  return antrean.sort((a, b) => a.scheduledEpochMs - b.scheduledEpochMs);
}

function deteksiBentrokJadwal(store, windowMenit = 15) {
  const antrean = ambilAntreanJadwal(store);
  const windowMs = windowMenit * 60 * 1000;
  const bentrok = [];

  for (let i = 0; i < antrean.length; i++) {
    for (let j = i + 1; j < antrean.length; j++) {
      const a = antrean[i];
      const b = antrean[j];
      const diffMs = b.scheduledEpochMs - a.scheduledEpochMs;
      if (diffMs > windowMs) break;

      if (a.medId !== b.medId) {
        bentrok.push({
          obatA: `${a.namaObat} (Dosis #${a.dosisKe})`,
          obatB: `${b.namaObat} (Dosis #${b.dosisKe})`,
          selisihMenit: Math.round(diffMs / 60000),
          waktuA: a.waktuLabel,
          waktuB: b.waktuLabel
        });
      }
    }
  }
  return bentrok;
}

function eksporStoreJSON(store) {
  return JSON.stringify(store);
}

// CHANGED: Temuan 4 - Validasi skema ketat untuk meds (bukan null/array) dan history (array)
function imporStoreJSON(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new Error("Data JSON store rusak atau tidak dapat dibaca.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.version !== STORE_VERSION ||
    !parsed.meds ||
    typeof parsed.meds !== "object" ||
    Array.isArray(parsed.meds) ||
    !Array.isArray(parsed.history)
  ) {
    throw new Error("Skema atau versi store tidak kompatibel.");
  }
  return parsed;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    toEpochMs,
    formatEpoch,
    buatStore,
    tambahObat,
    catatMinumObat,
    snoozeObat,
    undoTerakhir,
    ambilAntreanJadwal,
    deteksiBentrokJadwal,
    eksporStoreJSON,
    imporStoreJSON
  };
}
