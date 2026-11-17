/**
 * Test Harness Step 5: Uji Integrasi End-to-End 3 Hari Berturut-turut & Kelengkapan Rilis (4 Tests)
 * Jalankan dengan: node harness_step5_e2e.js
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

// E1: Simulasi 3 Hari Berturut-turut + Verifikasi Jarak Aman Lintas-Hari
runTest("E1: Simulasi 3 hari berturut-turut menjaga jarak aman lintas-hari (00:40 -> 07:00)", () => {
  const regAmox = {
    id: "E2E-AMOX",
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
  const regPara = {
    id: "E2E-PARA",
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
  };

  // --- HARI 1 (2026-11-16): Bangun telat 08:30 ---
  let day1 = storeApi.buatStore("2026-11-16", "08:30");
  day1 = storeApi.tambahObat(day1, regAmox).store;
  day1 = storeApi.tambahObat(day1, regPara).store;

  assert.ok(storeApi.deteksiBentrokJadwal(day1, 15).length >= 1);
  day1 = storeApi.catatMinumObat(day1, "E2E-AMOX", 1, "2026-11-16", "08:30").store;
  day1 = storeApi.catatMinumObat(day1, "E2E-PARA", 1, "2026-11-16", "08:40").store;
  day1 = storeApi.snoozeObat(day1, "E2E-PARA", 2, "12:40").store;
  day1 = storeApi.catatMinumObat(day1, "E2E-AMOX", 2, "2026-11-16", "16:35").store;
  // Dosis 3 Amox diminum lewat tengah malam (Hari 2 dini hari 00:40)
  const resAmox3 = storeApi.catatMinumObat(day1, "E2E-AMOX", 3, "2026-11-17", "00:40");
  assert.strictEqual(resAmox3.ok, true);
  day1 = resAmox3.store;
  const lastDay1Epoch = day1.meds["E2E-AMOX"].jadwal[2].takenEpochMs;

  // --- HARI 2 (2026-11-17): Bangun lebih awal 06:45 -> Target 07:00 dipakai ---
  let day2 = storeApi.buatStore("2026-11-17", "06:45");
  day2 = storeApi.tambahObat(day2, regAmox).store;
  day2 = storeApi.tambahObat(day2, regPara).store;
  assert.strictEqual(day2.meds["E2E-AMOX"].dosisPertamaTrigger, "TARGET_TIME");
  assert.strictEqual(day2.meds["E2E-AMOX"].jadwal[0].waktuTerjadwal, "07:00");

  // ADDED: Temuan 3 - Verifikasi jarak aman dosis terakhir Hari 1 (00:40) ke dosis pertama Hari 2 (07:00)
  const firstDay2Epoch = day2.meds["E2E-AMOX"].jadwal[0].scheduledEpochMs;
  const gapLintasHariMenit = Math.round((firstDay2Epoch - lastDay1Epoch) / 60000);
  assert.ok(gapLintasHariMenit >= regAmox.minGapMenit, `Jarak lintas hari ${gapLintasHariMenit} mnt < minGap ${regAmox.minGapMenit}`);

  // --- HARI 3 (2026-11-18): Bangun siang 09:15 -> Wake-up trigger dipakai ---
  let day3 = storeApi.buatStore("2026-11-18", "09:15");
  day3 = storeApi.tambahObat(day3, regAmox).store;
  assert.strictEqual(day3.meds["E2E-AMOX"].dosisPertamaTrigger, "WAKE_UP_TRIGGER");
  const json = storeApi.eksporStoreJSON(day3);
  const loaded = storeApi.imporStoreJSON(json);
  assert.strictEqual(loaded.meds["E2E-AMOX"].jadwal[2].alarmMode, "FORCE_SOUND");
});

// E2: Verifikasi kelengkapan seluruh 15 artefak proyek Step 1-5 di disk
runTest("E2: Seluruh file artefak proyek (JS, HTML, Kotlin, Manifest, CI/CD, & Checklist) lengkap tersedia", () => {
  const requiredFiles = [
    "../app/src/main/assets/dynamic_dose_scheduler.js",
    "harness_step1_engine.js",
    "../app/src/main/assets/medication_store.js",
    "harness_step2_store.js",
    "../app/src/main/assets/med_reminder_app.html",
    "harness_step3_ui.js",
    "../app/src/main/java/com/apotekcoe/dynamicdose/alarm/AlarmScheduler.kt",
    "../app/src/main/java/com/apotekcoe/dynamicdose/alarm/BootReceiver.kt",
    "../app/src/main/java/com/apotekcoe/dynamicdose/alarm/AlarmReceiver.kt",
    "../app/src/main/java/com/apotekcoe/dynamicdose/alarm/DoseActionReceiver.kt",
    "harness_step4_alarm_sim.js",
    "../app/src/main/java/com/apotekcoe/dynamicdose/MainActivity.kt",
    "../app/src/main/AndroidManifest.xml",
    "../.github/workflows/build-apk.yml",
    "../release_checklist.md"
  ];
  for (const file of requiredFiles) {
    const fullPath = path.join(__dirname, file);
    assert.ok(fs.existsSync(fullPath), `File artefak hilang: ${file}`);
    assert.ok(fs.statSync(fullPath).size > 0, `File artefak kosong: ${file}`);
  }
});

// E3: Verifikasi konten workflow build-apk.yml & checklist izin Android
runTest("E3: build-apk.yml dan release_checklist.md memuat uji JS, setup-android, & signing guide", () => {
  const yml = fs.readFileSync(path.join(__dirname, "../.github/workflows/build-apk.yml"), "utf8");
  const checklist = fs.readFileSync(path.join(__dirname, "../release_checklist.md"), "utf8");
  assert.ok(yml.includes("actions/setup-node@v4"));
  assert.ok(yml.includes("android-actions/setup-android@v3"));
  assert.ok(yml.includes("assembleDebug"));
  assert.ok(yml.includes("upload-artifact"));
  assert.ok(checklist.includes("SCHEDULE_EXACT_ALARM"));
  assert.ok(checklist.includes("POST_NOTIFICATIONS"));
  assert.ok(checklist.includes("RECEIVE_BOOT_COMPLETED"));
  assert.ok(checklist.includes("KEYSTORE_PASSWORD"));
});

// ADDED: E4 (Temuan 2) - Verifikasi kontrak MainActivity.kt WebView Bridge & AndroidManifest.xml
runTest("E4: MainActivity.kt (AndroidBridge) dan AndroidManifest.xml memenuhi kontrak integrasi", () => {
  const mainKt = fs.readFileSync(path.join(__dirname, "../app/src/main/java/com/apotekcoe/dynamicdose/MainActivity.kt"), "utf8");
  const manifest = fs.readFileSync(path.join(__dirname, "../app/src/main/AndroidManifest.xml"), "utf8");
  assert.ok(mainKt.includes("@JavascriptInterface"));
  assert.ok(mainKt.includes("syncStoreToNative"));
  assert.ok(mainKt.includes("rescheduleAllFromJson"));
  assert.ok(manifest.includes("android.permission.SCHEDULE_EXACT_ALARM"));
  assert.ok(manifest.includes("com.apotekcoe.dynamicdose") || manifest.includes(".alarm.BootReceiver"));
});

console.log(`\nRINGKASAN HARNESS STEP 5: ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
