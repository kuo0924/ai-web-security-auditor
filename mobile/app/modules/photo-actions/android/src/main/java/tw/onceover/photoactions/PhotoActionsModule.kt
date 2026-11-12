package tw.onceover.photoactions

import android.content.ContentResolver
import android.net.Uri
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

    RegisterActivityContracts {
      trashLauncher = registerForActivityResult(TrashContract { resolver })
    }
  }

  private fun querySize(uri: Uri): Double? = try {
    resolver.query(uri, arrayOf(MediaStore.MediaColumns.SIZE), null, null, null)?.use { c ->
      if (c.moveToFirst() && !c.isNull(0)) c.getLong(0).toDouble() else null
    }
  } catch (e: Exception) {
    null
  }
}
