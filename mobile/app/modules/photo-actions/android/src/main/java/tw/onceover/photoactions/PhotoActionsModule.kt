package tw.onceover.photoactions

import android.content.ContentResolver
import android.location.Geocoder
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import android.os.Build
import android.provider.MediaStore
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class UnsupportedException : CodedException("ERR_TRASH_UNSUPPORTED", "System trash needs Android 11 (API 30) or newer", null)

class PhotoActionsModule : Module() {
  private lateinit var trashLauncher: AppContextActivityResultLauncher<TrashInput, Boolean>

  private val resolver: ContentResolver
    get() = appContext.reactContext?.contentResolver ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PhotoActions")

    Function("trashSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
    }

    AsyncFunction("trash") Coroutine { uris: List<String> ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) throw UnsupportedException()
      if (uris.isEmpty()) return@Coroutine true
      trashLauncher.launch(TrashInput(uris, trashed = true))
    }

    AsyncFunction("fileSizes") Coroutine { uris: List<String> ->
      withContext(Dispatchers.IO) {
        uris.map { querySize(Uri.parse(it)) }
      }
    }

    // 照片拍攝地點（EXIF GPS）。Android 10+ 一定要 setRequireOriginal，否則系統會把 GPS 抹掉；
    // 這需要 ACCESS_MEDIA_LOCATION（跟相簿權限一起請求，沒有另外的視窗）。拿不到就是 null。
    AsyncFunction("locations") Coroutine { uris: List<String> ->
      withContext(Dispatchers.IO) {
        uris.map { readLocation(Uri.parse(it)) }
      }
    }

    // 座標 → 地名。用系統的 Geocoder，不需要定位權限。
    AsyncFunction("placeName") Coroutine { latitude: Double, longitude: Double ->
      reverseGeocode(latitude, longitude)
    }

    RegisterActivityContracts {
      trashLauncher = registerForActivityResult(TrashContract { resolver })
    }
  }

  private fun readLocation(uri: Uri): Map<String, Double>? = try {
    val original = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.setRequireOriginal(uri) else uri
    resolver.openInputStream(original)?.use { stream ->
      ExifInterface(stream).latLong?.let { (lat, lng) ->
        if (lat == 0.0 && lng == 0.0) null else mapOf("latitude" to lat, "longitude" to lng)
      }
    }
  } catch (e: Exception) {
    null // 沒有 ACCESS_MEDIA_LOCATION（SecurityException）、檔案壞掉、不是 JPEG/HEIC
  }

  private suspend fun reverseGeocode(lat: Double, lng: Double): Map<String, String?>? {
    val context = appContext.reactContext ?: return null
    if (!Geocoder.isPresent()) return null
    val geocoder = Geocoder(context, Locale.getDefault())
    val address = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        suspendCancellableCoroutine { cont ->
          geocoder.getFromLocation(lat, lng, 1, object : Geocoder.GeocodeListener {
            override fun onGeocode(addresses: MutableList<android.location.Address>) { cont.resume(addresses.firstOrNull()) }
            override fun onError(errorMessage: String?) { cont.resume(null) }
          })
        }
      } else {
        withContext(Dispatchers.IO) {
          @Suppress("DEPRECATION")
          geocoder.getFromLocation(lat, lng, 1)?.firstOrNull()
        }
      }
    } catch (e: Exception) {
      null // 沒有網路、Geocoder 服務不可用
    } ?: return null
    return mapOf(
      "city" to (address.locality ?: address.subAdminArea ?: address.adminArea),
      "district" to address.subLocality,
      "region" to address.adminArea,
      "country" to address.countryName,
      "isoCountryCode" to address.countryCode,
    )
  }

  private fun querySize(uri: Uri): Double? = try {
    resolver.query(uri, arrayOf(MediaStore.MediaColumns.SIZE), null, null, null)?.use { c ->
      if (c.moveToFirst() && !c.isNull(0)) c.getLong(0).toDouble() else null
    }
  } catch (e: Exception) {
    null
  }
}
