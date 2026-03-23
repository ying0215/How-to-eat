// ============================================================================
// 📁 favorites/_layout.tsx — 最愛清單路由群組
// ============================================================================
//
// 定義 /favorites 路由群組下的 Stack 導航配置。
// 包含兩個頁面：
//   - index：群組列表頁（P4a）
//   - [groupId]：群組詳情頁（P4b）
// ============================================================================

import { Stack } from 'expo-router';

export default function FavoritesLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="[groupId]" />
        </Stack>
    );
}
