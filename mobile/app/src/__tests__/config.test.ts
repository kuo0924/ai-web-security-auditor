/**
 * 設定一致性：App 向系統要的相簿權限，一定要都在 app.json 宣告過。
 * Flutter 原型的 BUG-001 就是「要了影片權限、manifest 卻沒宣告」→ 永遠被判成部分存取。
 */
jest.mock('react-native', () => ({ Platform: { OS: 'android' }, Linking: { openSettings: jest.fn() } }));
jest.mock('../../modules/photo-actions', () => ({ PhotoActions: null }));
jest.mock('expo-media-library', () => ({ MediaType: { IMAGE: 'image', VIDEO: 'video' } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const app = require('../../app.json');
import { GRANULAR } from '../media/nativeLibrary';

const MANIFEST_FOR: Record<string, string> = {
  photo: 'android.permission.READ_MEDIA_IMAGES',
  video: 'android.permission.READ_MEDIA_VIDEO',
  audio: 'android.permission.READ_MEDIA_AUDIO',
};

test('請求的每一種相簿權限，app.json 都有宣告、而且沒有被擋掉', () => {
  const declared: string[] = app.expo.android.permissions;
  const blocked: string[] = app.expo.android.blockedPermissions;
  for (const g of GRANULAR) {
    expect(declared).toContain(MANIFEST_FOR[g]);
    expect(blocked).not.toContain(MANIFEST_FOR[g]);
  }
});

test('不要音訊、不要定位、不要懸浮視窗', () => {
  expect(GRANULAR).not.toContain('audio');
  const blocked: string[] = app.expo.android.blockedPermissions;
  expect(blocked).toEqual(expect.arrayContaining(['android.permission.READ_MEDIA_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW']));
  const declared: string[] = app.expo.android.permissions;
  expect(declared.some((p) => /FINE_LOCATION|COARSE_LOCATION/.test(p))).toBe(false);
});

test('讀照片地點需要的 ACCESS_MEDIA_LOCATION 有宣告', () => {
  expect(app.expo.android.permissions).toContain('android.permission.ACCESS_MEDIA_LOCATION');
});
