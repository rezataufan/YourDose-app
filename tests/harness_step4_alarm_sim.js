/**
 * Test Harness Step 4: Pengujian Kontrak Android Bridge (Kotlin) & Simulasi Reschedule Pasca-Reboot (5 Tests)
 * Jalankan dengan: node harness_step4_alarm_sim.js
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

const alarmKt = fs.readFileSync(path.join(__dirname, "../app/src/main/java/com/apotekcoe/dynamicdose/alarm/AlarmScheduler.kt"), "utf8");
const bootKt = fs.readFileSync(path.join(__dirname, "../app/src/main/java/com/apotekcoe/dynamicdose/alarm/BootReceiver.kt"), "utf8");
const alarmRxKt = fs.readFileSync(path.join(__dirname, "../app/src/main/java/com/apotekcoe/dynamicdose/alarm/AlarmReceiver.kt"), "utf8");
const actionRxKt = fs.readFileSync(path.join(__dirname, "../app/src/main/java/com/apotekcoe/dynamicdose/alarm/DoseActionReceiver.kt"), "utf8");

// A1: Kontrak API Android AlarmManager & Notification Channel
runTest("A1: AlarmScheduler.kt memuat setExactAndAllowWhileIdle, canScheduleExactAlarms, FLAG_IMMUTABLE, & 3 channel", () => {
  const required = [
    "setExactAndAllowWhileIdle",
    "canScheduleExactAlarms",
    "FLAG_IMMUTABLE",
    "CHANNEL_VIBRATE_WORK",
    "CHANNEL_NORMAL",
    "CHANNEL_FORCE_SOUND",
    "ACTION_MARK_TAKEN",
    "ACTION_SNOOZE_10M",
    "rescheduleAllFromJson"
  ];
  for (const token of required) {
    assert.ok(alarmKt.includes(token), `Token Kotlin wajib tidak ditemukan: ${token}`);
  }
});

// A2: Kontrak BootReceiver (Fixed: MODE_PRIVATE & tanpa ACTION_LOCKED_BOOT_COMPLETED)
runTest("A2: BootReceiver.kt menggunakan Context.MODE_PRIVATE dan menangani BOOT_COMPLETED", () => {
  assert.ok(bootKt.includes("Context.MODE_PRIVATE"));
  assert.strictEqual(bootKt.includes("CONTEXT_PRIVATE"), false);
  assert.strictEqual(bootKt.includes("ACTION_LOCKED_BOOT_COMPLETED"), false);
  assert.ok(bootKt.includes("ACTION_BOOT_COMPLETED"));
  assert.ok(bootKt.includes("ACTION_MY_PACKAGE_REPLACED"));
});

// A3: Simulasi JS-side Reschedule Filter Pasca-Reboot
runTest("A3: Simulasi reschedule pasca-reboot hanya menjadwalkan dosis masa depan yang aktif", () => {
  let store = storeApi.buatStore("2026-11-16", "08:00");
  store = storeApi.tambahObat(store, {
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
  }).store;

  store = storeApi.tambahObat(store, {
    id: "MED-PARA",
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

  store = storeApi.catatMinumObat(store, "MED-AMOX", 1, "2026-11-16", "08:00").store;
  const nowRebootEpoch = storeApi.toEpochMs("2026-11-16", "10:00");

  const antrean = storeApi.ambilAntreanJadwal(store);
  const dijadwalkanUlang = antrean.filter((a) => a.scheduledEpochMs > nowRebootEpoch);

  assert.strictEqual(dijadwalkanUlang.length, 5);
  assert.strictEqual(dijadwalkanUlang.some((a) => a.alarmMode === "FORCE_SOUND"), true);
});

// ADDED: A4 (Temuan 2, 4, 5) - RequestCode bitmask * 10, POST_NOTIFICATIONS, & try/catch JSONException
runTest("A4: AlarmScheduler.kt menjaga requestCode positif * 10, cek POST_NOTIFICATIONS, dan try/catch JSON", () => {
  assert.ok(alarmKt.includes("0x7fffffff"));
  assert.ok(alarmKt.includes("* 10"));
  assert.ok(alarmKt.includes("POST_NOTIFICATIONS"));
  assert.ok(alarmKt.includes("catch (e: JSONException)"));
});

// ADDED: A5 (Temuan 3) - Kontrak AlarmReceiver & DoseActionReceiver lengkap
runTest("A5: AlarmReceiver.kt dan DoseActionReceiver.kt terimplementasi lengkap", () => {
  assert.ok(alarmRxKt.includes("class AlarmReceiver : BroadcastReceiver()"));
  assert.ok(alarmRxKt.includes("showDoseNotification"));
  assert.ok(actionRxKt.includes("class DoseActionReceiver : BroadcastReceiver()"));
  assert.ok(actionRxKt.includes("ACTION_SNOOZE_10M"));
  assert.ok(actionRxKt.includes("ACTION_MARK_TAKEN"));
});

console.log(`\nRINGKASAN HARNESS STEP 4: ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);
