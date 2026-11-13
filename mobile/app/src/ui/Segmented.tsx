import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Option<T extends string> = { value: T; label: string; icon?: IconName };

/** 小型分段切換（例如「全部／影片」）。半透明底，放在照片畫面上也看得清楚 */
export function Segmented<T extends string>({ value, options, onChange, scheme = 'dark' }: { value: T; options: Option<T>[]; onChange: (v: T) => void; scheme?: 'light' | 'dark' }) {
  const t = useTheme(scheme);
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', alignSelf: 'center', padding: 3, borderRadius: t.radius.pill, backgroundColor: t.overlay.glass, borderWidth: 1, borderColor: t.overlay['glass-border'] }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: t.space[4],
              height: 32,
              borderRadius: t.radius.pill,
              backgroundColor: on ? t.color['on-photo'] : 'transparent',
            }}
          >
            {o.icon ? <Icon name={o.icon} size={14} rawColor={on ? t.color['photo-backdrop'] : t.color['on-photo']} scheme={scheme} /> : null}
            <Text variant="footnote" scheme={scheme} style={{ color: on ? t.color['photo-backdrop'] : t.color['on-photo'], fontWeight: on ? '700' : '500' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
