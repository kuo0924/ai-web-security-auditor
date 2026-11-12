import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { sectionLabel, sectionKey } from '../core/format';
import type { Decision } from '../core/types';
import { useSession } from '../state/AppProvider';
import { useTheme } from '../theme';
import { Badge, Button, EmptyState, IconButton, Text } from '../ui';
import { DeniedView, PartialBanner } from '../features/swipe/PermissionViews';
import { NextCard, SwipeCard, type SwipeCardHandle } from '../features/swipe/SwipeCard';

const TOAST_MS = 4000;
const toastText: Record<Decision, string> = { keep: '已保留', delete: '已移到封存區', hide: '已隱藏' };

/** S06 滑動整理（含 S02 權限狀態） */
export default function SwipeScreen() {
  const t = useTheme('dark');
  const insets = useSafeAreaInsets();
  const { ctrl, state } = useSession();
  const card = useRef<SwipeCardHandle>(null);
  const [toast, setToast] = useState<Decision | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const onDecide = useCallback(
    (d: Decision) => {
      if (!ctrl) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      void ctrl.decide(d);
      setToast(d);
    },
    [ctrl],
  );

  if (!ctrl || !state || state.phase === 'starting') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color['photo-backdrop'] }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={t.color['on-photo']} />
      </View>
    );
  }

  if (state.access === 'denied') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DeniedView ctrl={ctrl} />
      </>
    );
  }

  const [top, next] = state.deck.queue;
  const done = state.deck.counts.keep + state.deck.counts.delete + state.deck.counts.hide;
  const remaining = state.deck.queue.length;

  return (
    <View style={{ flex: 1, backgroundColor: t.color['photo-backdrop'], paddingTop: insets.top + t.space[2] }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* ProgressHeader */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.space[4], gap: t.space[3] }}>
        <View style={{ flex: 1 }}>
          <Text variant="headline" scheme="dark" color="on-photo" accessibilityRole="header">
            {top ? sectionLabel(sectionKey(top.createdAt)) : '整理相簿'}
          </Text>
          <Text variant="footnote" scheme="dark" color="text-muted">
            這次已整理 {done} 張{state.exhausted ? ` · 還剩 ${remaining} 張` : ''}
          </Text>
        </View>
        <View>
          <IconButton
            icon="trash-bin"
            variant="overlay"
            scheme="dark"
            label={`封存區，${state.archiveCount} 張`}
            onPress={() => router.push('/archive')}
          />
          <View style={{ position: 'absolute', top: -4, right: -6 }} pointerEvents="none">
            <Badge count={state.archiveCount} scheme="dark" />
          </View>
        </View>
      </View>

      {state.access === 'partial' ? (
        <View style={{ paddingHorizontal: t.space[4], paddingTop: t.space[3] }}>
          <PartialBanner ctrl={ctrl} />
        </View>
      ) : null}

      {/* 卡片區：左右留邊，避開 Android 返回手勢 */}
      <View style={{ flex: 1, marginHorizontal: t.swipe['edge-inset'], marginVertical: t.space[4] }}>
        {top ? (
          <>
            {next ? <NextCard photo={next} /> : null}
            <SwipeCard
              key={top.id}
              ref={card}
              photo={top}
              label={`照片，${sectionLabel(sectionKey(top.createdAt))}`}
              onDecide={onDecide}
              onThreshold={() => void Haptics.selectionAsync().catch(() => {})}
            />
          </>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              scheme="dark"
              icon="check"
              title={state.exhausted ? '全部整理完了' : '載入中…'}
              body={state.exhausted ? `封存區有 ${state.archiveCount} 張等你確認。` : undefined}
              action={state.archiveCount ? { label: '前往封存區', onPress: () => router.push('/archive') } : undefined}
            />
          </View>
        )}
      </View>

      {/* Undo toast */}
      <View style={{ height: 44, justifyContent: 'center', paddingHorizontal: t.space[4] }} accessibilityLiveRegion="polite">
        {toast ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: t.space[3], backgroundColor: t.color.surface, borderRadius: t.radius.pill, paddingLeft: t.space[4], paddingRight: t.space[2], height: 40 }}>
            <Text variant="body-sm" scheme="dark">{toastText[toast]}</Text>
            <Button label="復原" variant="ghost" scheme="dark" onPress={() => { void ctrl.undo(); setToast(null); }} />
          </View>
        ) : null}
      </View>

      {/* ActionBar：刪除（左）· 隱藏 · 復原 · 保留（右），跟手勢方向一致 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', paddingBottom: insets.bottom + t.space[4], paddingTop: t.space[2] }}>
        <IconButton icon="delete" label="刪除這張照片" variant="tinted" role="delete" size={64} scheme="dark" disabled={!top} onPress={() => card.current?.fly('delete')} />
        <IconButton icon="hide" label="隱藏這張照片" variant="tinted" role="hide" scheme="dark" disabled={!top} onPress={() => card.current?.fly('hide')} />
        <IconButton icon="undo" label="復原上一張" scheme="dark" disabled={!state.deck.history.length} onPress={() => void ctrl.undo()} />
        <IconButton icon="keep" label="保留這張照片" variant="tinted" role="keep" size={64} scheme="dark" disabled={!top} onPress={() => card.current?.fly('keep')} />
      </View>
    </View>
  );
}
