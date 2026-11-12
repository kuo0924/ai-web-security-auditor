import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useTheme, type ColorRole } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Variant = 'primary' | 'keep' | 'delete' | 'hide' | 'secondary' | 'ghost';

const ROLE: Record<Variant, { bg?: ColorRole; fg: ColorRole }> = {
  primary: { bg: 'accent', fg: 'on-accent' },
  keep: { bg: 'keep', fg: 'on-keep' },
  delete: { bg: 'delete', fg: 'on-delete' },
  hide: { bg: 'hide', fg: 'on-hide' },
  secondary: { bg: 'surface', fg: 'text' },
  ghost: { fg: 'accent' },
};

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'md' | 'lg';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  scheme?: 'light' | 'dark';
  accessibilityHint?: string;
};

export function Button({ label, onPress, variant = 'primary', size = 'md', icon, disabled, loading, scheme, accessibilityHint }: Props) {
  const t = useTheme(scheme);
  const r = ROLE[variant];
  const height = size === 'lg' ? 56 : 48;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          borderRadius: t.radius.pill,
          backgroundColor: r.bg ? t.color[r.bg] : 'transparent',
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: t.color.border,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !inactive ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={t.color[r.fg]} />
        ) : icon ? (
          <Icon name={icon} size={20} color={r.fg} scheme={scheme} />
        ) : null}
        <Text variant="headline" color={r.fg} scheme={scheme} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
