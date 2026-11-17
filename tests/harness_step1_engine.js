/**
 * Test Harness Step 1: Pengujian Otomatis & Penjagaan Edge-Case Core Engine (15 Tests)
 * Jalankan dengan: node harness_step1_engine.js
 */
const assert = require("assert");
const {
  parseMenit,
  formatJam,
  buatJadwalHarian,
  catatDosisDiminum,
  tanganiAutoSnooze
} = require("../app/src/main/assets/dynamic_dose_scheduler.js");

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

const regimenReguler = {
  namaObat: "Obat Reguler 4x",
  dosisPerHari: 4,
  intervalMenit: 180,
  minGapMenit: 120,
  earliestWakeTime: "07:00",
  sleepCutoffTime: "22:30",
  autoSnoozeMenit: 10,
  maxSnoozeCount: 3,
  silentVibrationOnly: true,
  strictInterval: false
};

const regimenAntibiotik = {
  namaObat: "Amoxicillin 3x8 Jam",
  dosisPerHari: 3,
  intervalMenit: 480,
  minGapMenit: 360,
  earliestWakeTime: "07:00",
  sleepCutoffTime: "22:30",
  autoSnoozeMenit: 10,
  maxSnoozeCount: 2,
  silentVibrationOnly: false,
  strictInterval: true
};

// 1. Validasi Input Jam
runTest("T1: Tolak format jam tidak valid (25:99 atau teks)", () => {
  assert.throws(() => parseMenit("25:99"));
  assert.throws(() => parseMenit("pagi"));
  assert.strictEqual(parseMenit("07:30"), 450);
  assert.strictEqual(formatJam(1500), "01:00 (+1 hari)");
});

// 2. Wake-Up Trigger
runTest("T2: Wake-up trigger memilih jam paling akhir (06:00 -> 07:00, 08:45 -> 08:45)", () => {
  const sCepat = buatJadwalHarian(regimenReguler, "06:00");
  assert.strictEqual(sCepat.dosisPertamaTrigger, "TARGET_TIME");
  assert.strictEqual(sCepat.jadwal[0].waktuTerjadwal, "07:00");

  const sTelat = buatJadwalHarian(regimenReguler, "08:45");
  assert.strictEqual(sTelat.dosisPertamaTrigger, "WAKE_UP_TRIGGER");
  assert.strictEqual(sTelat.jadwal[0].waktuTerjadwal, "08:45");
});

// 3. Dynamic Shift saat dosis diminum telat
runTest("T3: Pergeseran otomatis sisa dosis ketika dosis 1 diminum telat", () => {
  let state = buatJadwalHarian(regimenReguler, "07:00");
  const res = catatDosisDiminum(state, 1, "07:45");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.state.jadwal[1].waktuTerjadwal, "10:45");
  assert.strictEqual(res.state.jadwal[2].waktuTerjadwal, "13:45");
  assert.strictEqual(res.state.jadwal[3].waktuTerjadwal, "16:45");
});

// 4. Proteksi Double-Tap (ALREADY_TAKEN)
runTest("T4: Cegah double-tap pada dosis yang sudah diminum", () => {
  let state = buatJadwalHarian(regimenReguler, "07:00");
  state = catatDosisDiminum(state, 1, "07:05").state; // CHANGED: assign immutable state
  const dup = catatDosisDiminum(state, 1, "07:06");
  assert.strictEqual(dup.ok, false);
  assert.strictEqual(dup.errorCode, "ALREADY_TAKEN");
});

// 5. Validasi Batas Jarak Minimum (MIN_GAP_VIOLATION) & Override
runTest("T5: Blokir minum terlalu cepat (< minGapMenit) dan izinkan jika forceOverride", () => {
  let state = buatJadwalHarian(regimenReguler, "07:00");
  state = catatDosisDiminum(state, 1, "08:00").state; // CHANGED: assign immutable state

  const terlaluCepat = catatDosisDiminum(state, 2, "09:30");
  assert.strictEqual(terlaluCepat.ok, false);
  assert.strictEqual(terlaluCepat.errorCode, "MIN_GAP_VIOLATION");

  const overrideRes = catatDosisDiminum(state, 2, "09:30", { forceOverride: true });
  assert.strictEqual(overrideRes.ok, true);
  assert.strictEqual(overrideRes.state.jadwal[1].status, "TAKEN");
});

// 6. Validasi Urutan Waktu Mundur (INVALID_TIME_ORDER)
runTest("T6: Tolak jam minum yang lebih awal dari dosis sebelumnya", () => {
  let state = buatJadwalHarian(regimenReguler, "07:00");
  state = catatDosisDiminum(state, 1, "10:00").state; // CHANGED: assign immutable state
  const mundur = catatDosisDiminum(state, 2, "09:00");
  assert.strictEqual(mundur.ok, false);
  assert.strictEqual(mundur.errorCode, "INVALID_TIME_ORDER");
});

// 7. Auto-Snooze hingga batas maksimal lalu MISSED
runTest("T7: Auto-snooze berulang hingga maxSnoozeCount lalu berubah menjadi MISSED", () => {
  let state = buatJadwalHarian(regimenReguler, "07:00");
  state = tanganiAutoSnooze(state, 1, "07:00"); // #1 -> 07:10
  state = tanganiAutoSnooze(state, 1, "07:10"); // #2 -> 07:20
  state = tanganiAutoSnooze(state, 1, "07:20"); // #3 -> 07:30
  assert.strictEqual(state.jadwal[0].status, "SNOOZED");
  assert.strictEqual(state.jadwal[0].waktuTerjadwal, "07:30");

  state = tanganiAutoSnooze(state, 1, "07:30"); // Melebihi maxSnoozeCount (3)
  assert.strictEqual(state.jadwal[0].status, "MISSED");

  // ADDED: Temuan 4 - Panggilan snooze tambahan pada MISSED tidak mengubah status
  const afterMissed = tanganiAutoSnooze(state, 1, "07:40");
  assert.strictEqual(afterMissed.jadwal[0].status, "MISSED");
  assert.strictEqual(afterMissed.jadwal[0].snoozeCount, 3);
});

// 8. Mode Non-Strict Sleep Cutoff
runTest("T8: Obat non-strict ditunda (DEFERRED_SLEEP) dan di-mute jika lewat 22:30", () => {
  let state = buatJadwalHarian(regimenReguler, "07:00");
  state = catatDosisDiminum(state, 1, "07:00").state;
  state = catatDosisDiminum(state, 2, "11:00").state;
  const res = catatDosisDiminum(state, 3, "20:00"); // Dosis 4 -> 23:00
  assert.strictEqual(res.state.jadwal[3].status, "DEFERRED_SLEEP");
  assert.strictEqual(res.state.jadwal[3].alarmMode, "MUTED");
});

// 9. Mode Strict Antibiotik (FORCE_SOUND lewat tengah malam)
runTest("T9: Antibiotik strict tetap PENDING dan FORCE_SOUND meski lewat jam tidur", () => {
  const state = buatJadwalHarian(regimenAntibiotik, "09:00");
  assert.strictEqual(state.jadwal[2].waktuTerjadwal, "01:00 (+1 hari)");
  assert.strictEqual(state.jadwal[2].status, "PENDING");
  assert.strictEqual(state.jadwal[2].alarmMode, "FORCE_SOUND");
});

// 10. Minum Antibiotik Lintas Tengah Malam
runTest("T10: Validasi lintas tengah malam bekerja untuk dosis 3 antibiotik", () => {
  let state = buatJadwalHarian(regimenAntibiotik, "09:00");
  state = catatDosisDiminum(state, 1, "09:00").state;
  state = catatDosisDiminum(state, 2, "17:00").state;
  const res = catatDosisDiminum(state, 3, "01:05", { lintasTengahMalam: true });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.state.jadwal[2].status, "TAKEN");
  assert.strictEqual(res.state.jadwal[2].waktuDiminumMenit, 1505); // ADDED: verifikasi menit absolut
  assert.strictEqual(res.state.jadwal[2].waktuDiminum, "01:05 (+1 hari)");
});

// ADDED: T11 (Temuan 1) - Pergeseran dosis ke-4 setelah dosis ke-3 diminum lintas tengah malam
runTest("T11: Pergeseran dosis ke-4 setelah dosis ke-3 diminum lewat tengah malam tetap di hari berikutnya", () => {
  const regimen4xStrict = { ...regimenAntibiotik, dosisPerHari: 4, intervalMenit: 360, minGapMenit: 240 };
  let state = buatJadwalHarian(regimen4xStrict, "10:00"); // 10:00, 16:00, 22:00, 04:00 (+1 hari)
  state = catatDosisDiminum(state, 1, "10:00").state;
  state = catatDosisDiminum(state, 2, "17:00").state;
  const res3 = catatDosisDiminum(state, 3, "00:30", { lintasTengahMalam: true });
  assert.strictEqual(res3.ok, true);
  assert.strictEqual(res3.state.jadwal[3].waktuTerjadwal, "06:30 (+1 hari)");
  assert.strictEqual(res3.state.jadwal[3].alarmMode, "FORCE_SOUND");
});

// ADDED: T12 (Temuan 2) - Sleep cutoff melewati tengah malam ("00:30") tidak memblokir dosis pagi
runTest("T12: Sleep cutoff shift malam (00:30) tidak menunda dosis pagi & siang", () => {
  const regimenShift = { ...regimenReguler, earliestWakeTime: "07:00", sleepCutoffTime: "00:30" };
  const state = buatJadwalHarian(regimenShift, "08:00"); // 08:00, 11:00, 14:00, 17:00
  assert.strictEqual(state.jadwal[0].status, "PENDING");
  assert.strictEqual(state.jadwal[3].status, "PENDING");
});

// ADDED: T13 (Temuan 3) - Validasi regimen (minGapMenit > intervalMenit, autoSnoozeMenit < 1, maxSnoozeCount < 0)
runTest("T13: Tolak konfigurasi regimen yang tidak valid", () => {
  assert.throws(() => buatJadwalHarian({ ...regimenReguler, minGapMenit: 200 }, "07:00"));
  assert.throws(() => buatJadwalHarian({ ...regimenReguler, autoSnoozeMenit: 0 }, "07:00"));
  assert.throws(() => buatJadwalHarian({ ...regimenReguler, maxSnoozeCount: -1 }, "07:00"));
});

// ADDED: T14 (Temuan 4) - Snooze obat non-strict yang menabrak sleepCutoff otomatis menjadi DEFERRED_SLEEP
runTest("T14: Auto-snooze obat non-strict yang melewati jam tidur otomatis DEFERRED_SLEEP", () => {
  let state = buatJadwalHarian(regimenReguler, "07:00");
  state = catatDosisDiminum(state, 1, "07:00").state;
  state = catatDosisDiminum(state, 2, "11:00").state;
  state = catatDosisDiminum(state, 3, "19:25").state; // Dosis 4 dijadwalkan 22:25
  state = tanganiAutoSnooze(state, 4, "22:25"); // +10 mnt -> 22:35 > 22:30!
  assert.strictEqual(state.jadwal[3].status, "DEFERRED_SLEEP");
  assert.strictEqual(state.jadwal[3].alarmMode, "MUTED");
});

// ADDED: T15 (Temuan 5) - Immutability state (objek asli tidak termutasi)
runTest("T15: Fungsi catatDosisDiminum dan tanganiAutoSnooze tidak memutasi state asli", () => {
  const awal = buatJadwalHarian(regimenReguler, "07:00");
  const setelahMinum = catatDosisDiminum(awal, 1, "07:15").state;
  const setelahSnooze = tanganiAutoSnooze(awal, 1, "07:00");

  assert.strictEqual(awal.jadwal[0].status, "PENDING");
  assert.strictEqual(awal.jadwal[1].waktuTerjadwal, "10:00");
  assert.strictEqual(setelahMinum.jadwal[0].status, "TAKEN");
  assert.strictEqual(setelahMinum.jadwal[1].waktuTerjadwal, "10:15");
  assert.strictEqual(setelahSnooze.jadwal[0].status, "SNOOZED");
});

console.log(`\nRINGKASAN HARNESS STEP 1: ${passed} PASS, ${failed} FAIL`);
if (failed > 0) process.exit(1);