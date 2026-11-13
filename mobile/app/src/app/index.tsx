import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { prefetchTargets } from '../core/deck';
import { formatDuration, sectionKey, sectionLabel } from '../core/format';
import { formatShotDate } from '../core/photoMeta';
import type { Decision } from '../core/types';
import { usePlace, useSession, useSimilarGroups } from '../state/AppProvider';
import { useTheme } from '../theme';
import { EmptyState, GlassButton, Icon, ProgressBar, Segmented, Text } from '../ui';
import { ActionBar } from '../features/swipe/ActionBar';
import { DeniedView, PartialBanner } from '../features/swipe/PermissionViews';
import { NextCard, SwipeCard, type SwipeCardHandle } from '../features/swipe/SwipeCard';

const TOAST_MS = 4000;
const toastMeta: Record<Decision, { text: string; icon: 'keep' | 'delete' | 'hide'; role: 'keep' | 'delete' | 'hide' }> = {
  keep: { text: '已保留', icon: 'keep', role: 'keep' },
  delete: { text: '已移到封存區', icon: 'delete', role: 'delete' },
  hide: { text: '已隱藏', icon: 'hide', role: 'hide' },
};

/** 卡片底部「有 N 張相似 · 比較」，memo 起來：只有組數或組別變了才重繪 */
const SimilarChip = memo(function SimilarChip({ groupId, size }: { groupId: string; size: number }) {
  const t = useTheme('dark');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="這張有相似的照片，打開比較"
      onPress={() => router.push({ pathname: '/similar', params: { group: groupId } })}
      hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.overlay.glass, borderColor: t.overlay['glass-border'], borderWidth: 1, borderRadius: t.radius.pill, paddingHorizontal: t.space[3], paddingVertical: 6 }}
    >
      <Icon name="compare" size={14} color="on-photo" scheme="dark" />
      <Text variant="caption" scheme="dark" color="on-photo">
        有 {size} 張相似 · 比較
      </Text>
    </Pressable>
  );
});

/** S06 滑動整理（含 S02 權限狀態） */
export default function SwipeScreen() {
  const t = useTheme('dark');
  const insets = useSafeAreaInsets();
  const { ctrl, state } = useSession();
  const { similar, groupOf, groups } = useSimilarGroups();
  const card = useRef<SwipeCardHandle>(null);
  const [toast, setToast] = useState<Decision | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  // 預先載入接下來 5 張的縮圖，滑起來不會等（尤其是 iCloud 照片）
  const topId = state?.deck.queue[0]?.id;
  useEffect(() => {
    const urls = state ? prefetchTargets(state.deck.queue) : [];
    if (urls.length) void Image.prefetch(urls, 'memory-disk').catch(() => {});
  }, [topId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDecide = useCallback(
    (d: Decision) => {
      if (!ctrl) return;
      similar?.hold();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      void ctrl.decide(d);
      setToast(d);
    },
    [ctrl, similar],
  );
  // 手指一碰到卡片，背景分析就先讓開
  const onTouch = useCallback(() => similar?.hold(), [similar]);
  const onThreshold = useCallback(() => void Haptics.selectionAsync().catch(() => {}), []);
  const place = usePlace(state?.deck.queue[0], state?.deck.queue.slice(1) ?? []);
  // footer 元素要穩定，SwipeCard 的 memo 才有效（地名非同步回來時，卡片不會在拖曳中重繪）
  const topPhotoId = state?.deck.queue[0]?.id;
  const groupId = topPhotoId ? groupOf[topPhotoId] : undefined;
  const groupSize = groupId ? (groups.find((g) => g.id === groupId)?.members.length ?? 0) : 0;
  const footer = useMemo(() => (groupId ? <SimilarChip groupId={groupId} size={groupSize} /> : undefined), [groupId, groupSize]);

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

  const [top, next, third] = state.deck.queue;
  const done = state.deck.counts.keep + state.deck.counts.delete + state.deck.counts.hide;
  const remaining = state.deck.queue.length;
  const shot = formatShotDate(top?.createdAt ?? null);

  return (
    <View style={{ flex: 1, backgroundColor: t.color['photo-backdrop'], paddingTop: insets.top + t.space[2] }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* 上方：左右兩顆半透明圓鈕，中間是這張照片的拍攝日期、時間、地點 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.space[4], gap: t.space[3] }}>
        <GlassButton icon="compare" label={`相似照片，${groups.length} 組`} badge={groups.length} onPress={() => router.push('/similar')} />
        <View
          style={{ flex: 1, alignItems: 'center', gap: 2 }}
          accessible
          accessibilityRole="header"
          accessibilityLabel={top ? `${shot.date} ${shot.time}${place ? `，${place}` : ''}` : '整理相簿'}
        >
          <Text variant="headline" scheme="dark" color="on-photo" numberOfLines={1}>
            {top ? shot.date : '整理相簿'}
          </Text>
          <Text variant="footnote" scheme="dark" color="text-muted" numberOfLines={1}>
            {top ? [shot.time, place].filter(Boolean).join(' · ') : '往右留、往左刪、往上藏'}
          </Text>
        </View>
        <GlassButton icon="trash-bin" label={`封存區，${state.archiveCount} 張`} badge={state.archiveCount} onPress={() => router.push('/archive')} />
      </View>
      {/* 全部／只看影片（最長的先，最快清出空間） */}
      <View style={{ paddingTop: t.space[3] }}>
        <Segmented
          value={state.filter}
          onChange={(f) => {
            similar?.hold();
            void ctrl.setFilter(f);
          }}
          options={[
            { value: 'all', label: '全部', icon: 'photo' },
            { value: 'videos', label: '影片 · 大的先', icon: 'video' },
          ]}
        />
      </View>
      {/* 進度：這次整理了幾張（知道總數時顯示進度條） */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space[3], paddingHorizontal: t.space[5], paddingTop: t.space[3] }}>
        <View style={{ flex: 1 }}>
          {state.exhausted && remaining + done > 0 ? <ProgressBar value={done} total={done + remaining} scheme="dark" /> : null}
        </View>
        {done ? (
          <Text variant="caption" scheme="dark" color="text-muted">
            已整理 {done} 張{state.exhausted && remaining ? ` · 剩 ${remaining}` : ''}
          </Text>
        ) : null}
      </View>

      {state.access === 'partial' ? (
        <View style={{ paddingHorizontal: t.space[4], paddingTop: t.space[3] }}>
          <PartialBanner ctrl={ctrl} />
        </View>
      ) : null}

      {/* 卡片區：左右留邊（避開 Android 返回手勢），底部留空間給後面那疊牌 */}
      <View style={{ flex: 1, marginHorizontal: t.swipe['edge-inset'], marginTop: t.space[5], marginBottom: t.space[7] }}>
        {top ? (
          <>
            {third ? <NextCard photo={third} depth={2} /> : null}
            {next ? <NextCard photo={next} depth={1} /> : null}
            <SwipeCard
              key={top.id}
              ref={card}
              photo={top}
              label={`${top.mediaType === 'video' ? `影片 ${formatDuration(top.durationMs)}` : '照片'}，${sectionLabel(sectionKey(top.createdAt))}`}
              onDecide={onDecide}
              onThreshold={onThreshold}
              onTouch={onTouch}
              footer={footer}
            />
          </>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              scheme="dark"
              icon="check"
              title={state.exhausted ? (state.filter === 'videos' ? '影片都整理完了' : '全部整理完了') : '載入中…'}
              body={state.exhausted ? `封存區有 ${state.archiveCount} 張等你確認。` : undefined}
              action={state.archiveCount ? { label: '前往封存區', onPress: () => router.push('/archive') } : undefined}
            />
          </View>
        )}
      </View>

      {/* 復原提示 */}
      <View style={{ height: 44, justifyContent: 'center', alignItems: 'center' }} accessibilityLiveRegion="polite">
        {toast ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space[2], backgroundColor: t.color['surface-raised'], borderRadius: t.radius.pill, paddingLeft: t.space[3], paddingRight: 4, height: 40, borderWidth: 1, borderColor: t.overlay['glass-border'] }}>
            <Icon name={toastMeta[toast].icon} size={16} color={toastMeta[toast].role} scheme="dark" />
            <Text variant="body-sm" scheme="dark">{toastMeta[toast].text}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="復原"
              onPress={() => {
                void ctrl.undo();
                setToast(null);
              }}
              style={{ backgroundColor: t.color.surface, borderRadius: t.radius.pill, paddingHorizontal: t.space[3], height: 32, justifyContent: 'center' }}
            >
              <Text variant="footnote" scheme="dark" color="accent" style={{ fontWeight: '700' }}>復原</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={{ paddingTop: t.space[2], paddingBottom: insets.bottom + t.space[4] }}>
        <ActionBar
          actions={[
            { icon: 'delete', label: '刪除', a11y: '刪除這張照片', role: 'delete', big: true, disabled: !top, onPress: () => card.current?.fly('delete') },
            { icon: 'hide', label: '隱藏', a11y: '隱藏這張照片', role: 'hide', disabled: !top, onPress: () => card.current?.fly('hide') },
            { icon: 'undo', label: '復原', a11y: '復原上一張', role: 'text', disabled: !state.deck.history.length, onPress: () => void ctrl.undo() },
            { icon: 'keep', label: '保留', a11y: '保留這張照片', role: 'keep', big: true, disabled: !top, onPress: () => card.current?.fly('keep') },
          ]}
        />
      </View>
    </View>
  );
}
