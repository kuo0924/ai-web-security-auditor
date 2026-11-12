import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { estimateBytes, formatBytes } from '../core/format';
import type { SimilarGroupRow } from '../data/repo';
import { useSimilar } from '../state/AppProvider';
import { useTheme } from '../theme';
import { Button, EmptyState, Icon, ProgressBar, Text } from '../ui';

type Member = SimilarGroupRow['members'][number];

function timeLabel(ms: number | null): string {
  if (ms == null) return '沒有日期';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * S08 比較相似照片。這個畫面刻意沒有滑動手勢（fixes F6：比較時不能誤觸刪除）。
 * 點照片＝切換保留；預設只保留建議的那張。處理完自動跳到下一組。
 */
export default function SimilarScreen() {
  const t = useTheme('dark');
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { similar, state } = useSimilar();
  const params = useLocalSearchParams<{ group?: string }>();
  const [startId] = useState(params.group);
  const [index, setIndex] = useState(0);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState({ groups: 0, removed: 0, bytes: 0 });

  const groups = useMemo(() => {
    const gs = state?.groups ?? [];
    if (!startId) return gs;
    const i = gs.findIndex((g) => g.id === startId);
    return i <= 0 ? gs : [gs[i], ...gs.slice(0, i), ...gs.slice(i + 1)];
  }, [state?.groups, startId]);
  const group = groups[Math.min(index, Math.max(0, groups.length - 1))];

  // 換組時：預設只保留建議的那張
  useEffect(() => {
    if (group) setKeep(new Set([group.bestId]));
  }, [group?.id]);

  if (!similar || !state) return <View style={{ flex: 1, backgroundColor: t.color['photo-backdrop'] }} />;

  const analyzing = state.phase !== 'ready' && state.phase !== 'idle';
  const pct = state.total ? Math.round((state.hashed / state.total) * 100) : 0;

  const header = (
    <Stack.Screen
      options={{
        title: group ? `相似照片 ${Math.min(index, groups.length - 1) + 1} / ${groups.length}` : '相似照片',
        headerStyle: { backgroundColor: t.color['photo-backdrop'] },
        headerTintColor: t.color['on-photo'],
        contentStyle: { backgroundColor: t.color['photo-backdrop'] },
      }}
    />
  );

  if (!group) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.color['photo-backdrop'], padding: t.space[5] }}>
        {header}
        {analyzing ? (
          <View style={{ alignItems: 'center', gap: t.space[3] }}>
            <ActivityIndicator color={t.color['on-photo']} />
            <Text scheme="dark" variant="headline" accessibilityRole="header">正在找相似的照片…</Text>
            <Text scheme="dark" color="text-muted">已分析 {state.hashed} / {state.total} 張（{pct}%）。照片只在手機上分析。</Text>
            <View style={{ alignSelf: 'stretch' }}><ProgressBar value={state.hashed} total={state.total} scheme="dark" /></View>
          </View>
        ) : (
          <EmptyState
            scheme="dark"
            icon="check"
            title={done.groups ? '相似照片都處理完了' : '沒有找到相似的照片'}
            body={
              done.groups
                ? `處理了 ${done.groups} 組，${done.removed} 張移到封存區（約 ${formatBytes(done.bytes)}）。到封存區確認後再一起移除。`
                : '連拍、重拍的照片會出現在這裡。'
            }
            action={done.removed ? { label: '前往封存區', onPress: () => router.replace('/archive') } : { label: '回去整理', onPress: () => router.back() }}
          />
        )}
      </View>
    );
  }

  const removeCount = group.members.length - keep.size;
  const removeBytes = group.members
    .filter((m) => !keep.has(m.id))
    .reduce((s, m) => s + estimateBytes(m.width, m.height, m.mediaType), 0);
  const cols = group.members.length === 2 || width < 600 ? 2 : 3;
  const tile = (width - t.space[4] * 2 - t.space[2] * (cols - 1)) / cols;

  const toggle = (id: string) => {
    void Haptics.selectionAsync().catch(() => {});
    setKeep((k) => {
      const n = new Set(k);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // 處理完的組會從清單移除，所以 index 不用變，就會自動顯示下一組（fixes F6）
  const apply = async () => {
    if (!keep.size || busy) return;
    setBusy(true);
    try {
      await similar.resolve(group.id, [...keep]);
      setDone((d) => ({ groups: d.groups + 1, removed: d.removed + removeCount, bytes: d.bytes + removeBytes }));
    } finally {
      setBusy(false);
    }
  };

  const keepAll = async () => {
    setBusy(true);
    try {
      await similar.keepAll(group.id);
      setDone((d) => ({ ...d, groups: d.groups + 1 }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.color['photo-backdrop'] }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: t.space[4], gap: t.space[3], paddingBottom: 220 }}>
        <Text scheme="dark" color="text-muted" variant="footnote">
          點照片切換要不要保留。已幫你選了建議保留的那張。
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[2] }}>
          {group.members.map((m: Member) => {
            const on = keep.has(m.id);
            const best = m.id === group.bestId;
            return (
              <Pressable
                key={m.id}
                onPress={() => toggle(m.id)}
                accessibilityRole="togglebutton"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${best ? '建議保留，' : ''}${timeLabel(m.createdAt)} 拍的照片，${on ? '保留' : '移到封存區'}`}
                style={{ width: tile, gap: 6 }}
              >
                <View
                  style={{
                    height: tile * (4 / 3),
                    borderRadius: t.radius.md,
                    overflow: 'hidden',
                    borderWidth: 3,
                    borderColor: on ? t.color.keep : 'transparent',
                    opacity: on ? 1 : 0.55,
                  }}
                >
                  <Image source={{ uri: similar.uriFor(m.id) }} style={{ flex: 1 }} contentFit="cover" recyclingKey={m.id} />
                  <View style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.color.keep : 'rgba(0,0,0,0.5)' }}>
                    <Icon name={on ? 'check' : 'delete'} size={16} color={on ? 'on-keep' : 'on-photo'} scheme="dark" />
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {best ? (
                    <>
                      <Icon name="favorite" size={14} color="accent" scheme="dark" />
                      <Text scheme="dark" color="accent" variant="caption">建議保留</Text>
                    </>
                  ) : null}
                  <Text scheme="dark" color="text-muted" variant="caption">
                    {timeLabel(m.createdAt)}
                    {m.width && m.height ? ` · ${Math.round((m.width * m.height) / 1e6)}MP` : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: t.space[4], paddingBottom: insets.bottom + t.space[4], gap: t.space[2], backgroundColor: t.color['photo-backdrop'] }}>
        <Text scheme="dark" color="text-muted" variant="footnote" style={{ textAlign: 'center' }}>
          {keep.size === 0
            ? '至少要保留一張。全部都不要的話，回滑動畫面一張張往左滑。'
            : removeCount
              ? `保留 ${keep.size} 張，${removeCount} 張移到封存區（約 ${formatBytes(removeBytes)}）`
              : '全部保留'}
        </Text>
        <Button
          scheme="dark"
          variant={removeCount ? 'delete' : 'keep'}
          size="lg"
          label={removeCount ? `保留 ${keep.size} 張，其他移到封存區` : '保留全部，下一組'}
          disabled={keep.size === 0}
          loading={busy}
          onPress={removeCount ? apply : keepAll}
        />
        <View style={{ flexDirection: 'row', gap: t.space[2] }}>
          <View style={{ flex: 1 }}>
            <Button scheme="dark" variant="secondary" label="都保留" onPress={keepAll} disabled={busy} accessibilityHint="這組之後不會再出現" />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              scheme="dark"
              variant="ghost"
              label="稍後再看"
              disabled={busy || groups.length < 2}
              onPress={() => setIndex((i) => (i + 1) % groups.length)}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
