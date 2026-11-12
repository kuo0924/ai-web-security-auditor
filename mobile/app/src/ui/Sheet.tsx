import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = { visible: boolean; onClose: () => void; title?: string; children: ReactNode; dismissable?: boolean };

/** 底部選單。Android 返回鍵關閉；點背景關閉（處理中時可關掉這個行為）。 */
export function Sheet({ visible, onClose, title, children, dismissable = true }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismissable ? onClose : () => {}}>
      <Pressable
        accessibilityLabel="關閉"
        style={{ flex: 1, backgroundColor: t.overlay['sheet-backdrop'] }}
        onPress={dismissable ? onClose : undefined}
      />
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: t.color['surface-raised'],
          borderTopLeftRadius: t.radius.lg,
          borderTopRightRadius: t.radius.lg,
          paddingHorizontal: t.space[5],
          paddingTop: t.space[3],
          paddingBottom: insets.bottom + t.space[5],
          gap: t.space[4],
        }}
      >
        <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: t.color.border }} />
        {title ? (
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        {children}
      </View>
    </Modal>
  );
}
