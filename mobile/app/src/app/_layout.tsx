import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

export default function RootLayout() {
  const t = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.color.bg },
            headerTintColor: t.color.text,
            contentStyle: { backgroundColor: t.color.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Photo Swipe' }} />
          <Stack.Screen name="design" options={{ title: '設計系統' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
