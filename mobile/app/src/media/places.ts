import { formatPlace, placeKey, type Place } from '../core/photoMeta';
import type { PhotoLibrary } from './library';

/**
 * 照片地點 → 地名。只查「正在看的這張」和下一兩張，不批次查整個相簿：
 * - 座標轉地名用系統 Geocoder（Android／iOS 都會連到系統的地圖服務），iOS 有頻率限制
 * - 同一個地方（約 1 公里內）只查一次；同時間只送一個請求
 */
export class PlaceService {
  private byPhoto = new Map<string, Promise<string | null>>();
  private byKey = new Map<string, Promise<Place | null>>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private lib: Pick<PhotoLibrary, 'locations' | 'placeName'>, private homeCountry: string | null) {}

  label(photoId: string): Promise<string | null> {
    let p = this.byPhoto.get(photoId);
    if (!p) {
      p = this.resolve(photoId).catch(() => null);
      this.byPhoto.set(photoId, p);
    }
    return p;
  }

  private async resolve(photoId: string): Promise<string | null> {
    const [loc] = await this.lib.locations([photoId]);
    if (!loc) return null;
    const key = placeKey(loc.latitude, loc.longitude);
    let place = this.byKey.get(key);
    if (!place) {
      // 排隊：一次一個請求（iOS CLGeocoder 同時多個會被拒）
      place = this.chain.then(() => this.lib.placeName(loc.latitude, loc.longitude)).catch(() => null);
      this.chain = place;
      this.byKey.set(key, place);
    }
    return formatPlace(await place, this.homeCountry);
  }
}
