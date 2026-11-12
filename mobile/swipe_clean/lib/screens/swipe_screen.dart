import 'package:flutter/material.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:photo_manager_image_provider/photo_manager_image_provider.dart';

import '../app_store.dart';
import '../widgets/swipe_card.dart';
import 'kept_screen.dart';
import 'trash_screen.dart';

class SwipeScreen extends StatefulWidget {
  const SwipeScreen({super.key, required this.store});
  final AppStore store;

  @override
  State<SwipeScreen> createState() => _SwipeScreenState();
}

class _SwipeScreenState extends State<SwipeScreen> {
  final _topCard = GlobalKey<SwipeCardState>();
  AppStore get store => widget.store;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final pending = store.pendingTrash.length;
        return Scaffold(
          appBar: AppBar(
            title: const Text('滑滑整理'),
            actions: [
              IconButton(
                tooltip: '已保存',
                icon: Badge(
                  isLabelVisible: store.keptIds.isNotEmpty,
                  label: Text('${store.keptIds.length}'),
                  child: const Icon(Icons.favorite_outline),
                ),
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => KeptScreen(store: store)),
                ),
              ),
              IconButton(
                tooltip: '垃圾桶',
                icon: Badge(
                  isLabelVisible: pending > 0,
                  label: Text('$pending'),
                  child: const Icon(Icons.delete_outline),
                ),
                onPressed: _openTrash,
              ),
            ],
          ),
          body: SafeArea(child: _body(context)),
        );
      },
    );
  }

  void _openTrash() => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => TrashScreen(store: store)),
      );

  Widget _body(BuildContext context) {
    if (store.loading) {
      return const Center(child: CircularProgressIndicator());
    }
    final perm = store.permission;
    if (perm == null || !perm.hasAccess) {
      return _PermissionView(store: store);
    }

    final pending = store.pendingTrash.length;
    return Column(
      children: [
        if (pending > 0)
          MaterialBanner(
            padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
            leading: const Icon(Icons.delete_sweep_outlined),
            content: Text('App 垃圾桶有 $pending 張，還沒移到手機的垃圾桶'),
            actions: [
              TextButton(onPressed: _openTrash, child: const Text('查看')),
              FilledButton.tonal(
                onPressed: _moveAllToSystemTrash,
                child: const Text('全部移過去'),
              ),
            ],
          ),
        if (perm == PermissionState.limited)
          ListTile(
            dense: true,
            leading: const Icon(Icons.info_outline),
            title: const Text('目前只允許讀取部分照片'),
            trailing: TextButton(
              onPressed: () async {
                await PhotoManager.presentLimited();
                await store.reload();
              },
              child: const Text('選更多'),
            ),
          ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Text(
            '← 左滑刪除　　右滑保存 →',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: store.queue.isEmpty ? _DoneView(store: store) : _cardStack(),
          ),
        ),
        _actionBar(),
      ],
    );
  }

  Widget _cardStack() {
    final top = store.queue.first;
    final next = store.queue.length > 1 ? store.queue[1] : null;
    return Stack(
      fit: StackFit.expand,
      children: [
        // 下一張先墊在後面，滑走時就不會閃一下
        if (next != null)
          Transform.scale(
            scale: 0.94,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: ColoredBox(
                color: Colors.black,
                child: AssetEntityImage(
                  next,
                  isOriginal: false,
                  thumbnailSize: const ThumbnailSize.square(1200),
                  fit: BoxFit.contain,
                ),
              ),
            ),
          ),
        SwipeCard(
          key: _topCard,
          asset: top,
          onSwipeRight: () => store.keep(top),
          onSwipeLeft: () => _delete(top),
        ),
      ],
    );
  }

  Widget _actionBar() {
    final hasCard = store.queue.isNotEmpty;
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _RoundButton(
            icon: Icons.delete,
            color: Colors.red,
            label: '刪除',
            onTap: hasCard ? () => _topCard.currentState?.swipeLeft() : null,
          ),
          _RoundButton(
            icon: Icons.undo,
            color: Colors.blueGrey,
            label: '復原',
            small: true,
            onTap: store.canUndo ? store.undo : null,
          ),
          _RoundButton(
            icon: Icons.favorite,
            color: Colors.green,
            label: '保存',
            onTap: hasCard ? () => _topCard.currentState?.swipeRight() : null,
          ),
        ],
      ),
    );
  }

  Future<void> _delete(AssetEntity asset) async {
    await store.delete(asset);
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        duration: const Duration(seconds: 2),
        content: const Text('已移到 App 垃圾桶'),
        action: SnackBarAction(label: '復原', onPressed: store.undo),
      ));
  }

  Future<void> _moveAllToSystemTrash() async {
    final r = await store.moveToSystemTrash(store.pendingTrash);
    if (!mounted) return;
    showSystemTrashResult(context, r);
  }
}

/// 共用：顯示「移到系統垃圾桶」的結果。
void showSystemTrashResult(BuildContext context, SystemTrashOutcome r) {
  final String msg;
  if (r.requested == 0) {
    msg = '沒有需要移動的照片';
  } else if (r.moved == 0) {
    msg = '已取消，照片仍留在 App 垃圾桶';
  } else if (r.permanent) {
    msg = '已永久刪除 ${r.moved} 張（這台手機的系統沒有垃圾桶）';
  } else {
    msg = '已把 ${r.moved} 張移到手機的垃圾桶，30 天內都能救回';
  }
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(msg)));
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({
    required this.icon,
    required this.color,
    required this.label,
    required this.onTap,
    this.small = false,
  });

  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback? onTap;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final size = small ? 52.0 : 68.0;
    final enabled = onTap != null;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          shape: const CircleBorder(),
          elevation: enabled ? 3 : 0,
          color: Theme.of(context).colorScheme.surface,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: size,
              height: size,
              child: Icon(
                icon,
                size: size * 0.48,
                color: enabled ? color : Colors.grey.shade400,
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(label, style: Theme.of(context).textTheme.labelSmall),
      ],
    );
  }
}

class _PermissionView extends StatelessWidget {
  const _PermissionView({required this.store});
  final AppStore store;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.photo_library_outlined, size: 72),
            const SizedBox(height: 16),
            const Text(
              '需要相簿權限才能整理照片',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              '照片只會在你的手機上處理，不會上傳到任何地方。',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: store.requestPermissionAndLoad,
              child: const Text('允許存取相簿'),
            ),
            TextButton(
              onPressed: PhotoManager.openSetting,
              child: const Text('到系統設定開啟'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DoneView extends StatelessWidget {
  const _DoneView({required this.store});
  final AppStore store;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.celebration_outlined, size: 72),
          const SizedBox(height: 16),
          Text(
            store.totalPhotos == 0 ? '相簿裡沒有照片' : '全部整理完了！',
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text('已保存 ${store.keptIds.length} 張・垃圾桶 ${store.trash.length} 張'),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: store.reload,
            icon: const Icon(Icons.refresh),
            label: const Text('重新讀取相簿'),
          ),
        ],
      ),
    );
  }
}
