// ============================================================
// 📁 檔案：mobile/app/(tabs)/_layout.tsx
// 📖 功能：定義「Tab 分頁導航」的整體佈局與外觀
//    這個檔案決定了 App 底部 Tab Bar 有哪些分頁、
//    每個分頁的圖示/標題是什麼。
// 💡 headerShown: false — 各 Tab 頁面自行渲染自訂 Header，
//    保持與 menu / favorites / settings 頁面統一的 3 欄式版面。
// ============================================================

import { Tabs } from 'expo-router';
import { theme } from '../../src/constants/theme';
import { Ionicons } from '@expo/vector-icons';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        // 關閉 React Navigation 內建 Header，各 Tab 頁面自管 Header
        headerShown: false,

        // 🎨 Tab Bar 色彩
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,

        // 🎨 tabBarStyle：底部 Tab Bar
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: 80,
          paddingBottom: theme.spacing.sm + 4,
          paddingTop: theme.spacing.sm,
        },
        tabBarLabelStyle: {
          ...theme.typography.bodySmall,
          fontWeight: '600',
          fontSize: 15,
          marginBottom: 0,
        },
      }}>

      {/* 🧭 Tab 1：最愛抽獎 */}
      <Tabs.Screen
        name="random"
        options={{
          title: '抽獎',
          tabBarIcon: ({ color }) => <Ionicons name="calendar-outline" size={24} color={color} />,
        }}
      />
      {/* 🧭 Tab 2：附近美食 */}
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

// ──────────────────────────────────────────────
// 🧪 學習延伸 Q&A
// ──────────────────────────────────────────────
//
// Q1: Tabs.Screen 的 name 屬性和 (tabs) 資料夾下的檔案名稱不一致會怎樣？
// A1: Expo Router 會報錯「Unmatched Route」。name 必須精確對應檔案名稱
//     （不含副檔名），例如 name="nearest" 對應的是 (tabs)/nearest.tsx。
//     這就像教室的座位表和學生名單——名字對不上就「找不到人」。
//
// Q2: 為什麼 HomeButton 寫在元件外面，而不是寫在 TabLayout 裡面？
// A2: 如果寫在 TabLayout 內部，每次 TabLayout 重新渲染時，
//     HomeButton 的函式定義都會被重新建立，導致 React 認為它是一個
//     「全新的元件」而強制重建 DOM（unmount + mount），可能造成閃爍。
//     寫在外面則函式參考是穩定的，不會觸發不必要的重建。
//
// Q3: tabBarIcon 裡的 { color } 是從哪裡來的？我可以忽略它嗎？
// A3: color 是由 <Tabs> 元件自動注入的，它會根據 Tab 是否被選中
//     自動傳入 tabBarActiveTintColor 或 tabBarInactiveTintColor。
//     如果忽略 color 而寫死顏色（例如 color="red"），
//     Tab 切換時圖示就不會變色，使用者會看不出目前在哪個分頁。
//
// Q4: screenOptions 和個別 Tabs.Screen 的 options 有衝突時，誰會贏？
// A4: 個別 Screen 的 options 優先度更高（override），就像 CSS 中的
//     「更具體的選擇器優先」。所以你可以在 screenOptions 設定全域預設值，
//     再用個別 options 覆蓋特定頁面的設定。
