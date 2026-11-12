package tw.photoswipe.photoactions

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult.Companion.ACTION_INTENT_SENDER_REQUEST
import androidx.activity.result.contract.ActivityResultContracts.StartIntentSenderForResult.Companion.EXTRA_INTENT_SENDER_REQUEST
import androidx.annotation.RequiresApi
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

/** 傳字串而不是 Uri：輸入要能 Serializable。 */
data class TrashInput(val uris: List<String>, val trashed: Boolean) : Serializable

/**
 * MediaStore.createTrashRequest：系統跳一次確認，使用者允許後整批進系統垃圾桶（30 天後自動清除）。
 * trashed = false 是從垃圾桶救回。
 */
class TrashContract(private val resolver: () -> ContentResolver) : AppContextActivityResultContract<TrashInput, Boolean> {
  @RequiresApi(Build.VERSION_CODES.R)
  override fun createIntent(context: Context, input: TrashInput): Intent {
    val request = MediaStore.createTrashRequest(resolver(), input.uris.map(Uri::parse), input.trashed)
    val senderRequest = IntentSenderRequest.Builder(request.intentSender).build()
    return Intent(ACTION_INTENT_SENDER_REQUEST).putExtra(EXTRA_INTENT_SENDER_REQUEST, senderRequest)
  }

  override fun parseResult(input: TrashInput, resultCode: Int, intent: Intent?): Boolean =
    resultCode == Activity.RESULT_OK
}
