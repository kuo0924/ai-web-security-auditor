/// App 垃圾桶裡的一筆紀錄。
///
/// 照片被移到系統垃圾桶後，Android 不允許再用一般查詢拿到它，
/// 所以這裡自己存一份縮圖路徑與基本資料，讓 App 垃圾桶還能顯示、還原。
enum TrashStatus {
  /// 只在 App 垃圾桶，系統相簿裡照片還在。可以直接還原。
  pending,

  /// 已移到手機系統的垃圾桶（Android「垃圾桶」／iOS「最近刪除」）。
  inSystemTrash,

  /// 舊版 Android（10 以下）沒有系統垃圾桶，已永久刪除。
  permanentlyDeleted,
}

class TrashItem {
  TrashItem({
    required this.id,
    required this.typeInt,
    required this.width,
    required this.height,
    required this.deletedAt,
    this.createdAt,
    this.thumbPath,
    this.status = TrashStatus.pending,
  });

  final String id;
  final int typeInt;
  final int width;
  final int height;
  final DateTime deletedAt;
  final DateTime? createdAt;
  String? thumbPath;
  TrashStatus status;

  Map<String, dynamic> toJson() => {
        'id': id,
        'typeInt': typeInt,
        'width': width,
        'height': height,
        'deletedAt': deletedAt.millisecondsSinceEpoch,
        'createdAt': createdAt?.millisecondsSinceEpoch,
        'thumbPath': thumbPath,
        'status': status.name,
      };

  factory TrashItem.fromJson(Map<String, dynamic> j) => TrashItem(
        id: j['id'] as String,
        typeInt: j['typeInt'] as int? ?? 1,
        width: j['width'] as int? ?? 0,
        height: j['height'] as int? ?? 0,
        deletedAt: DateTime.fromMillisecondsSinceEpoch(j['deletedAt'] as int),
        createdAt: j['createdAt'] == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(j['createdAt'] as int),
        thumbPath: j['thumbPath'] as String?,
        status: TrashStatus.values.firstWhere(
          (s) => s.name == j['status'],
          orElse: () => TrashStatus.pending,
        ),
      );
}

/// 最近一次滑動，給「復原」用。
enum SwipeAction { delete, keep }

class SwipeRecord {
  SwipeRecord(this.assetId, this.action);
  final String assetId;
  final SwipeAction action;
}
