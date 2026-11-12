import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { SessionController } from '../../state/session';
import { useTheme } from '../../theme';
import { Button, Icon, Sheet, Text } from '../../ui';

/** 完全拒絕權限（S02） */
export function DeniedView({ ctrl }: { ctrl: SessionController }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: t.space[6], gap: t.space[4], backgroundColor: t.color.bg }}>
      <View style={{ alignItems: 'center', gap: t.space[3] }}>
        <Icon name="photos" size={64} color="text-muted" />
        <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          需要相簿權限才能整理照片
        </Text>
        <Text color="text-muted" style={{ textAlign: 'center' }}>
          允許讀取相簿後，就能一張一張滑過照片決定去留。照片只在這支手機上處理，不會上傳。
        </Text>
      </View>
      <Button label="允許存取相簿" onPress={() => ctrl.requestAccess()} />
      <Button label="前往設定" variant="secondary" icon="settings" onPress={() => ctrl.openSettings()} />
      <Text variant="footnote" color="text-muted" style={{ textAlign: 'center' }}>
        按了沒有跳出視窗，代表之前選過「不允許」。請到設定 → 權限 → 相片和影片，改成允許。
      </Text>
    </View>
  );
}

/** 部分存取的提示列＋「選更多」選單（同 Flutter 原型 BUG-002 的修正） */
export function PartialBanner({ ctrl }: { ctrl: SessionController }) {
  const t = useTheme('dark');
  const [open, setOpen] = useState(false);
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space[2],
          paddingHorizontal: t.space[4],
          paddingVertical: t.space[2],
          backgroundColor: t.color.surface,
          borderRadius: t.radius.md,
        }}
      >
        <Icon name="info" size={18} color="text-muted" scheme="dark" />
        <Text variant="footnote" color="text-muted" scheme="dark" style={{ flex: 1 }}>
          目前只能看到你選的部分照片
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} hitSlop={12}>
          <Text variant="footnote" color="accent" scheme="dark" style={{ fontWeight: '600' }}>
            選更多
          </Text>
        </Pressable>
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="想整理更多照片？">
        <Button
          label="再多選幾張"
          variant="secondary"
          icon="photos"
          onPress={() => {
            setOpen(false);
            void ctrl.pickMore();
          }}
        />
        <Button
          label="允許存取全部照片"
          icon="settings"
          onPress={() => {
            setOpen(false);
            void ctrl.openSettings();
          }}
        />
        <Text variant="footnote" color="text-muted">
          開放全部照片，才能幫你找出所有重複和相似的照片，整理時也不會漏掉。
        </Text>
      </Sheet>
    </>
  );
}
