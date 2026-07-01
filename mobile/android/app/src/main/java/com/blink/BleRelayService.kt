package com.blink

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class BleRelayService : Service() {

  companion object {
    const val CHANNEL_ID = "blink_mesh_relay"
    const val NOTIF_ID   = 7001
    var running = false
  }

  override fun onCreate() {
    super.onCreate()
    createChannel()
    startForeground(NOTIF_ID, buildNotification())
    running = true
  }

  override fun onDestroy() {
    super.onDestroy()
    running = false
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int =
    START_STICKY  // restart automatically if killed

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(
        CHANNEL_ID, "Mesh Relay",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Active while Blink can relay messages over Bluetooth"
        setShowBadge(false)
      }
      getSystemService(NotificationManager::class.java)?.createNotificationChannel(ch)
    }
  }

  private fun buildNotification(): Notification {
    val intent = Intent(this, MainActivity::class.java)
    val pi = PendingIntent.getActivity(this, 0, intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Blink mesh relay active")
      .setContentText("Nearby Blink devices can share messages with you")
      .setSmallIcon(R.drawable.ic_notification)
      .setContentIntent(pi)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }
}
