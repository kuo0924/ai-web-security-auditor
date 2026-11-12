import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { Stack, router } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { formatBytes } from '../core/format';
import type { ArchiveItem } from '../data/repo';
import type { EmptyResult } from '../state/session';
import { useSession } from '../state/AppProvider';
import { useTheme } from '../theme';
import { Button, CountUp, EmptyState, Icon, Sheet, Text } from '../ui';

const GAP = 6;

/** S09 封存區 → S10 系統確認 → S11 釋放空間 */
export default function ArchiveScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { ctrl, state } = useSession();
  const [items, setItems] = useState<ArchiveItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; bytes: number } | null>(null);
  const [result, setResult] = useState<EmptyResult | null>(null);
  const cols = width >= 700 ? 5 : 3;
  const pad = t.space[4];
  const size = (width - pad * 2 - GAP * (cols - 1)) / cols;

  const load = useCallback(async () => {
    if (!ctrl) return;
    const list = await ctrl.archiveItems();
    setItems(list);
    // 打開時量一次真實檔案大小（Android 準確；iOS 拿不到就用解析度估算），總數才準
    if (list.length) {
      await ctrl.measure(list.map((i) => i.asset_id));
      setItems(await ctrl.archiveItems());
    }
  }, [ctrl]);
  useEffect(() => {
    void load();
  }, [load, state?.archiveCount]);

  const totalBytes = useMemo(() => (items ?? []).reduce((s, i) => s + (i.byte_size ?? 0), 0), [items]);
  const selectedBytes = useMemo(() => (items ?? []).filter((i) => selected.has(i.asset_id)).reduce((s, i) => s + (i.byte_size ?? 0), 0), [items, selected]);
  const targetIds = useMemo(() => (selected.size ? [...selected] : (items ?? []).map((i) => i.asset_id)), [selected, items]);
  const targetBytes = selected.size ? selectedBytes : totalBytes;

  if (!ctrl || !items) return <View style={{ flex: 1, backgroundColor: t.color.bg }} />;
  const recoverable = ctrl.trashIsRecoverable();

  const toggle = (id: string) => {
    void Haptics.selectionAsync().catch(() => {});
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const askEmpty = async () => {
    const bytes = await ctrl.measure(targetIds);
    setConfirm({ ids: targetIds, bytes });
  };

  const doEmpty = async () => {
    if (!confirm) return;
    const ids = confirm.ids;
    setConfirm(null);
    const r = await ctrl.emptyArchive(ids);
    setSelected(new Set());
    await load();
    if (r.removed > 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setResult(r);
  };

  const summary = (
    <View style={{ backgroundColor: t.color.surface, borderRadius: t.radius.lg, padding: t.space[5], gap: t.space[2], marginBottom: t.space[3] }}>
      <Text variant="footnote" color="text-muted">{selected.size ? `已選 ${selected.size} 張` : `${items.length} 張等你確認`}</Text>
      <Text variant="large-title" accessibilityRole="header">約 {formatBytes(targetBytes)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space[2] }}>
        <Icon name={recoverable ? 'restore' : 'info'} size={16} color="text-muted" />
        <Text variant="footnote" color="text-muted" style={{ flex: 1 }}>
          {recoverable
            ? `照片還在相簿裡。移除後會進${Platform.OS === 'ios' ? '「最近刪除」' : '手機的垃圾桶'}，30 天內都能救回。`
            : '照片還在相簿裡。這支手機沒有垃圾桶，移除後無法救回。'}
        </Text>
      </View>
      <Text variant="caption" color="text-muted">點照片可以只處理其中幾張；不選就是全部。</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.color.bg }}>
      <Stack.Screen options={{ title: '封存區', headerShown: true, headerShadowVisible: false }} />
      {items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState icon="trash-bin" title="封存區是空的" body="在整理畫面往左滑的照片會先放在這裡，確認後再一起移除。" action={{ label: '回去整理', onPress: () => router.back() }} />
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(i) => i.asset_id}
            numColumns={cols}
            key={cols}
            ListHeaderComponent={summary}
            contentContainerStyle={{ padding: pad, paddingBottom: 200 }}
            columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
            renderItem={({ item }) => {
              const on = selected.has(item.asset_id);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.media_type === 'video' ? '影片' : '照片'}，約 ${formatBytes(item.byte_size ?? 0)}`}
                  accessibilityState={{ selected: on }}
                  onPress={() => toggle(item.asset_id)}
                  style={{ width: size, height: size, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: t.color.surface }}
                >
                  <Image source={{ uri: ctrl.uriFor(item.asset_id) }} style={{ flex: 1 }} contentFit="cover" recyclingKey={item.asset_id} transition={100} />
                  {on ? (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 3, borderColor: t.color.accent, borderRadius: t.radius.md, backgroundColor: t.overlay.dim, alignItems: 'flex-end', padding: 6 }}>
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: t.color.accent, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="check" size={14} color="on-accent" />
                      </View>
                    </View>
                  ) : null}
                </Pressable>
              );
            }}
          />
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: pad, paddingBottom: insets.bottom + pad, gap: t.space[2], backgroundColor: t.color.bg, borderTopWidth: 1, borderTopColor: t.color.border }}>
            <Button
              label={`移除 ${targetIds.length} 張 · 約 ${formatBytes(targetBytes)}`}
              variant="delete"
              size="lg"
              icon="delete"
              loading={state?.busy}
              onPress={askEmpty}
              accessibilityHint="會先問你確認，接著系統會再確認一次"
            />
            {selected.size ? (
              <Button label={`還原 ${selected.size} 張`} variant="secondary" icon="restore" onPress={async () => { await ctrl.restore([...selected]); setSelected(new Set()); await load(); }} />
            ) : null}
          </View>
        </>
      )}

      {/* S10 前的 App 內確認：系統視窗只寫「允許刪除 N 張？」，先講清楚（fixes F4） */}
      <Sheet visible={!!confirm} onClose={() => setConfirm(null)} title={confirm ? `移除 ${confirm.ids.length} 張照片？` : ''}>
        <Text>
          約 {formatBytes(confirm?.bytes ?? 0)}。
          {recoverable
            ? Platform.OS === 'ios'
              ? '照片會移到「照片」App 的「最近刪除」，30 天內都能救回。'
              : '照片會移到手機的垃圾桶，30 天內都能救回。'
            : '這支手機的系統沒有垃圾桶，照片會被永久刪除，無法救回。'}
        </Text>
        <Text variant="footnote" color="text-muted">接下來系統會再跳一次確認，請按「允許」。</Text>
        <Button label={recoverable ? '移除' : '永久刪除'} variant="delete" onPress={doEmpty} />
        <Button label="取消" variant="ghost" onPress={() => setConfirm(null)} />
      </Sheet>

      {/* S11 結果：寫「約」和「將釋放」，不寫「已釋放」（architecture §4.4） */}
      <Sheet visible={!!result} onClose={() => setResult(null)}>
        {result && result.removed > 0 ? (
          <View style={{ alignItems: 'center', gap: t.space[2], paddingTop: t.space[2] }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.color.keep, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={30} color="on-keep" />
            </View>
            <Text variant="footnote" color="text-muted">移除了 {result.removed} 張照片，約可釋放</Text>
            <CountUp value={result.bytes} format={(n) => formatBytes(n)} />
            <Text variant="body-sm" color="text-muted" style={{ textAlign: 'center' }}>
              {result.recoverable ? '照片會在垃圾桶放 30 天，在那之前都能救回；之後空間才會真正釋放。' : '空間已經釋放。'}
            </Text>
            {result.removed < result.requested ? (
              <Text variant="footnote" color="text-muted" style={{ textAlign: 'center' }}>
                還有 {result.requested - result.removed} 張沒有移除，仍留在封存區。
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: t.space[2] }}>
            <Text variant="title" accessibilityRole="header">{result?.outcome === 'failed' ? '沒有移除成功' : '已取消'}</Text>
            <Text color="text-muted">照片都還在封存區，什麼都沒有被刪除。</Text>
          </View>
        )}
        <Button label="繼續整理" onPress={() => { setResult(null); router.back(); }} />
      </Sheet>
    </View>
  );
}
