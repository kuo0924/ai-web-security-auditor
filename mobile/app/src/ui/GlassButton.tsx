import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Badge } from './Badge';
import { Icon, type IconName } from './Icon';

/** 照片上方的半透明圓鈕（右上角的相似照片、封存區），可以掛數字徽章 */
export function GlassButton({ icon, label, onPress, badge, children }: { icon: IconName; label: string; onPress: () => void; badge?: number; children?: ReactNode }) {
  const t = useTheme('dark');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}>
      {({ pressed }) => (
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.overlay.glass,
            borderWidth: 1,
            borderColor: t.overlay['glass-border'],
            transform: [{ scale: pressed ? 0.94 : 1 }],
          }}
        >
          <Icon name={icon} size={20} color="on-photo" scheme="dark" />
          {children}
          {badge ? (
            <View style={{ position: 'absolute', top: -4, right: -6 }} pointerEvents="none">
              <Badge count={badge} scheme="dark" />
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
