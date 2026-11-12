import 'package:flutter/material.dart';

import 'app_store.dart';
import 'screens/swipe_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = AppStore();
  runApp(SwipeCleanApp(store: store));
  await store.init();
}

class SwipeCleanApp extends StatefulWidget {
  const SwipeCleanApp({super.key, required this.store});
  final AppStore store;

  @override
  State<SwipeCleanApp> createState() => _SwipeCleanAppState();
}

class _SwipeCleanAppState extends State<SwipeCleanApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// 從系統相簿或設定切回來時重新讀取，同步使用者在外面做的變更。
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final s = widget.store;
    if (state == AppLifecycleState.resumed) s.onResume();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '滑滑整理',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      darkTheme: ThemeData(
        colorSchemeSeed: Colors.indigo,
        brightness: Brightness.dark,
        useMaterial3: true,
      ),
      home: SwipeScreen(store: widget.store),
    );
  }
}
