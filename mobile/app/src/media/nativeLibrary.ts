import { Linking, Platform } from 'react-native';
import * as ML from 'expo-media-library';
import { PhotoActions } from '../../modules/photo-actions';
import { photoAccessFrom } from '../core/photoAccess';
import type { Photo, TrashOutcome } from '../core/types';
import type { PhotoLibrary } from './library';

// 只要照片：不連影片／音訊一起要（Flutter 原型 BUG-001：要了 manifest 沒宣告的權限會永遠被判成「部分」）
const GRANULAR: ML.GranularPermission[] = ['photo'];

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
  };
}

const androidTrash = () => Platform.OS === 'android' && !!PhotoActions?.trashSupported();

export const nativeLibrary: PhotoLibrary = {
  check: async () => photoAccessFrom(await ML.getPermissionsAsync(false, GRANULAR)),
  request: async () => photoAccessFrom(await ML.requestPermissionsAsync(false, GRANULAR)),
  pickMore: () => ML.presentPermissionsPicker(['photo']),
  openSettings: () => Linking.openSettings(),

  async page(offset, limit) {
    const rows = await new ML.Query()
      .eq(ML.AssetField.MEDIA_TYPE, ML.MediaType.IMAGE)
      .orderBy({ key: ML.AssetField.CREATION_TIME, ascending: false })
      .limit(limit)
      .offset(offset)
      .exeForMetadata();
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
      return { status: /cancel|denied|grant/i.test(msg) ? 'cancelled' : 'failed', method, removedIds: [], error: msg };
    }
    // 成功也要對帳：Android 10 以下會逐張刪、錯誤被吞掉（architecture §4.1）
    const present = await this.stillPresent(ids);
    return { status: 'confirmed', method, removedIds: ids.filter((id) => !present.has(id)) };
  },

  uriFor: displayUri,
  trashMethod: () =>
    Platform.OS === 'ios'
      ? 'ios_recently_deleted'
      : androidTrash()
        ? 'android_trash'
        : 'android_legacy_delete',
  trashIsRecoverable: () => Platform.OS === 'ios' || androidTrash(),
};
