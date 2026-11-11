import 'package:flutter_test/flutter_test.dart';
import 'package:swipe_clean/models.dart';

void main() {
  test('TrashItem 存檔再讀回來內容一致', () {
    final item = TrashItem(
      id: '1234',
      typeInt: 1,
      width: 4032,
      height: 3024,
      deletedAt: DateTime.fromMillisecondsSinceEpoch(1700000000000),
      createdAt: DateTime.fromMillisecondsSinceEpoch(1600000000000),
      thumbPath: '/tmp/a.jpg',
      status: TrashStatus.inSystemTrash,
    );
    final back = TrashItem.fromJson(item.toJson());
    expect(back.id, '1234');
    expect(back.width, 4032);
    expect(back.status, TrashStatus.inSystemTrash);
    expect(back.deletedAt, item.deletedAt);
    expect(back.createdAt, item.createdAt);
    expect(back.thumbPath, '/tmp/a.jpg');
  });

  test('未知狀態回到 pending，避免舊資料讓 App 當掉', () {
    final back = TrashItem.fromJson({
      'id': 'x',
      'deletedAt': 0,
      'status': 'somethingNew',
    });
    expect(back.status, TrashStatus.pending);
    expect(back.typeInt, 1);
  });
}
