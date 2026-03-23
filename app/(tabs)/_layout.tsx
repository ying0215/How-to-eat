// ============================================================
// 📁 檔案：mobile/app/(tabs)/_layout.tsx
// 📖 功能：定義「Tab 分頁導航」的整體佈局與外觀
// ============================================================

import { Tabs } from 'expo-router';
import { theme } from '../../src/constants/theme';
import { useThemeColors } from '../../src/contexts/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  const TAB_BAR_BASE_HEIGHT = 56;
  const TAB_BAR_BASE_PADDING_BOTTOM = theme.spacing.sm + 4;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: TAB_BAR_BASE_HEIGHT + TAB_BAR_BASE_PADDING_BOTTOM + insets.bottom,
          paddingBottom: TAB_BAR_BASE_PADDING_BOTTOM + insets.bottom,
          paddingTop: theme.spacing.sm,
        },
        tabBarLabelStyle: {
          ...theme.typography.bodySmall,
          fontWeight: '600',
          fontSize: 15,
          marginBottom: 0,
        },
      }}>

      <Tabs.Screen
        name="random"
        options={{
          title: '抽獎',
          tabBarIcon: ({ color }) => <Ionicons name="calendar-outline" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="nearest"
        options={{
          title: '附近',
          tabBarIcon: ({ color }) => <Ionicons name="location-outline" size={24} color={color} />,
        }}
      />

    </Tabs>
  );
}
