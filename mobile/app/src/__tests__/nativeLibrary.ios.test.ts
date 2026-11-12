/**
 * iOS 的刪除路徑（用假的 expo-media-library 跑；**不是**實機測試）。
 * 確認：一次刪除整批、按「不允許」顯示已取消、部分成功時依照片在不在對帳。
 * 實機上 PhotoKit 的錯誤訊息格式仍要在 iPhone 上確認（test-plan C／D 項）。
 */
const mockPresent = new Set<string>();
const mockDeleteCalls: string[][] = [];
let mockDeleteImpl: (ids: string[]) => Promise<void> = async (ids) => ids.forEach((id) => mockPresent.delete(id));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, Linking: { openSettings: jest.fn() } }));
jest.mock('../../modules/photo-actions', () => ({ PhotoActions: { trashSupported: () => false, fileSizes: async (ids: string[]) => ids.map(() => null) } }));
jest.mock('expo-media-library', () => {
  class Asset {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
    async getFilename() {
      if (!mockPresent.has(this.id)) throw new Error('Asset not found');
      return 'IMG.HEIC';
    }
    static async delete(assets: Asset[]) {
      mockDeleteCalls.push(assets.map((a) => a.id));
      await mockDeleteImpl(assets.map((a) => a.id));
    }
  }
  return { Asset, MediaType: { IMAGE: 'image', VIDEO: 'video' } };
});

import { isUserCancel, nativeLibrary } from '../media/nativeLibrary';

beforeEach(() => {
  mockPresent.clear();
  ['A/L0/001', 'B/L0/001', 'C/L0/001'].forEach((id) => mockPresent.add(id));
  mockDeleteCalls.length = 0;
  mockDeleteImpl = async (ids) => ids.forEach((id) => mockPresent.delete(id));
});

test('iOS：刪除方式是「最近刪除」、30 天可救回', () => {
  expect(nativeLibrary.trashMethod()).toBe('ios_recently_deleted');
  expect(nativeLibrary.trashIsRecoverable()).toBe(true);
});

test('iOS：照片網址用 ph://', () => {
  expect(nativeLibrary.uriFor('A/L0/001')).toBe('ph://A/L0/001');
  expect(nativeLibrary.uriFor('ph://A/L0/001')).toBe('ph://A/L0/001');
});

test('一次刪整批（系統只跳一次確認），刪完對帳全部移除', async () => {
  const r = await nativeLibrary.moveToTrash(['A/L0/001', 'B/L0/001']);
  expect(mockDeleteCalls).toEqual([['A/L0/001', 'B/L0/001']]);
  expect(r).toEqual({ status: 'confirmed', method: 'ios_recently_deleted', removedIds: ['A/L0/001', 'B/L0/001'] });
});

test('按「不允許」（PhotoKit 3072）→ 已取消，不是失敗', async () => {
  mockDeleteImpl = async () => {
    throw new Error('The operation couldn’t be completed. (PHPhotosErrorDomain error 3072.)');
  };
  const r = await nativeLibrary.moveToTrash(['A/L0/001']);
  expect(r.status).toBe('cancelled');
  expect(r.removedIds).toEqual([]);
});

test('其他錯誤 → 失敗，照片都還在', async () => {
  mockDeleteImpl = async () => {
    throw new Error('The operation couldn’t be completed. (PHPhotosErrorDomain error 3300.)');
  };
  const r = await nativeLibrary.moveToTrash(['A/L0/001']);
  expect(r).toMatchObject({ status: 'failed', removedIds: [] });
});

test('丟錯但其實刪掉了一部分：依照片在不在對帳', async () => {
  mockDeleteImpl = async () => {
    mockPresent.delete('A/L0/001');
    throw new Error('something odd');
  };
  const r = await nativeLibrary.moveToTrash(['A/L0/001', 'B/L0/001']);
  expect(r).toMatchObject({ status: 'confirmed', removedIds: ['A/L0/001'] });
});

test('isUserCancel', () => {
  expect(isUserCancel("User didn't grant write permission to requested files")).toBe(true);
  expect(isUserCancel('(PHPhotosErrorDomain error 3072.)')).toBe(true);
  expect(isUserCancel('User cancelled')).toBe(true);
  expect(isUserCancel('(PHPhotosErrorDomain error 3300.)')).toBe(false);
  expect(isUserCancel('error 30720')).toBe(false);
});
