import { View } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

export function Badge({ count, scheme }: { count: number; scheme?: 'light' | 'dark' }) {
  const t = useTheme(scheme);
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <View
      accessibilityLabel={`${count} 張`}
      style={{
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        borderRadius: 10,
        backgroundColor: t.color.badge,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="caption" color="on-badge" scheme={scheme} maxScale={1.2} style={{ fontWeight: '700', lineHeight: 14 }}>
        {label}
      </Text>
    </View>
  );
}
