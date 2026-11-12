import { Link } from 'expo-router';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { EmptyState } from '../ui';

export default function Home() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.color.bg }}>
      <EmptyState icon="photos" title="Photo Swipe" body="垂直切片施工中。" />
      <Link href="/design" style={{ textAlign: 'center', color: t.color.accent, padding: 16 }}>
        設計系統
      </Link>
    </View>
  );
}
