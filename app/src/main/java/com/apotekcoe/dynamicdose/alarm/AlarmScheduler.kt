package com.apotekcoe.dynamicdose.alarm

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONException
import org.json.JSONObject

data class ScheduledDoseAlarm(
    val requestCode: Int,
    val medId: String,
    val namaObat: String,
    val dosisKe: Int,
    val triggerAtEpochMs: Long,
    val alarmMode: String // "VIBRATE_WORK", "NORMAL", "FORCE_SOUND"
)

object AlarmScheduler {
    const val PREFS_NAME = "dynamic_dose_prefs"
    const val KEY_STORE_JSON = "dynamic_dose_store_v1"

    const val ACTION_TRIGGER_ALARM = "com.apotekcoe.dynamicdose.ACTION_TRIGGER_ALARM"
    const val ACTION_MARK_TAKEN = "com.apotekcoe.dynamicdose.ACTION_MARK_TAKEN"
    const val ACTION_SNOOZE_10M = "com.apotekcoe.dynamicdose.ACTION_SNOOZE_10M"

    const val EXTRA_MED_ID = "extra_med_id"
    const val EXTRA_NAMA_OBAT = "extra_nama_obat"
    const val EXTRA_DOSIS_KE = "extra_dosis_ke"
    const val EXTRA_ALARM_MODE = "extra_alarm_mode"
    const val EXTRA_REQUEST_CODE = "extra_request_code"

    const val CHANNEL_VIBRATE_WORK = "ch_vibrate_work"
    const val CHANNEL_NORMAL = "ch_normal"
    const val CHANNEL_FORCE_SOUND = "ch_force_sound"

    // CHANGED: Temuan 2 - Gunakan bitmask positif (and 0x7fffffff) dan pengali * 10 agar +1/+2 tidak bertabrakan
    fun generateRequestCode(medId: String, dosisKe: Int): Int {
        val positiveHash = "$medId#$dosisKe".hashCode() and 0x7fffffff
        return (positiveHash % 10_000_000) * 10
    }

    fun buildNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val chVibrate = NotificationChannel(
            CHANNEL_VIBRATE_WORK,
            "Pengingat Obat (Mode Getar Kerja)",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            setSound(null, null)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 250, 150, 250)
        }

        val chNormal = NotificationChannel(
            CHANNEL_NORMAL,
            "Pengingat Obat (Normal)",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            enableVibration(true)
        }

        val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        val audioAttr = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val chForce = NotificationChannel(
            CHANNEL_FORCE_SOUND,
            "Pengingat Antibiotik (Mode Strict)",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            setSound(alarmSound, audioAttr)
            enableVibration(true)
            setBypassDnd(true)
        }

        nm.createNotificationChannels(listOf(chVibrate, chNormal, chForce))
    }

    fun scheduleExactDoseAlarm(context: Context, alarm: ScheduledDoseAlarm): Boolean {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            return false
        }

        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = ACTION_TRIGGER_ALARM
            putExtra(EXTRA_MED_ID, alarm.medId)
            putExtra(EXTRA_NAMA_OBAT, alarm.namaObat)
            putExtra(EXTRA_DOSIS_KE, alarm.dosisKe)
            putExtra(EXTRA_ALARM_MODE, alarm.alarmMode)
            putExtra(EXTRA_REQUEST_CODE, alarm.requestCode)
        }

        val pendingIntent = PendingIntent.getBroadcast(
            context,
            alarm.requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        alarmManager.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            alarm.triggerAtEpochMs,
            pendingIntent
        )
        return true
    }

    fun cancelDoseAlarm(context: Context, requestCode: Int) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = ACTION_TRIGGER_ALARM
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
        }
    }

    fun showDoseNotification(context: Context, alarm: ScheduledDoseAlarm) {
        // ADDED: Temuan 4 - Cek izin POST_NOTIFICATIONS pada Android 13+ (API 33+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }

        buildNotificationChannels(context)
        val channelId = when (alarm.alarmMode) {
            "VIBRATE_WORK" -> CHANNEL_VIBRATE_WORK
            "FORCE_SOUND" -> CHANNEL_FORCE_SOUND
            else -> CHANNEL_NORMAL
        }

        val takenIntent = Intent(context, DoseActionReceiver::class.java).apply {
            action = ACTION_MARK_TAKEN
            putExtra(EXTRA_MED_ID, alarm.medId)
            putExtra(EXTRA_DOSIS_KE, alarm.dosisKe)
            putExtra(EXTRA_REQUEST_CODE, alarm.requestCode)
        }
        val takenPi = PendingIntent.getBroadcast(
            context,
            alarm.requestCode + 1,
            takenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val snoozeIntent = Intent(context, DoseActionReceiver::class.java).apply {
            action = ACTION_SNOOZE_10M
            putExtra(EXTRA_MED_ID, alarm.medId)
            putExtra(EXTRA_DOSIS_KE, alarm.dosisKe)
            putExtra(EXTRA_REQUEST_CODE, alarm.requestCode)
        }
        val snoozePi = PendingIntent.getBroadcast(
            context,
            alarm.requestCode + 2,
            snoozeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Waktunya Minum ${alarm.namaObat}")
            .setContentText("Dosis #${alarm.dosisKe} · Mode: ${alarm.alarmMode}")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .addAction(0, "Minum Sekarang", takenPi)
            .addAction(0, "Snooze 10 Mnt", snoozePi)
            .build()

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(alarm.requestCode, notif)
    }

    fun rescheduleAllFromJson(context: Context, storeJson: String, nowEpochMs: Long = System.currentTimeMillis()): Int {
        if (storeJson.isBlank()) return 0
        // CHANGED: Temuan 5 - Bungkus parsing JSON dengan try/catch agar BootReceiver tidak crash jika JSON korup
        return try {
            val root = JSONObject(storeJson)
            val meds = root.optJSONObject("meds") ?: return 0
            var count = 0

            val keys = meds.keys()
            while (keys.hasNext()) {
                val medId = keys.next()
                val medObj = meds.getJSONObject(medId)
                val namaObat = medObj.getJSONObject("regimen").optString("namaObat", medId)
                val jadwalArr = medObj.optJSONArray("jadwal") ?: continue

                for (i in 0 until jadwalArr.length()) {
                    val item = jadwalArr.getJSONObject(i)
                    val status = item.optString("status")
                    val scheduledEpochMs = item.optLong("scheduledEpochMs", 0L)
                    if ((status == "PENDING" || status == "SNOOZED") && scheduledEpochMs > nowEpochMs) {
                        val dosisKe = item.getInt("dosisKe")
                        val alarmMode = item.optString("alarmMode", "NORMAL")
                        val reqCode = generateRequestCode(medId, dosisKe)
                        val ok = scheduleExactDoseAlarm(
                            context,
                            ScheduledDoseAlarm(reqCode, medId, namaObat, dosisKe, scheduledEpochMs, alarmMode)
                        )
                        if (ok) count++
                    }
                }
            }
            count
        } catch (e: JSONException) {
            0
        }
    }
}
