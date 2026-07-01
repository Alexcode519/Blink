package com.blink

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class BleRelayServiceModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "BleRelayService"

  @ReactMethod
  fun start() {
    val intent = Intent(ctx, BleRelayService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      ctx.startForegroundService(intent)
    else
      ctx.startService(intent)
  }

  @ReactMethod
  fun stop() {
    ctx.stopService(Intent(ctx, BleRelayService::class.java))
  }

  @ReactMethod
  fun isRunning(promise: com.facebook.react.bridge.Promise) {
    promise.resolve(BleRelayService.running)
  }
}
