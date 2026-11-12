import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:swipe_clean/app_store.dart';
import 'package:swipe_clean/permissions.dart';
import 'package:swipe_clean/screens/swipe_screen.dart';

/// 假的權限來源：用 [state] 模擬使用者在系統設定裡改了什麼。
class FakePermissions implements PhotoPermissions {
  FakePermissions(this.state);

  PhotoAccess state;
  int checks = 0;
  int requests = 0;
  int picks = 0;
  int settingsOpened = 0;

  @override
  Future<PhotoAccess> check() async {
    checks++;
    return state;
  }

  @override
  Future<PhotoAccess> request() async {
    requests++;
    return state;
  }

  @override
  Future<void> pickMore() async => picks++;

  @override
  Future<void> openSettings() async => settingsOpened++;
}

AppStore storeWith(FakePermissions perms) =>
    AppStore(permissions: perms, loadPaths: () async => <AssetPathEntity>[]);

Future<void> pumpSwipeScreen(WidgetTester tester, AppStore store) async {
  await tester.pumpWidget(MaterialApp(home: SwipeScreen(store: store)));
  await tester.pumpAndSettle();
}

void main() {
  group('photoAccessFrom：系統狀態只對應到三種', () {
    test('authorized → full', () {
      expect(photoAccessFrom(PermissionState.authorized), PhotoAccess.full);
    });
    test('limited → partial', () {
      expect(photoAccessFrom(PermissionState.limited), PhotoAccess.partial);
    });
    test('denied / restricted / notDetermined → denied', () {
      for (final s in [
        PermissionState.denied,
        PermissionState.restricted,
        PermissionState.notDetermined,
      ]) {
        expect(photoAccessFrom(s), PhotoAccess.denied, reason: '$s');
      }
    });
  });

  group('BUG-001 改成完整權限後，「部分照片」提示仍一直顯示', () {
    test('只請求照片權限：沒宣告 READ_MEDIA_VIDEO 時連影片一起要，會永遠被判成部分存取', () {
      expect(photoPermissionOption.androidPermission.type, RequestType.image);
    });

    test('部分 → 到設定改成全部 → 按「重新讀取相簿」：要變成完整權限', () async {
      final perms = FakePermissions(PhotoAccess.partial);
      final store = storeWith(perms);
      await store.requestPermissionAndLoad();
      expect(store.access, PhotoAccess.partial);

      perms.state = PhotoAccess.full; // 使用者在系統設定改成「一律允許全部」
      await store.reload();

      expect(store.access, PhotoAccess.full);
    });

    test('回到前景時要重新檢查權限（不能跳視窗，只能檢查）', () async {
      final perms = FakePermissions(PhotoAccess.partial);
      final store = storeWith(perms);
      await store.requestPermissionAndLoad();
      final requestsBefore = perms.requests;

      perms.state = PhotoAccess.full;
      await store.onResume();

      expect(store.access, PhotoAccess.full);
      expect(perms.requests, requestsBefore, reason: '回到前景只能 check，不能再跳權限視窗');
    });

    test('完全拒絕 → 到設定開啟 → 回到前景：要讀得到照片', () async {
      final perms = FakePermissions(PhotoAccess.denied);
      final store = storeWith(perms);
      await store.requestPermissionAndLoad();
      expect(store.access, PhotoAccess.denied);

      perms.state = PhotoAccess.full;
      await store.onResume();

      expect(store.access, PhotoAccess.full);
    });

    test('完整 → 到設定關掉權限 → 回到前景：要變成拒絕，清空待整理的照片', () async {
      final perms = FakePermissions(PhotoAccess.full);
      final store = storeWith(perms);
      await store.requestPermissionAndLoad();

      perms.state = PhotoAccess.denied;
      await store.onResume();

      expect(store.access, PhotoAccess.denied);
      expect(store.queue, isEmpty);
    });

    testWidgets('完整權限時不顯示「部分照片」提示', (tester) async {
      final store = storeWith(FakePermissions(PhotoAccess.full));
      await store.requestPermissionAndLoad();
      await pumpSwipeScreen(tester, store);

      expect(find.textContaining('部分照片'), findsNothing);
    });

    testWidgets('部分 → 改成全部 → 回到前景：提示要消失', (tester) async {
      final perms = FakePermissions(PhotoAccess.partial);
      final store = storeWith(perms);
      await store.requestPermissionAndLoad();
      await pumpSwipeScreen(tester, store);
      expect(find.text('目前只允許讀取部分照片'), findsOneWidget);

      perms.state = PhotoAccess.full;
      await store.onResume();
      await tester.pumpAndSettle();

      expect(find.text('目前只允許讀取部分照片'), findsNothing);
    });
  });

  group('BUG-002「選更多」無法升級成完整權限', () {
    Future<FakePermissions> openChooser(WidgetTester tester) async {
      final perms = FakePermissions(PhotoAccess.partial);
      final store = storeWith(perms);
      await store.requestPermissionAndLoad();
      await pumpSwipeScreen(tester, store);
      await tester.tap(find.text('選更多'));
      await tester.pumpAndSettle();
      return perms;
    }

    testWidgets('點「選更多」出現兩個選項和一句說明', (tester) async {
      await openChooser(tester);

      expect(find.text('再多選幾張'), findsOneWidget);
      expect(find.text('允許存取全部照片'), findsOneWidget);
      expect(find.textContaining('重複和相似的照片'), findsOneWidget);
    });

    testWidgets('「允許存取全部照片」→ 開這個 App 的系統設定頁', (tester) async {
      final perms = await openChooser(tester);
      await tester.tap(find.text('允許存取全部照片'));
      await tester.pumpAndSettle();

      expect(perms.settingsOpened, 1);
      expect(perms.picks, 0);
    });

    testWidgets('「再多選幾張」→ 開系統照片選擇器', (tester) async {
      final perms = await openChooser(tester);
      await tester.tap(find.text('再多選幾張'));
      await tester.pumpAndSettle();

      expect(perms.picks, 1);
      expect(perms.settingsOpened, 0);
    });
  });

  group('完全拒絕權限的畫面', () {
    testWidgets('顯示說明和「前往設定」按鈕', (tester) async {
      final perms = FakePermissions(PhotoAccess.denied);
      final store = storeWith(perms);
      await store.requestPermissionAndLoad();
      await pumpSwipeScreen(tester, store);

      expect(find.textContaining('需要相簿權限'), findsOneWidget);
      await tester.tap(find.text('前往設定'));
      await tester.pumpAndSettle();
      expect(perms.settingsOpened, 1);
    });
  });
}
