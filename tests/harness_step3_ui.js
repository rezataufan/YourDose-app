/**
 * Test Harness Step 3: Pengujian Kontrak DOM HTML & Simulasi Alur Controller UI (4 Tests)
 * Jalankan dengan: node harness_step3_ui.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const storeApi = require("../app/src/main/assets/medication_store.js");

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

const htmlPath = path.join(__dirname, "../app/src/main/assets/med_reminder_app.html");
const htmlContent = fs.readFileSync(htmlPath, "utf8");

// U1: Kontrak DOM ID dan Script Dependencies
runTest("U1: med_reminder_app.html memuat semua elemen kontrol wajib dan script Step 1 & 2", () => {
  const requiredTokens = [
    "dynamic_dose_scheduler.js",
    "medication_store.js",
    'id="inputTanggalAktif"',
    'id="inputJamSimulasi"',
    'id="btnApplyWake"', // ADDED: Temuan 2
    'id="btnUndo"',
    'id="btnResetDemo"',
    'id="btnForceOverride"',
    'id="bannerSuccess"', // ADDED: Temuan 4
    'id="bannerBentrok"',
    'id="bannerError"',
    'id="listAntrean"',
    'id="listRegimen"',
    'id="formTambahObat"',
    "escapeHtml"
  ];
  for (const token of requiredTokens) {
    assert.ok(htmlContent.includes(token), `Token HTML wajib tidak ditemukan: ${token}`);
  }
});

// U2: Simulasi Alur UI Lengkap
runTest("U2: Alur controller UI bekerja penuh dari inisialisasi hingga Undo dan localStorage roundtrip", () => {
  const fakeStorage = {};
  let appStore = storeApi.buatStore("2026-11-16", "08:00");

  appStore = storeApi.tambahObat(appStore, {
    id: "UI-AMOX",
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
  }).store;

  appStore = storeApi.tambahObat(appStore, {
    id: "UI-PARA",
    namaObat: "Paracetamol 500mg",
    dosisPerHari: 4,
    intervalMenit: 240,
    minGapMenit: 180,
    earliestWakeTime: "07:00",
    sleepCutoffTime: "22:30",
    autoSnoozeMenit: 10,
    maxSnoozeCount: 3,
    silentVibrationOnly: true,
    strictInterval: false
  }).store;

  const bentrok = storeApi.deteksiBentrokJadwal(appStore, 15);
  assert.ok(bentrok.length >= 1);

  appStore = storeApi.catatMinumObat(appStore, "UI-PARA", 1, "2026-11-16", "08:00").store;

  const gagal = storeApi.catatMinumObat(appStore, "UI-PARA", 2, "2026-11-16", "09:00");
  assert.strictEqual(gagal.ok, false);
  assert.strictEqual(gagal.errorCode, "MIN_GAP_VIOLATION");

  const overrideOk = storeApi.catatMinumObat(appStore, "UI-PARA", 2, "2026-11-16", "09:00", { forceOverride: true });
  assert.strictEqual(overrideOk.ok, true);
  appStore = overrideOk.store;

  appStore = storeApi.snoozeObat(appStore, "UI-AMOX", 1, "08:00").store;
  assert.strictEqual(appStore.meds["UI-AMOX"].jadwal[0].status, "SNOOZED");

  appStore = storeApi.undoTerakhir(appStore).store;
  assert.strictEqual(appStore.meds["UI-AMOX"].jadwal[0].status, "PENDING");

  fakeStorage["dynamic_dose_store_v1"] = storeApi.eksporStoreJSON(appStore);
  const reloaded = storeApi.imporStoreJSON(fakeStorage["dynamic_dose_store_v1"]);
  assert.strictEqual(reloaded.meds["UI-PARA"].jadwal[1].status, "TAKEN");
});

// ADDED: U3 (Temuan 1) - Pastikan tidak ada inline onclick dan menggunakan data-action delegation
runTest("U3: Keamanan event handler HTML menggunakan data-action delegation tanpa inline onclick", () => {
  assert.strictEqual(htmlContent.includes('onclick="aksiMinum'), false);
  assert.strictEqual(htmlContent.includes('onclick="aksiSnooze'), false);
  assert.ok(htmlContent.includes('data-action="minum"'));
  assert.ok(htmlContent.includes('data-action="snooze"'));
  assert.ok(htmlContent.includes('data-action="hapus"'));
});

// ADDED: U4 (Temuan 2 & 3) - Sinkronisasi input, validasi spasi nama obat, & fitur hapus regimen
runTest("U4: Sinkronisasi input, penolakan nama obat spasi kosong, dan fitur hapus tersedia", () => {
  assert.ok(htmlContent.includes("sinkronkanInputDariStore"));
  assert.ok(htmlContent.includes("Nama obat tidak boleh kosong"));
  assert.ok(htmlContent.includes("aksiHapusObat"));
});

console.log(`\nRINGKASAN HARNESS STEP 3: ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
