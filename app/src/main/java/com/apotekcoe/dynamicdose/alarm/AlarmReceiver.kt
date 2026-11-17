package com.apotekcoe.dynamicdose.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// ADDED: Temuan 3 - Receiver saat alarm berbunyi untuk memunculkan notifikasi dosis
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AlarmScheduler.ACTION_TRIGGER_ALARM) return

        val medId = intent.getStringExtra(AlarmScheduler.EXTRA_MED_ID) ?: return
        val namaObat = intent.getStringExtra(AlarmScheduler.EXTRA_NAMA_OBAT) ?: medId
        val dosisKe = intent.getIntExtra(AlarmScheduler.EXTRA_DOSIS_KE, 1)
        val alarmMode = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_MODE) ?: "NORMAL"
        val requestCode = intent.getIntExtra(
            AlarmScheduler.EXTRA_REQUEST_CODE,
            AlarmScheduler.generateRequestCode(medId, dosisKe)
        )

        AlarmScheduler.showDoseNotification(
            context,
            ScheduledDoseAlarm(
                requestCode = requestCode,
                medId = medId,
                namaObat = namaObat,
                dosisKe = dosisKe,
                triggerAtEpochMs = System.currentTimeMillis(),
                alarmMode = alarmMode
            )
        )
    }
}
