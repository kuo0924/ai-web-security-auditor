import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:photo_manager_image_provider/photo_manager_image_provider.dart';

/// 可以拖曳的照片卡片。
///
/// 往右滑 → [onSwipeRight]（刪除），往左滑 → [onSwipeLeft]（保存）。
class SwipeCard extends StatefulWidget {
  const SwipeCard({
    super.key,
    required this.asset,
    required this.onSwipeRight,
    required this.onSwipeLeft,
  });

  final AssetEntity asset;
  final VoidCallback onSwipeRight;
  final VoidCallback onSwipeLeft;

  @override
  State<SwipeCard> createState() => SwipeCardState();
}

class SwipeCardState extends State<SwipeCard>
    with SingleTickerProviderStateMixin {
  Offset _drag = Offset.zero;
  late final AnimationController _anim;
  Animation<Offset>? _flyTo;
  bool _flying = false;

  @override
  void initState() {
    super.initState();
    _anim = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 220),
    )..addListener(() {
        if (_flyTo != null) setState(() => _drag = _flyTo!.value);
      });
  }

  /// 外面用同一個 GlobalKey 換下一張照片時，把位置歸零。
  @override
  void didUpdateWidget(covariant SwipeCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.asset.id != widget.asset.id) {
      _anim.stop();
      _flyTo = null;
      _flying = false;
      _drag = Offset.zero;
    }
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  /// 給下方按鈕用：用動畫把卡片丟出去。
  void swipeRight() => _fly(toRight: true);
  void swipeLeft() => _fly(toRight: false);

  Future<void> _fly({required bool toRight}) async {
    if (_flying) return;
    _flying = true;
    final width = MediaQuery.of(context).size.width;
    _flyTo = Tween<Offset>(
      begin: _drag,
      end: Offset((toRight ? 1 : -1) * width * 1.5, _drag.dy + 40),
    ).animate(CurvedAnimation(parent: _anim, curve: Curves.easeIn));
    await _anim.forward(from: 0);
    if (!mounted) return;
    toRight ? widget.onSwipeRight() : widget.onSwipeLeft();
  }

  Future<void> _snapBack() async {
    _flyTo = Tween<Offset>(begin: _drag, end: Offset.zero)
        .animate(CurvedAnimation(parent: _anim, curve: Curves.easeOutBack));
    await _anim.forward(from: 0);
    _flyTo = null;
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    final threshold = width * 0.28;
    final progress = (_drag.dx / threshold).clamp(-1.0, 1.0);
    final angle = progress * 0.25; // 最多約 14 度

    return GestureDetector(
      onPanUpdate: _flying
          ? null
          : (d) {
              _anim.stop();
              setState(() => _drag += d.delta);
            },
      onPanEnd: _flying
          ? null
          : (d) {
              final vx = d.velocity.pixelsPerSecond.dx;
              if (_drag.dx > threshold || vx > 900) {
                _fly(toRight: true);
              } else if (_drag.dx < -threshold || vx < -900) {
                _fly(toRight: false);
              } else {
                _snapBack();
              }
            },
      child: Transform.translate(
        offset: _drag,
        child: Transform.rotate(
          angle: angle,
          child: Stack(
            fit: StackFit.expand,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(20),
                child: DecoratedBox(
                  decoration: const BoxDecoration(color: Colors.black),
                  child: AssetEntityImage(
                    widget.asset,
                    isOriginal: false,
                    thumbnailSize: const ThumbnailSize.square(1200),
                    fit: BoxFit.contain,
                    errorBuilder: (_, _, _) => const Center(
                      child: Icon(Icons.broken_image, color: Colors.white54, size: 64),
                    ),
                  ),
                ),
              ),
              // 右滑：紅色「刪除」
              if (progress > 0)
                _Stamp(
                  opacity: progress,
                  color: Colors.redAccent,
                  label: '刪除',
                  icon: Icons.delete_outline,
                  alignment: Alignment.topLeft,
                  angle: -0.3,
                ),
              // 左滑：綠色「保存」
              if (progress < 0)
                _Stamp(
                  opacity: -progress,
                  color: Colors.greenAccent.shade700,
                  label: '保存',
                  icon: Icons.favorite_border,
                  alignment: Alignment.topRight,
                  angle: 0.3,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Stamp extends StatelessWidget {
  const _Stamp({
    required this.opacity,
    required this.color,
    required this.label,
    required this.icon,
    required this.alignment,
    required this.angle,
  });

  final double opacity;
  final Color color;
  final String label;
  final IconData icon;
  final Alignment alignment;
  final double angle;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Stack(
        fit: StackFit.expand,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: ColoredBox(color: color.withValues(alpha: 0.18 * opacity)),
          ),
          Align(
            alignment: alignment,
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Opacity(
                opacity: math.min(1, opacity * 1.3),
                child: Transform.rotate(
                  angle: angle,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    decoration: BoxDecoration(
                      border: Border.all(color: color, width: 4),
                      borderRadius: BorderRadius.circular(10),
                      color: Colors.black26,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(icon, color: color, size: 30),
                        const SizedBox(width: 6),
                        Text(
                          label,
                          style: TextStyle(
                            color: color,
                            fontSize: 30,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
