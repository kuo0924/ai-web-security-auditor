import { Pressable } from 'react-native';
import { useTheme, type ColorRole } from '../theme';
import { Icon, type IconName } from './Icon';

type Props = {
  icon: IconName;
  /** 一定要有：讀屏會唸這個 */
  label: string;
  onPress?: () => void;
  variant?: 'filled' | 'overlay' | 'tinted';
  role?: ColorRole;
  size?: 44 | 64;
  disabled?: boolean;
  scheme?: 'light' | 'dark';
};

export function IconButton({ icon, label, onPress, variant = 'filled', role = 'text', size = 44, disabled, scheme }: Props) {
  const t = useTheme(scheme);
  const bg =
    variant === 'overlay' ? 'rgba(0,0,0,0.45)' : variant === 'tinted' ? t.color[role] + '26' : t.color['surface-raised'];
  const fg = variant === 'overlay' ? t.color['on-photo'] : t.color[role];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={size < t.hit ? (t.hit - size) / 2 : undefined}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        opacity: disabled ? 0.35 : pressed ? 0.8 : 1,
        transform: [{ scale: pressed && !disabled ? 0.94 : 1 }],
      })}
    >
      <Icon name={icon} size={size * 0.45} rawColor={fg} scheme={scheme} />
    </Pressable>
  );
}
