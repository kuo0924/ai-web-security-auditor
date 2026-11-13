import { Linking, Platform } from 'react-native';
import * as ML from 'expo-media-library';
import { PhotoActions } from '../../modules/photo-actions';
import { photoAccessFrom } from '../core/photoAccess';
import type { Photo, TrashOutcome } from '../core/types';
import type { PhotoLibrary } from './library';

// 照片＋影片（不要音訊）。這份清單一定要跟 app.json 宣告的權限一致（READ_MEDIA_IMAGES／READ_MEDIA_VIDEO），
// 不然會重演 Flutter 原型 BUG-001：要了沒宣告的權限，永遠被判成「部分存取」。測試 config.test.ts 會檢查。
export const GRANULAR: ML.GranularPermission[] = ['photo', 'video'];

/**
 * 使用者在系統刪除視窗按了取消／不允許。
 * - Android（expo-media-library）：PermissionsException「User didn't grant write permission…」
 * - iOS：PhotoKit 的 userCancelled，錯誤碼 3072。訊息通常是
 *   「The operation couldn’t be completed. (PHPhotosErrorDomain error 3072.)」，裡面沒有 "cancel" 這個字。
 */
export function isUserCancel(message: string): boolean {
  return /cancel|denied|grant|\b3072\b/i.test(message);
}

function displayUri(id: string): string {
  if (Platform.OS === 'ios') return id.startsWith('ph://') ? id : `ph://${id}`;
  return id; // Android 的 ID 本身就是 content:// 網址
}

function toPhoto(m: ML.AssetMetadata): Photo {
  return {
    id: m.id,
    uri: displayUri(m.id),
    width: m.width ?? null,
    height: m.height ?? null,
    createdAt: m.creationTime ?? null,
    mediaType: m.mediaType === ML.MediaType.VIDEO ? 'video' : 'image',
    durationMs: m.mediaType === ML.MediaType.VIDEO ? (m.duration ?? null) : null,
  };
}

const androidTrash = () => Platform.OS === 'android' && !!PhotoActions?.trashSupported();

export const nativeLibrary: PhotoLibrary = {
  check: async () => photoAccessFrom(await ML.getPermissionsAsync(false, GRANULAR)),
  request: async () => photoAccessFrom(await ML.requestPermissionsAsync(false, GRANULAR)),
  pickMore: () => ML.presentPermissionsPicker(['photo', 'video']),
  openSettings: () => Linking.openSettings(),

  async page(offset, limit, filter = 'all') {
    const q =
      filter === 'videos'
        ? new ML.Query().eq(ML.AssetField.MEDIA_TYPE, ML.MediaType.VIDEO).orderBy({ key: ML.AssetField.DURATION, ascending: false })
        : new ML.Query()
            .within(ML.AssetField.MEDIA_TYPE, [ML.MediaType.IMAGE, ML.MediaType.VIDEO])
            .orderBy({ key: ML.AssetField.CREATION_TIME, ascending: false });
    const rows = await q.limit(limit).offset(offset).exeForMetadata();
    return rows.map(toPhoto);
  },

  async stillPresent(ids) {
    const present = new Set<string>();
    await Promise.all(
      ids.map(async (id) => {
        try {
          await new ML.Asset(id).getFilename();
          present.add(id);
        } catch {
          // 讀不到就是不在了
        }
      }),
    );
    return present;
  },

  async fileSizes(ids) {
    const sizes = (await PhotoActions?.fileSizes(ids)) ?? ids.map(() => null);
    return Object.fromEntries(ids.map((id, i) => [id, sizes[i] ?? null]));
  },

  async moveToTrash(ids): Promise<TrashOutcome> {
    const method = this.trashMethod();
    try {
      if (method === 'android_trash') {
        const ok = await PhotoActions!.trash(ids);
        if (!ok) return { status: 'cancelled', method, removedIds: [] };
      } else {
        await ML.Asset.delete(ids.map((id) => new ML.Asset(id)));
      }
    } catch (e) {
      // iOS 按「不允許」、Android 10 權限問題都會走到這裡；先對帳再決定是取消還是失敗
      const present = await this.stillPresent(ids);
      const removedIds = ids.filter((id) => !present.has(id));
      const msg = e instanceof Error ? e.message : String(e);
      if (removedIds.length) return { status: 'confirmed', method, removedIds, error: msg };
      return { status: isUserCancel(msg) ? 'cancelled' : 'failed', method, removedIds: [], error: msg };
    }
    // 成功也要對帳：Android 10 以下會逐張刪、錯誤被吞掉（architecture §4.1）
    const present = await this.stillPresent(ids);
    return { status: 'confirmed', method, removedIds: ids.filter((id) => !present.has(id)) };
  },

  uriFor: displayUri,
  async locations(ids) {
    if (!PhotoActions) return ids.map(() => null);
    try {
      return await PhotoActions.locations(ids);
    } catch {
      return ids.map(() => null);
    }
  },
  async placeName(latitude, longitude) {
    try {
      return (await PhotoActions?.placeName(latitude, longitude)) ?? null;
    } catch {
      return null;
    }
  },
  trashMethod: () =>
    Platform.OS === 'ios'
      ? 'ios_recently_deleted'
      : androidTrash()
        ? 'android_trash'
        : 'android_legacy_delete',
  trashIsRecoverable: () => Platform.OS === 'ios' || androidTrash(),
};
