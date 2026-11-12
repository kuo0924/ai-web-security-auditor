import { ScrollView, View, useWindowDimensions } from 'react-native';
import { makeTheme, tokens, type ColorRole } from '../theme';
import {
  Badge, Button, DecisionStamp, EmptyState, ICON_NAMES, Icon, IconButton, ProgressBar, Text,
} from '../ui';

/** 開發用：所有基本元件在淺色、深色各畫一次。這一頁就是設計系統的檢查。 */
export default function DesignSystem() {
  const { width } = useWindowDimensions();
  const twoCols = width >= 900;
  return (
    <ScrollView contentContainerStyle={{ flexDirection: twoCols ? 'row' : 'column' }}>
      <Panel scheme="light" />
      <Panel scheme="dark" />
    </ScrollView>
  );
}

function Panel({ scheme }: { scheme: 'light' | 'dark' }) {
  const t = makeTheme(scheme);
  const roles = Object.keys(tokens.color) as ColorRole[];
  return (
    <View style={{ flex: 1, backgroundColor: t.color.bg, padding: 20, gap: 20 }} testID={`panel-${scheme}`}>
      <Text variant="large-title" scheme={scheme} accessibilityRole="header">
        {scheme === 'light' ? '淺色' : '深色'}
      </Text>

      <Section title="顏色角色" scheme={scheme}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {roles.map((r) => (
            <View key={r} style={{ width: 92, gap: 4 }}>
              <View style={{ height: 36, borderRadius: 8, backgroundColor: t.color[r], borderWidth: 1, borderColor: t.color.border }} />
              <Text variant="caption" color="text-muted" scheme={scheme}>{r}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="字級" scheme={scheme}>
        {(Object.keys(tokens.type) as (keyof typeof tokens.type)[]).map((k) => (
          <Text key={k} variant={k} scheme={scheme}>{k} 整理相簿 Photo 123</Text>
        ))}
      </Section>

      <Section title="按鈕" scheme={scheme}>
        <Button label="清空封存區" variant="delete" size="lg" icon="delete" scheme={scheme} />
        <Button label="繼續整理" scheme={scheme} />
        <Button label="保留" variant="keep" icon="keep" scheme={scheme} />
        <Button label="隱藏" variant="hide" icon="hide" scheme={scheme} />
        <Button label="前往設定" variant="secondary" icon="settings" scheme={scheme} />
        <Button label="還原購買" variant="ghost" scheme={scheme} />
        <Button label="處理中" loading scheme={scheme} />
        <Button label="不能按" disabled scheme={scheme} />
      </Section>

      <Section title="圖示按鈕（滑動頁下方）" scheme={scheme}>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <IconButton icon="delete" label="刪除這張照片" variant="tinted" role="delete" size={64} scheme={scheme} />
          <IconButton icon="hide" label="隱藏這張照片" variant="tinted" role="hide" scheme={scheme} />
          <IconButton icon="undo" label="復原" scheme={scheme} />
          <IconButton icon="undo" label="復原（沒有可復原的）" disabled scheme={scheme} />
          <IconButton icon="keep" label="保留這張照片" variant="tinted" role="keep" size={64} scheme={scheme} />
        </View>
      </Section>

      <Section title="照片上的元件" scheme={scheme}>
        <View style={{ height: 220, borderRadius: t.radius.card, backgroundColor: t.color['photo-backdrop'], padding: 16, justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <IconButton icon="close" label="關閉" variant="overlay" scheme={scheme} />
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <IconButton icon="trash-bin" label="封存區，12 張" variant="overlay" scheme={scheme} />
              <Badge count={12} scheme={scheme} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            <DecisionStamp decision="keep" scheme={scheme} />
            <DecisionStamp decision="delete" scheme={scheme} />
          </View>
          <View style={{ alignItems: 'center' }}>
            <DecisionStamp decision="hide" scheme={scheme} />
          </View>
        </View>
      </Section>

      <Section title="進度與徽章" scheme={scheme}>
        <Text variant="footnote" color="text-muted" scheme={scheme}>2024 年 3 月 · 38 / 120</Text>
        <ProgressBar value={38} total={120} scheme={scheme} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Badge count={3} scheme={scheme} /><Badge count={42} scheme={scheme} /><Badge count={1500} scheme={scheme} />
        </View>
      </Section>

      <Section title="圖示" scheme={scheme}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {ICON_NAMES.map((n) => (
            <View key={n} style={{ alignItems: 'center', width: 64, gap: 4 }}>
              <Icon name={n} scheme={scheme} />
              <Text variant="caption" color="text-muted" scheme={scheme}>{n}</Text>
            </View>
          ))}
        </View>
      </Section>

      <Section title="空狀態" scheme={scheme}>
        <View style={{ backgroundColor: t.color.surface, borderRadius: t.radius.lg }}>
          <EmptyState icon="check" title="全部整理完了" body="這個月的照片都看過了。" action={{ label: '下一個月', onPress: () => {} }} scheme={scheme} />
        </View>
      </Section>
    </View>
  );
}

function Section({ title, scheme, children }: { title: string; scheme: 'light' | 'dark'; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text variant="headline" color="text-muted" scheme={scheme}>{title}</Text>
      {children}
    </View>
  );
}
