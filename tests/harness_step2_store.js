/**
 * Test Harness Step 2: Pengujian Otomatis Manajemen Multi-Obat, Epoch Timestamp & Persistence (10 Tests)
 * Jalankan dengan: node harness_step2_store.js
 */
const assert = require("assert");
const {
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
} = require("../app/src/main/assets/medication_store.js");

let passed = 0;
let failed = 0;

function runTest(nama, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${nama}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${nama}\n   -> ${err.message}`);
    failed++;
  }
}

const regAntibiotik = {
  id: "MED-AMOX",
  namaObat: "Amoxicillin 500mg",
  dosisPerHari: 3,
  intervalMenit: 480,
  minGapMenit: 360,
  earliestWakeTime: "07:00",
  sleepCutoffTime: "22:30",
  autoSnoozeMenit: 10,
  maxSnoozeCount: 3,
  silentVibrationOnly: false,
  strictInterval: true
};

const regVitamin = {
  id: "MED-VITC",
  namaObat: "Vitamin C 500mg",
  dosisPerHari: 2,
  intervalMenit: 360,
  minGapMenit: 240,
  earliestWakeTime: "07:00",
  sleepCutoffTime: "22:30",
  autoSnoozeMenit: 10,
  maxSnoozeCount: 2,
  silentVibrationOnly: true,
  strictInterval: false
};

// S1: Tambah multi-obat & proteksi ID duplikat
runTest("S1: Tambah multi-obat ke store dan tolak ID duplikat", () => {
  let store = buatStore("2026-11-16", "08:00");
  const r1 = tambahObat(store, regAntibiotik);
  assert.strictEqual(r1.ok, true);
  store = r1.store;

  const r2 = tambahObat(store, regVitamin);
  assert.strictEqual(r2.ok, true);
  store = r2.store;

  assert.strictEqual(Object.keys(store.meds).length, 2);

  const dup = tambahObat(store, regAntibiotik);
  assert.strictEqual(dup.ok, false);
  assert.strictEqual(dup.errorCode, "DUPLICATE_MED_ID");
});

// S2: Deteksi bentrok jadwal antar-obat (<= 15 menit)
runTest("S2: Deteksi jadwal antar-obat yang berdekatan dalam window 15 menit", () => {
  let store = buatStore("2026-11-16", "08:00");
  store = tambahObat(store, regAntibiotik).store;
  store = tambahObat(store, regVitamin).store;

  const bentrok = deteksiBentrokJadwal(store, 15);
  assert.strictEqual(bentrok.length, 1);
  assert.strictEqual(bentrok[0].selisihMenit, 0);
});

// S3: Pergantian hari otomatis via Epoch Timestamp tanpa flag manual
runTest("S3: Catat minum lintas tengah malam otomatis terdeteksi dari tanggal penuh", () => {
  let store = buatStore("2026-11-16", "09:00");
  store = tambahObat(store, regAntibiotik).store;

  store = catatMinumObat(store, "MED-AMOX", 1, "2026-11-16", "09:00").store;
  store = catatMinumObat(store, "MED-AMOX", 2, "2026-11-16", "17:00").store;
  const r3 = catatMinumObat(store, "MED-AMOX", 3, "2026-11-17", "01:05");

  assert.strictEqual(r3.ok, true);
  const d3 = r3.store.meds["MED-AMOX"].jadwal[2];
  assert.strictEqual(d3.status, "TAKEN");
  assert.strictEqual(formatEpoch(d3.takenEpochMs).label, "2026-11-17 01:05");
});

// S4: Antrean kronologis gabungan semua obat
runTest("S4: Antrean gabungan mengurutkan semua dosis PENDING/SNOOZED secara kronologis", () => {
  let store = buatStore("2026-11-16", "08:00");
  store = tambahObat(store, regAntibiotik).store;
  store = tambahObat(store, regVitamin).store;
  store = snoozeObat(store, "MED-VITC", 1, "08:00").store;

  const antrean = ambilAntreanJadwal(store);
  assert.strictEqual(antrean[0].medId, "MED-AMOX");
  assert.strictEqual(antrean[1].medId, "MED-VITC");
  assert.strictEqual(antrean[1].status, "SNOOZED");
});

// S5: Fitur Undo riwayat aksi
runTest("S5: Undo mengembalikan state sebelum aksi minum/snooze terakhir", () => {
  let store = buatStore("2026-11-16", "08:00");
  store = tambahObat(store, regVitamin).store;
  store = catatMinumObat(store, "MED-VITC", 1, "2026-11-16", "08:15").store;
  assert.strictEqual(store.meds["MED-VITC"].jadwal[0].status, "TAKEN");

  const u = undoTerakhir(store);
  assert.strictEqual(u.ok, true);
  assert.strictEqual(u.store.meds["MED-VITC"].jadwal[0].status, "PENDING");
});

// S6: Ekspor & Impor JSON Persistence
runTest("S6: Simpan dan muat ulang store JSON menjaga epochMs dan status tetap utuh", () => {
  let store = buatStore("2026-11-16", "08:00");
  store = tambahObat(store, regAntibiotik).store;
  store = catatMinumObat(store, "MED-AMOX", 1, "2026-11-16", "08:05").store;

  const json = eksporStoreJSON(store);
  const loaded = imporStoreJSON(json);
  assert.strictEqual(loaded.meds["MED-AMOX"].jadwal[0].status, "TAKEN");
  assert.strictEqual(
    loaded.meds["MED-AMOX"].jadwal[1].scheduledEpochMs,
    toEpochMs("2026-11-16", "16:05")
  );
  assert.throws(() => imporStoreJSON("{rusak"));
});

// ADDED: S7 (Temuan 1) - Tolak tanggal kalender rollover seperti 2026-02-30
runTest("S7: toEpochMs menolak tanggal kalender tidak valid (2026-02-30)", () => {
  assert.throws(() => toEpochMs("2026-02-30", "08:00"));
  assert.throws(() => toEpochMs("2026-04-31", "08:00"));
});

// ADDED: S8 (Temuan 2) - Tolak tanggal mundur (H-1) & akurat pada jam lebih besar di hari H+1
runTest("S8: Tolak tanggal sebelum tanggalBase dan hitung akurat jam H+1 lebih besar dari H0", () => {
  let store = buatStore("2026-11-16", "08:00");
  store = tambahObat(store, regAntibiotik).store;

  const mundur = catatMinumObat(store, "MED-AMOX", 1, "2026-11-15", "09:00");
  assert.strictEqual(mundur.ok, false);
  assert.strictEqual(mundur.errorCode, "DATE_BEFORE_BASE");

  store = catatMinumObat(store, "MED-AMOX", 1, "2026-11-16", "08:00").store;
  const telatH1 = catatMinumObat(store, "MED-AMOX", 2, "2026-11-17", "10:00"); // Jam 10:00 H+1 > 08:00 H0
  assert.strictEqual(telatH1.ok, true);
  assert.strictEqual(formatEpoch(telatH1.store.meds["MED-AMOX"].jadwal[1].takenEpochMs).label, "2026-11-17 10:00");
  assert.strictEqual(formatEpoch(telatH1.store.meds["MED-AMOX"].jadwal[2].scheduledEpochMs).label, "2026-11-17 18:00");
});

// ADDED: S9 (Temuan 3) - Guard snapshot history palsu di snoozeObat
runTest("S9: snoozeObat menolak dosis TAKEN tanpa menambah snapshot history palsu", () => {
  let store = buatStore("2026-11-16", "08:00");
  store = tambahObat(store, regVitamin).store;
  store = catatMinumObat(store, "MED-VITC", 1, "2026-11-16", "08:00").store;
  const historySebelum = store.history.length;

  const snoozeGagal = snoozeObat(store, "MED-VITC", 1, "08:00");
  assert.strictEqual(snoozeGagal.ok, false);
  assert.strictEqual(snoozeGagal.errorCode, "CANNOT_SNOOZE");
  assert.strictEqual(snoozeGagal.store.history.length, historySebelum);
});

// ADDED: S10 (Temuan 4) - Validasi ketat imporStoreJSON (meds null/array, history non-array)
runTest("S10: imporStoreJSON menolak meds null, meds array, atau history bukan array", () => {
  assert.throws(() => imporStoreJSON('{"version":1,"meds":null,"history":[]}'));
  assert.throws(() => imporStoreJSON('{"version":1,"meds":[],"history":[]}'));
  assert.throws(() => imporStoreJSON('{"version":1,"meds":{},"history":{}}'));
});

console.log(`\nRINGKASAN HARNESS STEP 2: ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
