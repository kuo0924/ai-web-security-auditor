import { View } from 'react-native';
import { useTheme } from '../theme';

export function ProgressBar({ value, total, scheme }: { value: number; total: number; scheme?: 'light' | 'dark' }) {
  const t = useTheme(scheme);
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: value }}
      style={{ height: 4, borderRadius: 2, backgroundColor: t.color.border, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: t.color.accent }} />
    </View>
  );
}
