// ============================================================
// 🎨 全域設計 Token（Design Tokens）
// ============================================================
// 所有頁面的顏色、字型、間距、圓角、陰影都從這裡取用。
// 支援 Light（預設暖色調）與 Dark（黑金卡背）兩套主題。
//
// 使用方式：
//   顏色：透過 useThemeColors() Hook 取得當前主題色票
//   其他：直接 import { theme } from './theme' 取用共用常數
// ============================================================

import { Platform, TextStyle, ViewStyle } from 'react-native';

// ── 色彩型別定義 ──
export interface ThemeColors {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    error: string;
    success: string;
    accent1: string;
    accent2: string;
    star: string;
    overlay: string;
    placeholder: string;
    onPrimary: string;
    onAccent: string;
}

// ── 陰影型別定義 ──
export interface ThemeShadows {
    sm: ViewStyle;
    md: ViewStyle;
    lg: ViewStyle;
}

// ── 完整主題型別（包含色彩 + 陰影） ──
export interface ThemeColorSet {
    colors: ThemeColors;
    shadows: ThemeShadows;
}

// ── Light 色票（現行暖色風格） ──
export const lightColors: ThemeColors = {
    primary: '#FF6B6B',         // 主色調：暖紅色（飲食 APP 風格）
    secondary: '#4ECDC4',       // 次色調：清新綠
    background: '#F7F9FC',      // 應用程式背景色
    surface: '#FFFFFF',         // 卡片 / 區塊背景色
    text: '#2D3436',            // 主要文字顏色
    textSecondary: '#636E72',   // 次要文字顏色
    border: '#DFE6E9',          // 邊框顏色
    error: '#D63031',           // 錯誤紅
    success: '#00B894',         // 成功綠
    accent1: '#6C5CE7',         // 紫色強調（隨機抽取）
    accent2: '#00B894',         // 綠色強調（附近美食，同 success）
    star: '#FFD700',            // 星級評分色
    overlay: 'rgba(0,0,0,0.45)', // Modal 半透明遮罩
    placeholder: '#F0F0F0',     // 圖片佔位背景
    onPrimary: '#FFFFFF',       // 深色背景上的白字
    onAccent: '#FFFFFF',        // 深色背景上的白字
};

// ── Dark 色票（黑金卡背風格） ──
export const darkColors: ThemeColors = {
    primary: '#D4A843',         // 金色主色（卡背金屬花紋）
    secondary: '#8B7355',       // 古銅/暗金（卡背邊框裝飾）
    background: '#0D0D0F',     // 卡背最深暗面
    surface: '#1A1A1E',         // 卡背次深層面板
    text: '#E8E0D0',            // 米金色文字（高對比）
    textSecondary: '#8A8070',   // 暗金灰色次要文字
    border: '#2A2520',          // 深棕邊框線
    error: '#C0392B',           // 暗調錯誤紅
    success: '#27AE60',         // 暗調成功綠
    accent1: '#4A6F8C',         // 冷藍強調（卡背藍寶石鑲嵌）
    accent2: '#6B8E5A',         // 暗綠（保留功能語義）
    star: '#FFD700',            // 金色保持不變
    overlay: 'rgba(0,0,0,0.65)', // 加深遮罩
    placeholder: '#1E1E22',     // 暗色佔位
    onPrimary: '#0D0D0F',      // 深底金字反轉
    onAccent: '#0D0D0F',       // 同上
};

// ── Light 陰影 ──
const lightShadows: ThemeShadows = {
    sm: (Platform.OS === 'web'
        ? { boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.06)' }
        : Platform.OS === 'android'
            ? { elevation: 2 }
            : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 }
    ) as ViewStyle,
    md: (Platform.OS === 'web'
        ? { boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.1)' }
        : Platform.OS === 'android'
            ? { elevation: 4 }
            : { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 8 }
    ) as ViewStyle,
    lg: (Platform.OS === 'web'
        ? { boxShadow: '0px 4px 16px rgba(0, 0, 0, 0.14)' }
        : Platform.OS === 'android'
            ? { elevation: 8 }
            : { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 16 }
    ) as ViewStyle,
};

// ── Dark 陰影（金色微光） ──
const darkShadows: ThemeShadows = {
    sm: (Platform.OS === 'web'
        ? { boxShadow: '0px 1px 4px rgba(212, 168, 67, 0.08)' }
        : Platform.OS === 'android'
            ? { elevation: 2 }
            : { shadowColor: '#D4A843', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 }
    ) as ViewStyle,
    md: (Platform.OS === 'web'
        ? { boxShadow: '0px 2px 8px rgba(212, 168, 67, 0.12)' }
        : Platform.OS === 'android'
            ? { elevation: 4 }
            : { shadowColor: '#D4A843', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8 }
    ) as ViewStyle,
    lg: (Platform.OS === 'web'
        ? { boxShadow: '0px 4px 16px rgba(212, 168, 67, 0.18)' }
        : Platform.OS === 'android'
            ? { elevation: 8 }
            : { shadowColor: '#D4A843', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 16 }
    ) as ViewStyle,
};

// ── 完整主題色彩集 ──
export const lightTheme: ThemeColorSet = {
    colors: lightColors,
    shadows: lightShadows,
};

export const darkTheme: ThemeColorSet = {
    colors: darkColors,
    shadows: darkShadows,
};

// ── 主題模式型別 ──
export type ThemeMode = 'light' | 'dark' | 'system';

// ── 共用常數（不隨主題變動） ──
export const theme = {
    // ⚠️ colors 與 shadows 僅作為 fallback（向後相容），
    //    正式取色請使用 useThemeColors() Hook。
    colors: lightColors,
    shadows: lightShadows,

    // ── 間距系統 ──
    spacing: {
        xs: 4,
        sm: 8,
        md: 16,
        lg: 24,
        xl: 32,
        xxl: 40,
    },

    // ── 圓角系統 ──
    borderRadius: {
        sm: 4,
        md: 12,
        lg: 16,
        xl: 24,
        full: 9999,
    },

    // ── 字型尺規（Type Scale）──
    typography: {
        /** 頁面大標題（如首頁標題） */
        h1: { fontSize: 28, fontWeight: 'bold' } as TextStyle,
        /** 區塊標題 / 空狀態標題 */
        h2: { fontSize: 22, fontWeight: 'bold' } as TextStyle,
        /** 卡片名稱 / 選單項目標題 */
        h3: { fontSize: 18, fontWeight: '600' } as TextStyle,
        /** 一般內文文字 */
        body: { fontSize: 16, fontWeight: 'normal' } as TextStyle,
        /** 描述 / 次要資訊 */
        bodySmall: { fontSize: 14, fontWeight: 'normal' } as TextStyle,
        /** 標籤 / 地址 / 極小文字 */
        caption: { fontSize: 12, fontWeight: 'normal' } as TextStyle,
        /** 按鈕文字 */
        label: { fontSize: 16, fontWeight: '600' } as TextStyle,
        /** 大按鈕標題（如首頁卡片按鈕） */
        buttonTitle: { fontSize: 22, fontWeight: 'bold' } as TextStyle,
    },

    // ── 統一互動回饋 ──
    interaction: {
        pressedOpacity: 0.7,
    },
};
