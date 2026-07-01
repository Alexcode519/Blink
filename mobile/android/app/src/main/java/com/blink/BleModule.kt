package com.blink

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import java.util.UUID
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class BleModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "BleModule"

  private val BLINK_SVC  = UUID.fromString("0000b11c-0000-1000-8000-00805f9b34fb")
  private val BLINK_CHAR = UUID.fromString("0000b11d-0000-1000-8000-00805f9b34fb")
  private val main = Handler(Looper.getMainLooper())

  // ── Scan ──────────────────────────────────────────────────────────────────
  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val uuids = result.scanRecord?.serviceUuids
      val isBlink = uuids?.any { it.uuid == BLINK_SVC } == true
      emit("BleDeviceFound", Arguments.createMap().apply {
        putString("id", result.device.address)
        putString("name", result.device.name ?: "")
        putInt("rssi", result.rssi)
        putBoolean("isBlink", isBlink)
      })
    }
    override fun onScanFailed(errorCode: Int) =
      emit("BleScanFailed", Arguments.createMap().apply { putInt("errorCode", errorCode) })
  }

  @ReactMethod fun startScan() {
    val scanner = adapter()?.bluetoothLeScanner
      ?: return emit("BleScanFailed", Arguments.createMap().apply { putString("error", "BLE not ready") })
    scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
    emit("BleScanStarted", Arguments.createMap())
  }

  @ReactMethod fun stopScan() {
    adapter()?.bluetoothLeScanner?.stopScan(scanCallback)
    emit("BleScanStopped", Arguments.createMap())
  }

  // ── Advertise ────────────────────────────────────────────────────────────
  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(s: AdvertiseSettings) = emit("BleAdvertiseStarted", Arguments.createMap())
    override fun onStartFailure(e: Int) = emit("BleAdvertiseFailed", Arguments.createMap().apply { putInt("errorCode", e) })
  }

  @ReactMethod fun startAdvertise() {
    val a = adapter() ?: return
    val adv = a.bluetoothLeAdvertiser ?: return emit("BleAdvertiseFailed", Arguments.createMap().apply { putString("error", "No advertiser") })
    adv.startAdvertising(
      AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).setConnectable(true).build(),
      AdvertiseData.Builder().addServiceUuid(ParcelUuid(BLINK_SVC)).setIncludeDeviceName(false).build(),
      advertiseCallback
    )
  }

  @ReactMethod fun stopAdvertise() {
    adapter()?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
    emit("BleAdvertiseStopped", Arguments.createMap())
  }

  // ── GATT Server (peripheral role) ─────────────────────────────────────────
  private var gattServer: BluetoothGattServer? = null

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      val e = if (newState == BluetoothProfile.STATE_CONNECTED) "BleGattClientConnected"
              else "BleGattClientDisconnected"
      emit(e, Arguments.createMap().apply { putString("address", device.address) })
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice, requestId: Int,
      characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
    ) {
      Log.d("BlinkBle", "onCharacteristicWriteRequest: from=${device.address} responseNeeded=$responseNeeded preparedWrite=$preparedWrite bytes=${value?.size}")
      if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
      val text = value?.toString(Charsets.UTF_8) ?: return
      emit("BleGattData", Arguments.createMap().apply {
        putString("from", device.address)
        putString("data", text)
      })
    }
  }

  @ReactMethod fun startGattServer() {
    val bm = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager ?: return
    main.post {
      val server = bm.openGattServer(reactContext, serverCallback) ?: return@post
      val svc = BluetoothGattService(BLINK_SVC, BluetoothGattService.SERVICE_TYPE_PRIMARY)
      val char = BluetoothGattCharacteristic(
        BLINK_CHAR,
        BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
        BluetoothGattCharacteristic.PERMISSION_WRITE
      )
      svc.addCharacteristic(char)
      server.addService(svc)
      gattServer = server
      emit("BleGattServerStarted", Arguments.createMap())
    }
  }

  @ReactMethod fun stopGattServer() {
    gattServer?.close()
    gattServer = null
    emit("BleGattServerStopped", Arguments.createMap())
  }

  // ── GATT Client (central role) ────────────────────────────────────────────
  private val gattClients = mutableMapOf<String, BluetoothGatt>()
  private val writePending = mutableMapOf<String, Promise>() // address → pending promise

  @ReactMethod fun connectGatt(address: String) {
    val device = adapter()?.getRemoteDevice(address) ?: return
    val callback = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          gattClients[address] = gatt
          emit("BleGattConnected", Arguments.createMap().apply { putString("address", address) })
          gatt.requestMtu(512) // negotiate larger MTU before discovering services
        } else {
          gattClients.remove(address)
          gatt.close()
          emit("BleGattDisconnected", Arguments.createMap().apply { putString("address", address) })
        }
      }

      override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
        Log.d("BlinkBle", "onMtuChanged: mtu=$mtu status=$status for $address")
        emit("BleGattMtu", Arguments.createMap().apply { putString("address", address); putInt("mtu", mtu) })
        gatt.discoverServices()
      }
      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
        val hasBlink = gatt.getService(BLINK_SVC) != null
        Log.d("BlinkBle", "onServicesDiscovered: status=$status hasBlink=$hasBlink for $address")
        emit("BleGattServicesDiscovered", Arguments.createMap().apply {
          putString("address", address)
          putBoolean("hasBlinkService", hasBlink)
        })
      }
      override fun onCharacteristicWrite(gatt: BluetoothGatt, char: BluetoothGattCharacteristic, status: Int) {
        Log.d("BlinkBle", "onCharacteristicWrite: status=$status for $address")
        val pending = writePending.remove(address)
        if (status == BluetoothGatt.GATT_SUCCESS) pending?.resolve(true)
        else pending?.reject("WRITE_FAILED", "onCharacteristicWrite status=$status")
      }
    }
    val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
      device.connectGatt(reactContext, false, callback, BluetoothDevice.TRANSPORT_LE)
    else device.connectGatt(reactContext, false, callback)
    gattClients[address] = gatt
  }

  @ReactMethod fun writeGatt(address: String, data: String, promise: Promise) {
    val gatt = gattClients[address] ?: return promise.reject("NOT_CONNECTED", "Not connected to $address")
    val svc  = gatt.getService(BLINK_SVC)  ?: return promise.reject("NO_SERVICE",   "Blink service not found")
    val char = svc.getCharacteristic(BLINK_CHAR) ?: return promise.reject("NO_CHAR", "Blink characteristic not found")
    char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
    char.value = data.toByteArray(Charsets.UTF_8)
    writePending[address] = promise  // resolved in onCharacteristicWrite after server ACK
    val ok = gatt.writeCharacteristic(char)
    if (!ok) { writePending.remove(address); promise.reject("WRITE_FAILED", "writeCharacteristic returned false") }
    // If ok=true, promise resolves when onCharacteristicWrite fires (ensures serial writes)
  }

  @ReactMethod fun disconnectGatt(address: String) {
    gattClients[address]?.let { it.disconnect(); it.close() }
    gattClients.remove(address)
    emit("BleGattDisconnected", Arguments.createMap().apply { putString("address", address) })
  }

  @ReactMethod fun getState(promise: Promise) {
    promise.resolve(when (adapter()?.state) {
      BluetoothAdapter.STATE_ON  -> "PoweredOn"
      BluetoothAdapter.STATE_OFF -> "PoweredOff"
      else                       -> "Unknown"
    })
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  private fun adapter(): BluetoothAdapter? =
    (reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private fun emit(name: String, data: WritableMap) {
    main.post {
      try {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(name, data)
        Log.d("BlinkBle", "emitted: $name")
      } catch (e: Exception) {
        Log.e("BlinkBle", "emit failed for $name: ${e.message}")
      }
    }
  }
}
