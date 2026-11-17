# Checklist Rilis APK: Pengingat Obat Dynamic-Interval

Dokumen ini merangkum daftar periksa kesiapan kompilasi APK Android dan konfigurasi sistem agar alarm *dynamic-interval* berjalan andal di perangkat pengguna.

---

## 1. Struktur File Proyek Siap Rakit

* **WebView Assets (`app/src/main/assets/`):**
  * `dynamic_dose_scheduler.js` (Step 1)
  * `medication_store.js` (Step 2)
  * `med_reminder_app.html` (Step 3)
* **Android Native & WebView Bridge (`app/src/main/java/com/apotekcoe/dynamicdose/`):**
  * `MainActivity.kt` (Step 5 — Host WebView & `AndroidBridge.syncStoreToNative`)
  * `alarm/AlarmScheduler.kt` (Step 4)
  * `alarm/BootReceiver.kt` (Step 4)
  * `alarm/AlarmReceiver.kt` (Step 4)
  * `alarm/DoseActionReceiver.kt` (Step 4)
* **Manifest & CI/CD:**
  * `app/src/main/AndroidManifest.xml` (Step 5)
  * `.github/workflows/build-apk.yml` (Step 5)

---

## 2. Izin Wajib di `AndroidManifest.xml`

Template `AndroidManifest.xml` sudah menyertakan seluruh elemen wajib berikut:

* `android.permission.SCHEDULE_EXACT_ALARM` (Android 12+ alarm presisi)
* `android.permission.POST_NOTIFICATIONS` (Android 13+ izin notifikasi)
* `android.permission.RECEIVE_BOOT_COMPLETED` (pemulihan alarm setelah HP *restart*)
* `android.permission.WAKE_LOCK` (membangunkan CPU sesaat saat alarm berbunyi)
* Registrasi `<receiver>` untuk `AlarmReceiver`, `DoseActionReceiver`, dan `BootReceiver`.

---

## 3. Uji Perangkat & Penghemat Baterai OEM

1. **Battery Optimization:** Minta pengguna memilih *Unrestricted / Tidak Dibatasi* pada pengaturan baterai aplikasi (krusial untuk Xiaomi MIUI/HyperOS, Oppo ColorOS, dan Vivo FuntouchOS).
2. **Exact Alarm Permission:** Pada Android 12+, arahkan pengguna ke layar *Alarms & Reminders* jika `canScheduleExactAlarms()` bernilai `false`.
3. **Verifikasi 3 Mode Channel:** Uji notifikasi `VIBRATE_WORK` (tanpa suara), `NORMAL`, dan `FORCE_SOUND` (antibiotik *strict* menembus mode *Do Not Disturb*).

---

## 4. Langkah Build APK & Release Signing via GitHub Actions

1. Buat repositori baru di GitHub dan salin seluruh aset + file Kotlin sesuai struktur di atas.
2. Letakkan `build-apk.yml` di `.github/workflows/build-apk.yml` (otomatis menjalankan 5 *Test Harness* JS lalu membangun APK).
3. Lakukan `git push` ke branch `main`, lalu unduh artefak **dynamic-dose-debug-apk** di tab **Actions**.
4. **Opsional (Release APK Signing):** Untuk mencetak *release APK* yang ditandatangani, buat keystore lokal (`keytool -genkey -v -keystore release.jks ...`), simpan versi Base64-nya bersama `KEYSTORE_PASSWORD`, `KEY_ALIAS`, dan `KEY_PASSWORD` di **GitHub Repository Secrets**, lalu tambahkan langkah `./gradlew assembleRelease` di `build-apk.yml`.
