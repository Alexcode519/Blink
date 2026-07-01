package com.blink

import android.content.*
import android.net.NetworkInfo
import android.net.wifi.p2p.*
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.*
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors

class WifiDirectModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "WifiDirectModule"

  companion object {
    const val TAG  = "BlinkWifiDirect"
    const val PORT = 8787
  }

  private val executor = Executors.newCachedThreadPool()
  private val main     = Handler(Looper.getMainLooper())
  private var manager: WifiP2pManager? = null
  private var channel: WifiP2pManager.Channel? = null
  private var serverSocket: ServerSocket? = null
  private var clientSocket: Socket? = null
  private var writer: PrintWriter? = null

  // ── BroadcastReceiver ─────────────────────────────────────────────────────
  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> {
          manager?.requestPeers(channel) { peers ->
            val arr = Arguments.createArray()
            for (dev in peers.deviceList) {
              arr.pushMap(Arguments.createMap().apply {
                putString("address", dev.deviceAddress)
                putString("name", dev.deviceName)
              })
            }
            emit("WifiP2pPeersChanged", Arguments.createMap().apply { putArray("peers", arr) })
          }
        }
        WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
          val netInfo = intent.getParcelableExtra<NetworkInfo>(WifiP2pManager.EXTRA_NETWORK_INFO)
          if (netInfo?.isConnected == true) {
            manager?.requestConnectionInfo(channel) { info ->
              val isOwner = info.isGroupOwner
              val ownerAddr = info.groupOwnerAddress?.hostAddress ?: "192.168.49.1"
              emit("WifiP2pConnected", Arguments.createMap().apply {
                putBoolean("isGroupOwner", isOwner)
                putString("groupOwnerAddress", ownerAddr)
              })
              if (isOwner) startServer() else connectAsClient(ownerAddr)
            }
          } else {
            emit("WifiP2pDisconnected", Arguments.createMap())
            closeConnections()
          }
        }
      }
    }
  }

  @ReactMethod
  fun setup() {
    manager = ctx.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
    channel = manager?.initialize(ctx, ctx.mainLooper, null)
    val filter = IntentFilter().apply {
      addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
      addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
      addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
    }
    ctx.registerReceiver(receiver, filter)
    emit("WifiP2pInitialized", Arguments.createMap())
    Log.d(TAG, "Wi-Fi Direct initialized")
  }

  @ReactMethod
  fun startDiscovery() {
    manager?.discoverPeers(channel, object : WifiP2pManager.ActionListener {
      override fun onSuccess() { emit("WifiP2pDiscoveryStarted", Arguments.createMap()) }
      override fun onFailure(reason: Int) {
        emit("WifiP2pError", Arguments.createMap().apply { putString("error", "Discovery failed: $reason") })
      }
    })
  }

  @ReactMethod
  fun stopDiscovery() {
    manager?.stopPeerDiscovery(channel, null)
  }

  @ReactMethod
  fun connectToPeer(deviceAddress: String) {
    val config = WifiP2pConfig().apply { this.deviceAddress = deviceAddress }
    manager?.connect(channel, config, object : WifiP2pManager.ActionListener {
      override fun onSuccess() { Log.d(TAG, "Connect invitation sent to $deviceAddress") }
      override fun onFailure(reason: Int) {
        emit("WifiP2pError", Arguments.createMap().apply { putString("error", "Connect failed: $reason") })
      }
    })
  }

  @ReactMethod
  fun disconnect() {
    manager?.removeGroup(channel, null)
    closeConnections()
  }

  @ReactMethod
  fun sendData(data: String, promise: Promise) {
    executor.submit {
      try {
        writer?.println(data)
        writer?.flush()
        main.post { promise.resolve(true) }
      } catch (e: Exception) {
        main.post { promise.reject("SEND_FAILED", e.message) }
      }
    }
  }

  // ── TCP server (group owner) ──────────────────────────────────────────────
  private fun startServer() {
    executor.submit {
      try {
        serverSocket = ServerSocket(PORT)
        Log.d(TAG, "TCP server listening on port $PORT")
        val socket = serverSocket!!.accept()
        clientSocket = socket
        writer = PrintWriter(BufferedWriter(OutputStreamWriter(socket.outputStream)), true)
        emit("WifiP2pSocketReady", Arguments.createMap().apply { putBoolean("isServer", true) })
        readLoop(socket)
      } catch (e: Exception) {
        if (e.message?.contains("closed") != true)
          emit("WifiP2pError", Arguments.createMap().apply { putString("error", "Server: ${e.message}") })
      }
    }
  }

  // ── TCP client ────────────────────────────────────────────────────────────
  private fun connectAsClient(ownerIp: String) {
    executor.submit {
      var attempts = 0
      while (attempts < 10) {
        try {
          Thread.sleep(500)
          val socket = Socket(ownerIp, PORT)
          clientSocket = socket
          writer = PrintWriter(BufferedWriter(OutputStreamWriter(socket.outputStream)), true)
          emit("WifiP2pSocketReady", Arguments.createMap().apply { putBoolean("isServer", false) })
          readLoop(socket)
          return@submit
        } catch (e: Exception) {
          attempts++
          if (attempts >= 10)
            emit("WifiP2pError", Arguments.createMap().apply { putString("error", "Client connect failed after 10 attempts") })
        }
      }
    }
  }

  private fun readLoop(socket: Socket) {
    try {
      val reader = BufferedReader(InputStreamReader(socket.inputStream))
      var line: String?
      while (reader.readLine().also { line = it } != null) {
        val data = line!!
        main.post {
          emit("WifiP2pData", Arguments.createMap().apply { putString("data", data) })
        }
      }
    } catch (e: Exception) {
      if (e.message?.contains("closed") != true)
        Log.d(TAG, "Read loop ended: ${e.message}")
    }
    emit("WifiP2pDisconnected", Arguments.createMap())
  }

  private fun closeConnections() {
    try { writer?.close() } catch (_: Exception) {}
    try { clientSocket?.close() } catch (_: Exception) {}
    try { serverSocket?.close() } catch (_: Exception) {}
    writer = null; clientSocket = null; serverSocket = null
  }

  @ReactMethod
  fun destroy() {
    try { ctx.unregisterReceiver(receiver) } catch (_: Exception) {}
    manager?.removeGroup(channel, null)
    closeConnections()
  }

  @ReactMethod fun addListener(e: String) {}
  @ReactMethod fun removeListeners(n: Int) {}

  private fun emit(name: String, data: WritableMap) {
    main.post {
      try {
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(name, data)
      } catch (_: Exception) {}
    }
  }
}
