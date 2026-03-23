// ============================================================================
// 📁 _layout.tsx — 應用程式的「根佈局」（Root Layout）
// ============================================================================
//
// 📖 什麼是 Layout？
//    在 Expo Router 中，每個資料夾裡的 _layout.tsx 定義了該層級的「外殼」。
//    所有同層級的頁面（如 index.tsx、settings.tsx）都會被包在這個 Layout 裡面渲染。
//    這個檔案位於 app/ 根目錄，所以它是「整個 App 最外層的佈局」。
//
// 📖 為什麼需要根佈局？
//    App 通常需要一些「全域環境」——主題色、手勢支援、資料快取等。
//    把它們放在根佈局裡，就能確保所有頁面都能存取這些功能，
//    而不用在每個頁面重複設定。
//
// 🧅 本檔案的洋蔥式架構（由外到內）：
//    GestureHandlerRootView  ← 手勢支援
//      └─ QueryClientProvider ← 資料快取
//           └─ ThemeProvider   ← 深色/淺色主題
//                └─ Stack      ← 頁面導航
// ============================================================================

// ---------------------------------------------------------------------------
// 🔽 匯入區（Imports）
// ---------------------------------------------------------------------------

// 🎨 主題相關
// DarkTheme / DefaultTheme：React Navigation 預設的深色與淺色主題物件，
//   包含背景色、文字色、卡片色等完整色票定義。
// ThemeProvider：上下文提供者（Context Provider），把主題物件往下傳遞，
//   讓底下所有 React Navigation 元件自動套用對應的顏色。
// 💡 如果不用 ThemeProvider，導航列、標頭等元件會使用硬編碼的預設色。
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';

// 🧭 導航相關
// Stack：Expo Router 提供的「堆疊式導航器」（Stack Navigator）。
//   堆疊式 = 新頁面像紙牌一樣「疊上去」，返回時「拿掉最上面那張」。
//   這是最常見的導航模式，像是「首頁 → 詳情頁 → 再返回」。
// 💡 Expo Router 是基於檔案系統的路由：app/ 資料夾裡的每個 .tsx 檔案
//   就自動成為一個路由，不需要手動註冊。
import { Stack } from 'expo-router';

// 📱 狀態列
// StatusBar：控制手機螢幕最上方那條系統列（顯示時間、電量、訊號的那排）。
//   可以設定圖示顏色為 'light'（白色）、'dark'（黑色）或 'auto'（跟隨主題）。
// 💡 如果深色背景配上深色狀態列圖示，使用者就看不到時間和電量了！
import { StatusBar } from 'expo-status-bar';

// 🌗 系統色彩偵測
// useColorScheme：React Native 內建 Hook，回傳 'light' | 'dark' | null。
//   它會偵測使用者手機的系統設定（設定 → 顯示 → 深色模式）。
// 💡 這是一個 Hook，代表當使用者在系統切換深淺色時，元件會自動「重新渲染」。
import { useColorScheme, Platform } from 'react-native';
import { useEffect } from 'react';

// 🔤 字型載入
// useFonts：Expo 提供的 Hook，用於非同步載入自訂字型（包含 Icon 字型）。
//   在 Web 端，Ionicons 的圖示是透過字型檔渲染的，如果字型沒載入，
//   圖示就會顯示為空白方框或完全不見。
// Ionicons.font：Ionicons 圖示庫的字型對照表（{ Ionicons: require('...') }），
//   傳入 useFonts 後就會在 App 啟動時預先載入。
// 💡 在原生端（iOS/Android），Expo 會自動處理 Icon 字型載入，
//    但在 Web 端必須手動透過 useFonts 觸發 @font-face 載入。
// ❌ 如果不載入：所有 Ionicons 圖示在 Web 瀏覽器上都會「隱形」。
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';

// ⚡ 動畫引擎預載
// react-native-reanimated 是高效能的動畫庫，許多 UI 套件（如手勢、底部導航）
//   依賴它來執行流暢的 60fps 動畫。
// ⚠️ 這個 import 沒有匯入任何變數，純粹是「副作用匯入」（side-effect import），
//   目的是讓 Reanimated 在 App 啟動時優先初始化。
// ❌ 如果刪除這行：畫面轉場、手勢動畫可能會出現閃爍或直接報錯。
import 'react-native-reanimated';

// 👆 手勢處理
// GestureHandlerRootView：react-native-gesture-handler 套件的根容器。
//   它會在原生端註冊手勢監聽器，讓滑動、拖曳、長按等手勢正常運作。
// ⚠️ 必須包在整個 App 的最外層！如果放在內層，外層的手勢就無法辨識。
// ❌ 如果刪除：所有的滑動返回、下拉重整、拖曳排序等手勢都會失效。
import { GestureHandlerRootView } from 'react-native-gesture-handler';


// ☁️ Google 雲端同步
// useGoogleAuth：管理 Google OAuth 登入/登出/token 刷新
// useSyncOrchestrator：自動偵測 FavoriteStore 變化並同步到 Google Drive
import { useGoogleAuth } from '../src/auth/useGoogleAuth';
import { useSyncOrchestrator } from '../src/sync/useSyncOrchestrator';
import { AppThemeProvider, useResolvedThemeMode } from '../src/contexts/ThemeContext';




// ---------------------------------------------------------------------------
// 🔽 路由設定（Router Settings）
// ---------------------------------------------------------------------------

// unstable_settings 是 Expo Router 的進階設定（API 尚未穩定，故有 unstable 前綴）。
// anchor：指定「錨點路由群組」。
//   當使用者按下返回鍵一路回到底時，App 不會回到 index，
//   而是停在 (tabs) 這個路由群組，避免使用者意外退出主畫面。
// 💡 (tabs) 是個路由群組（Route Group），對應 app/(tabs)/ 資料夾。
//   小括號命名代表「群組」，不會出現在 URL 路徑中。
export const unstable_settings = {
  anchor: '(tabs)',
};

// ---------------------------------------------------------------------------
// 🔽 根佈局元件（Root Layout Component）
// ---------------------------------------------------------------------------

/**
 * RootLayout — 整個應用程式的根版面配置
 *
 * 這個元件不渲染任何 UI 內容，它的職責是搭建「基礎設施」：
 *
 * | 層級 | Provider                  | 提供的能力         |
 * |------|---------------------------|--------------------|
 * | 1    | GestureHandlerRootView    | 手勢辨識           |
 * | 2    | ThemeProvider             | 深色/淺色主題      |
 * | 3    | Stack                     | 頁面堆疊導航       |
 *
 * 📖 為什麼順序很重要？
 *    - 手勢必須最外層，因為它在原生端攔截觸控事件
 *    - 主題包住導航器，這樣導航列、標頭才能自動套用主題色
 */
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
  });

  const { getValidToken } = useGoogleAuth();
  useSyncOrchestrator(getValidToken);

  // 🛡️ Web Pointer-Events 修復（透過全域 CSS）
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-fix', 'rn-pointer-events');
    styleEl.textContent = [
      '/* Fix: Override React Navigation\'s pointer-events: none on Web */',
      '/* RN\'s box-none is incorrectly mapped to CSS none by react-native-web */',
      '[style*="pointer-events: none"] { pointer-events: auto !important; }',
    ].join('\n');
    document.head.appendChild(styleEl);

    return () => {
      document.head.removeChild(styleEl);
    };
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* 🎨 AppThemeProvider：管理 Light/Dark 主題切換 */}
      <AppThemeProvider>
        <RootLayoutInner />
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}

/**
 * RootLayoutInner — 需在 AppThemeProvider 內部，才能使用 useResolvedThemeMode()
 */
function RootLayoutInner() {
  const resolvedMode = useResolvedThemeMode();

  return (
    <ThemeProvider value={resolvedMode === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{}}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="menu" options={{ headerShown: false }} />
        <Stack.Screen name="favorites" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

// ============================================================================
// 🧪 學習延伸
// ============================================================================
//
// Q: 如果我想加入「登入驗證」，Provider 應該放在哪一層？
// A: 通常放在 ThemeProvider 外面、QueryClientProvider 裡面，
//    因為驗證狀態可能需要用到 API 請求（Query），
//    但不需要等到主題載入後才開始驗證。
//
// Q: 為什麼 Expo Router 用檔案系統當路由？
// A: 這個概念來自 Next.js，好處是：
//    - 不需要手動維護路由表
//    - 看到檔案結構就知道頁面結構
//    - 新增頁面只需建立新檔案，不需要到處註冊
//
// Q: unstable_settings 什麼時候會穩定？
// A: 這取決於 Expo Router 的版本更新。
//    「unstable」代表 API 可能在未來版本改名或調整參數格式，
//    但功能本身是可以正常使用的。
//
// ============================================================================
