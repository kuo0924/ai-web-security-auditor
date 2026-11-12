import { Pressable, View } from 'react-native';
import { useTheme, type ColorRole } from '../../theme';
import { Icon, Text, type IconName } from '../../ui';

type Action = { icon: IconName; label: string; a11y: string; role: ColorRole; big?: boolean; disabled?: boolean; onPress: () => void };

/** 滑動頁下方：刪除（左）· 隱藏 · 復原 · 保留（右），跟手勢方向一致；每顆都有文字 */
export function ActionBar({ actions }: { actions: Action[] }) {
  const t = useTheme('dark');
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start' }}>
      {actions.map((a) => {
        const size = a.big ? 68 : 50;
        return (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.a11y}
            accessibilityState={{ disabled: !!a.disabled }}
            disabled={a.disabled}
            onPress={a.onPress}
            style={{ alignItems: 'center', gap: 6, width: 76 }}
          >
            {({ pressed }) => (
              <>
                {/* 每顆都放在同樣高度的格子裡置中，大小圓鈕的文字才會對齊 */}
                <View style={{ height: 68, justifyContent: 'center' }}>
                <View
                  style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: a.big ? t.color[a.role] + '24' : t.overlay.glass,
                    borderWidth: a.big ? 1.5 : 1,
                    borderColor: a.big ? t.color[a.role] + '66' : t.overlay['glass-border'],
                    opacity: a.disabled ? 0.35 : 1,
                    transform: [{ scale: pressed && !a.disabled ? 0.92 : 1 }],
                  }}
                >
                  <Icon name={a.icon} size={a.big ? 30 : 22} color={a.big ? a.role : 'on-photo'} scheme="dark" />
                </View>
                </View>
                <Text variant="caption" scheme="dark" color={a.disabled ? 'text-muted' : 'on-photo'} maxScale={1.3} style={{ opacity: a.disabled ? 0.5 : 0.85 }}>
                  {a.label}
                </Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
