package com.blink

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import java.util.UUID
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class BleModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "BleModule"

  private val BLINK_UUID = "0000b11c-0000-1000-8000-00805f9b34fb"
  private var scanning = false
  private var advertising = false

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
      advertising = true
      emit("BleAdvertiseStarted", Arguments.createMap())
    }
    override fun onStartFailure(errorCode: Int) {
      advertising = false
      emit("BleAdvertiseFailed", Arguments.createMap().apply { putInt("errorCode", errorCode) })
    }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val device = result.device
      val uuids = result.scanRecord?.serviceUuids
      val isBlinkPeer = uuids?.any { it.toString().lowercase() == BLINK_UUID } == true
      val map = Arguments.createMap().apply {
        putString("id", device.address)
        putString("name", device.name ?: "")
        putInt("rssi", result.rssi)
        putBoolean("isBlink", isBlinkPeer)
      }
      emit("BleDeviceFound", map)
    }

    override fun onScanFailed(errorCode: Int) {
      val map = Arguments.createMap().apply { putInt("errorCode", errorCode) }
      emit("BleScanFailed", map)
    }
  }

  @ReactMethod
  fun startScan() {
    val bm = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val adapter = bm?.adapter
    if (adapter == null || !adapter.isEnabled) {
      emit("BleScanFailed", Arguments.createMap().apply { putString("error", "Bluetooth not enabled") })
      return
    }
    val bleScanner = adapter.bluetoothLeScanner
    if (bleScanner == null) {
      emit("BleScanFailed", Arguments.createMap().apply { putString("error", "BLE scanner unavailable") })
      return
    }
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()
    bleScanner.startScan(null, settings, scanCallback)
    scanning = true
    emit("BleScanStarted", Arguments.createMap())
  }

  @ReactMethod
  fun stopScan() {
    val bm = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    bm?.adapter?.bluetoothLeScanner?.stopScan(scanCallback)
    scanning = false
    emit("BleScanStopped", Arguments.createMap())
  }

  @ReactMethod
  fun getState(promise: Promise) {
    val bm = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val state = when (bm?.adapter?.state) {
      BluetoothAdapter.STATE_ON  -> "PoweredOn"
      BluetoothAdapter.STATE_OFF -> "PoweredOff"
      else                       -> "Unknown"
    }
    promise.resolve(state)
  }

  @ReactMethod
  fun startAdvertise() {
    val bm = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val adapter = bm?.adapter
    if (adapter == null || !adapter.isEnabled) {
      emit("BleAdvertiseFailed", Arguments.createMap().apply { putString("error", "Bluetooth not enabled") })
      return
    }
    if (!adapter.isMultipleAdvertisementSupported) {
      emit("BleAdvertiseFailed", Arguments.createMap().apply { putString("error", "Advertising not supported on this device") })
      return
    }
    val advertiser = adapter.bluetoothLeAdvertiser
    if (advertiser == null) {
      emit("BleAdvertiseFailed", Arguments.createMap().apply { putString("error", "Advertiser unavailable") })
      return
    }
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(false)
      .build()
    val data = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(UUID.fromString(BLINK_UUID)))
      .setIncludeDeviceName(false)
      .build()
    advertiser.startAdvertising(settings, data, advertiseCallback)
  }

  @ReactMethod
  fun stopAdvertise() {
    val bm = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    bm?.adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
    advertising = false
    emit("BleAdvertiseStopped", Arguments.createMap())
  }

  // Required for RN event emitter
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  private fun emit(name: String, data: WritableMap) {
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      ?.emit(name, data)
  }
}
