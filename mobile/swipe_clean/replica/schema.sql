-- 本機資料庫（expo-sqlite），第一個 migration。
-- 沒有後端、沒有帳號：資料只存在這支手機的 App 沙盒裡，App 被移除時一併清除。
--
-- 跟伺服器版 schema 不同的地方（刻意的）：
-- * 主鍵用「系統相簿的資產 ID」（Android MediaStore _ID／iOS PHAsset localIdentifier），
--   不另外產生 uuid。這個 ID 本來就是唯一的，用它當主鍵可以避免對應表。
-- * 沒有 user_id：只有一個使用者，就是手機主人。存取控制靠作業系統的 App 沙盒。
-- * 時間一律存「UTC 毫秒」INTEGER（SQLite 沒有 timestamptz）。只有 daily_quota.day 用使用者當地日期。
-- * 不存錢：訂閱狀態以 RevenueCat SDK 的快取為準，不自己記帳。

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- 系統相簿的鏡像索引。用來算分區進度、排程雜湊，不用每次都問系統相簿。
CREATE TABLE assets (
  asset_id          TEXT PRIMARY KEY,                -- Android: MediaStore _ID；iOS: localIdentifier
  media_type        TEXT NOT NULL CHECK (media_type IN ('image','video')),
  is_screenshot     INTEGER NOT NULL DEFAULT 0,      -- iOS: mediaSubtypes；Android: 從檔名／路徑推測
  is_live_photo     INTEGER NOT NULL DEFAULT 0,      -- 只有 iOS
  is_in_cloud       INTEGER NOT NULL DEFAULT 0,      -- 只有 iOS（原檔只在 iCloud）
  width             INTEGER,
  height            INTEGER,
  duration_ms       INTEGER,
  created_at        INTEGER,                         -- 拍攝時間（UTC ms），可能是 NULL
  modified_at       INTEGER,                         -- 編輯過就會變，用來讓雜湊失效
  section_key       TEXT NOT NULL,                   -- 'YYYY-MM'（依使用者時區算），沒有拍攝時間就是 'unknown'
  byte_size         INTEGER,                         -- 可能拿不到，見 architecture.md
  first_seen_at     INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  missing_since     INTEGER                          -- 系統相簿裡找不到了（被別的 App 刪掉）
);
CREATE INDEX assets_section ON assets (section_key, created_at);
CREATE INDEX assets_created ON assets (created_at);
CREATE INDEX assets_missing ON assets (missing_since);

-- 每張照片的決定：右滑保留、左滑封存、往上滑隱藏。一張照片最多一筆。
CREATE TABLE decisions (
  asset_id     TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
  decision     TEXT NOT NULL CHECK (decision IN ('keep','archive','hide')),
  source       TEXT NOT NULL CHECK (source IN ('swipe','compare','bulk')),
  section_key  TEXT NOT NULL,
  decided_at   INTEGER NOT NULL
);
CREATE INDEX decisions_section ON decisions (section_key, decision);
CREATE INDEX decisions_decided ON decisions (decided_at);

-- 一次「清空封存區」的請求。系統確認視窗一次對應一批。
CREATE TABLE delete_batches (
  id               TEXT PRIMARY KEY,                 -- uuid（JS 端產生）
  method           TEXT NOT NULL CHECK (method IN (
                     'ios_recently_deleted',         -- PHAssetChangeRequest.deleteAssets
                     'android_trash',                -- MediaStore.createTrashRequest（自訂原生模組）
                     'android_delete',               -- MediaStore.createDeleteRequest（expo-media-library，永久）
                     'android_legacy_delete'         -- Android 10 以下，沒有確認視窗，永久
                   )),
  requested_count  INTEGER NOT NULL CHECK (requested_count > 0),
  confirmed_count  INTEGER NOT NULL DEFAULT 0,
  bytes_estimate   INTEGER,                          -- 這批預計釋放多少
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','cancelled','failed','partial')),
  error            TEXT,
  created_at       INTEGER NOT NULL,
  finished_at      INTEGER
);
CREATE INDEX delete_batches_created ON delete_batches (created_at);

-- 封存區。decision = 'archive' 就有一筆；送出刪除後狀態跟著改。
CREATE TABLE archive_items (
  asset_id         TEXT PRIMARY KEY,                 -- 不設 FK：照片從系統刪掉後，assets 那列會被清掉，這裡還要留紀錄
  archived_at      INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'archived'
                     CHECK (status IN ('archived','deleting','deleted','trashed','restored','missing')),
  byte_size        INTEGER,
  thumb_path       TEXT,                             -- App 自己存的小縮圖：照片進系統垃圾桶後就讀不到了
  media_type       TEXT NOT NULL CHECK (media_type IN ('image','video')),
  delete_batch_id  TEXT REFERENCES delete_batches(id) ON DELETE SET NULL,
  finished_at      INTEGER                           -- 刪除／進垃圾桶的時間；超過 40 天的紀錄可以清掉
);
CREATE INDEX archive_status ON archive_items (status, archived_at);
CREATE INDEX archive_batch ON archive_items (delete_batch_id);

-- 感知雜湊。照片編輯過（modified_at 變了）就重算。
CREATE TABLE photo_hashes (
  asset_id      TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
  algo          TEXT NOT NULL CHECK (algo IN ('phash64_v1')),   -- 演算法換版就換名字，舊的重算
  phash         TEXT,                               -- 64 bit，16 個 hex 字元
  dhash         TEXT,                               -- 64 bit，16 個 hex 字元，第二道確認
  source_mtime  INTEGER,                            -- 算雜湊時的 modified_at
  computed_at   INTEGER NOT NULL,
  error         TEXT,                               -- 讀不到（iCloud 沒下載、檔案壞掉）
  attempts      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX photo_hashes_error ON photo_hashes (error);

-- 相似照片組。一組 = 時間相近、雜湊距離小的一串照片。
CREATE TABLE similar_groups (
  id             TEXT PRIMARY KEY,                  -- uuid
  window_start   INTEGER NOT NULL,                  -- 組內最早的拍攝時間
  window_end     INTEGER NOT NULL,
  size           INTEGER NOT NULL CHECK (size >= 2),
  best_asset_id  TEXT,                              -- 使用者選的那張（或建議的那張）
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','resolved','dismissed','stale')),
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER
);
CREATE INDEX similar_groups_status ON similar_groups (status, window_start);

CREATE TABLE similar_group_members (
  group_id   TEXT NOT NULL REFERENCES similar_groups(id) ON DELETE CASCADE,
  asset_id   TEXT NOT NULL REFERENCES assets(asset_id) ON DELETE CASCADE,
  distance   INTEGER NOT NULL CHECK (distance BETWEEN 0 AND 64),  -- 跟組內代表照片的 Hamming 距離
  PRIMARY KEY (group_id, asset_id)
);
CREATE INDEX similar_members_asset ON similar_group_members (asset_id);

-- 復原紀錄。只留最近 50 筆。
CREATE TABLE undo_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT NOT NULL CHECK (action IN ('decide','undecide','restore','compare_resolve','hide','unhide')),
  asset_ids   TEXT NOT NULL,                        -- JSON array
  before      TEXT NOT NULL,                        -- JSON：動作前的狀態
  created_at  INTEGER NOT NULL
);

-- 隱藏的照片（往上滑）。兩個平台存法完全不同：
-- * iOS：照片留在系統相簿，只是設成 isHidden，進系統「已隱藏」相簿。asset_id 不變。
-- * Android：系統沒有隱藏相簿，檔案搬進 App 私有空間（vault），再從系統相簿刪掉原檔。
--   搬回相簿時會產生「新的」MediaStore ID，記在 restored_asset_id。
CREATE TABLE hidden_items (
  asset_id                TEXT PRIMARY KEY,         -- 隱藏前的 ID。不設 FK：Android 搬走後 assets 那列會不見
  store                   TEXT NOT NULL CHECK (store IN ('ios_hidden','android_vault')),
  status                  TEXT NOT NULL DEFAULT 'hiding'
                            CHECK (status IN ('hiding','hidden','restoring','restored','failed','lost')),
  media_type              TEXT NOT NULL CHECK (media_type IN ('image','video')),
  -- 以下只有 android_vault 用得到：搬回相簿時要還原檔名、資料夾、拍攝時間
  vault_path              TEXT,                     -- App 私有空間裡的相對路徑，例如 'vault/4f1c….jpg'
  original_display_name   TEXT,
  original_relative_path  TEXT,                     -- 例如 'DCIM/Camera/'
  mime_type               TEXT,
  date_taken              INTEGER,                  -- UTC ms
  byte_size               INTEGER,
  sha256                  TEXT,                     -- 複製後比對，確定檔案完整才刪原檔
  thumb_path              TEXT,                     -- 上鎖相簿的格狀縮圖（也放在私有空間）
  hidden_at               INTEGER NOT NULL,
  restored_at             INTEGER,
  restored_asset_id       TEXT                      -- 搬回相簿後的新 ID（Android）
);
CREATE INDEX hidden_status ON hidden_items (status, hidden_at);

-- 每日免費額度。以使用者「當地日期」為鍵；換時區當天不重複發放。
CREATE TABLE daily_quota (
  day    TEXT PRIMARY KEY,                          -- 'YYYY-MM-DD'（當地時間）
  used   INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  bonus  INTEGER NOT NULL DEFAULT 0 CHECK (bonus >= 0)
);

-- Android 雙擊加最愛：先排隊，之後一次送出（見 architecture.md）。
CREATE TABLE pending_favorites (
  asset_id    TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
  favorite    INTEGER NOT NULL CHECK (favorite IN (0,1)),
  queued_at   INTEGER NOT NULL
);

-- 設定與小型狀態（滑動方向、onboarding 是否完成、上次同步時間…）。
CREATE TABLE app_kv (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
