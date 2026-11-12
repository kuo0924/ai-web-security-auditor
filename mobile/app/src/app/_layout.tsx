import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../state/AppProvider';
import { useTheme } from '../theme';

export default function RootLayout() {
  const t = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
        <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.color.bg },
            headerTintColor: t.color.text,
            contentStyle: { backgroundColor: t.color.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="archive" options={{ title: '封存區' }} />
          <Stack.Screen name="similar" options={{ title: '相似照片' }} />
          <Stack.Screen name="design" options={{ title: '設計系統' }} />
        </Stack>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
