package com.apotekcoe.dynamicdose.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        // CHANGED: Temuan 5 - Hanya gunakan ACTION_BOOT_COMPLETED agar aman dari Direct Boot crash
        if (
            action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            // CHANGED: Temuan 1 - Gunakan konstanta resmi Context.MODE_PRIVATE
            val prefs = context.getSharedPreferences(
                AlarmScheduler.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val storeJson = prefs.getString(AlarmScheduler.KEY_STORE_JSON, "") ?: ""
            if (storeJson.isNotBlank()) {
                AlarmScheduler.rescheduleAllFromJson(context, storeJson)
            }
        }
    }
}
