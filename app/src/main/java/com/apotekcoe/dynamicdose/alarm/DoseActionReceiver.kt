package com.apotekcoe.dynamicdose.alarm

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// ADDED: Temuan 3 - Receiver untuk tombol aksi langsung di notifikasi (Minum Sekarang / Snooze 10 Mnt)
class DoseActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val medId = intent.getStringExtra(AlarmScheduler.EXTRA_MED_ID) ?: return
        val dosisKe = intent.getIntExtra(AlarmScheduler.EXTRA_DOSIS_KE, 1)
        val requestCode = intent.getIntExtra(
            AlarmScheduler.EXTRA_REQUEST_CODE,
            AlarmScheduler.generateRequestCode(medId, dosisKe)
        )

        // Tutup notifikasi yang sedang tampil
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(requestCode)

        val prefs = context.getSharedPreferences(AlarmScheduler.PREFS_NAME, Context.MODE_PRIVATE)
        if (action == AlarmScheduler.ACTION_SNOOZE_10M) {
            val nextTrigger = System.currentTimeMillis() + 10 * 60 * 1000L
            AlarmScheduler.scheduleExactDoseAlarm(
                context,
                ScheduledDoseAlarm(requestCode, medId, medId, dosisKe, nextTrigger, "NORMAL")
            )
        } else if (action == AlarmScheduler.ACTION_MARK_TAKEN) {
            // Simpan event pending untuk disinkronkan oleh WebView/UI saat dibuka
            prefs.edit()
                .putString("pending_taken_action", "$medId#$dosisKe#${System.currentTimeMillis()}")
                .apply()
        }
    }
}
