import 'package:flutter/material.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:photo_manager_image_provider/photo_manager_image_provider.dart';

import '../app_store.dart';

/// 右滑保存過的照片。照片本來就在相簿裡，這裡只是記住「已看過、要留」，
/// 之後就不會再出現在滑動清單。長按可以取消保存，讓它重新出現。
class KeptScreen extends StatelessWidget {
  const KeptScreen({super.key, required this.store});
  final AppStore store;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final ids = store.keptIds.toList().reversed.toList();
        return Scaffold(
          appBar: AppBar(
            title: Text('已保存（${ids.length}）'),
            actions: [
              if (ids.isNotEmpty)
                IconButton(
                  tooltip: '全部重新整理',
                  icon: const Icon(Icons.restart_alt),
                  onPressed: () async {
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (ctx) => AlertDialog(
                        title: const Text('清空保存紀錄？'),
                        content: const Text('照片不會被刪除，只是會重新出現在滑動清單裡。'),
                        actions: [
                          TextButton(
                              onPressed: () => Navigator.pop(ctx, false),
                              child: const Text('取消')),
                          FilledButton(
                              onPressed: () => Navigator.pop(ctx, true),
                              child: const Text('清空')),
                        ],
                      ),
                    );
                    if (ok == true) await store.resetKept();
                  },
                ),
            ],
          ),
          body: ids.isEmpty
              ? const Center(child: Text('還沒有保存的照片\n在主畫面往右滑就會保存', textAlign: TextAlign.center))
              : GridView.builder(
                  padding: const EdgeInsets.all(8),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    mainAxisSpacing: 4,
                    crossAxisSpacing: 4,
                  ),
                  itemCount: ids.length,
                  itemBuilder: (context, i) => _KeptTile(id: ids[i], store: store),
                ),
        );
      },
    );
  }
}

class _KeptTile extends StatelessWidget {
  const _KeptTile({required this.id, required this.store});
  final String id;
  final AppStore store;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<AssetEntity?>(
      future: AssetEntity.fromId(id),
      builder: (context, snap) {
        final asset = snap.data;
        return GestureDetector(
          onLongPress: () async {
            await store.unkeep(id);
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('已取消保存，照片會回到滑動清單')),
              );
            }
          },
          child: ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: asset == null
                ? ColoredBox(
                    color: Colors.black12,
                    child: snap.connectionState == ConnectionState.done
                        ? const Icon(Icons.image_not_supported_outlined)
                        : null,
                  )
                : AssetEntityImage(
                    asset,
                    isOriginal: false,
                    thumbnailSize: const ThumbnailSize.square(300),
                    fit: BoxFit.cover,
                  ),
          ),
        );
      },
    );
  }
}
