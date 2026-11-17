package com.apotekcoe.dynamicdose

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.apotekcoe.dynamicdose.alarm.AlarmScheduler

// ADDED: Temuan 2 - WebView Host & JavascriptInterface untuk sinkronisasi state JSON ke AlarmScheduler
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    private val requestNotifPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* Ditangani otomatis oleh sistem */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                requestNotifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = WebViewClient()
            addJavascriptInterface(NativeAlarmBridge(this@MainActivity), "AndroidBridge")
            loadUrl("file:///android_asset/med_reminder_app.html")
        }
        setContentView(webView)
    }

    class NativeAlarmBridge(private val context: Context) {
        @JavascriptInterface
        fun syncStoreToNative(storeJson: String): Int {
            val prefs = context.getSharedPreferences(AlarmScheduler.PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(AlarmScheduler.KEY_STORE_JSON, storeJson).apply()
            return AlarmScheduler.rescheduleAllFromJson(context, storeJson)
        }
    }
}
