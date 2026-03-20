// ============================================================
// 🎨 全域設計 Token（Design Tokens）
// ============================================================
// 所有頁面的顏色、字型、間距、圓角、陰影都從這裡取用。
// 修改此檔案 = 全局變更 App 風格。
// ============================================================

import { Platform, TextStyle, ViewStyle } from 'react-native';

export const theme = {
    // ── 色彩系統 ──
    colors: {
        primary: '#FF6B6B',         // 主色調：暖紅色（飲食 APP 風格）
        secondary: '#4ECDC4',       // 次色調：清新綠
        background: '#F7F9FC',      // 應用程式背景色
        surface: '#FFFFFF',         // 卡片 / 區塊背景色
        text: '#2D3436',            // 主要文字顏色
        textSecondary: '#636E72',   // 次要文字顏色
        border: '#DFE6E9',         // 邊框顏色
        error: '#D63031',           // 錯誤紅
        success: '#00B894',         // 成功綠

        // 語義強調色
        accent1: '#6C5CE7',         // 紫色強調（隨機抽取）
        accent2: '#00B894',         // 綠色強調（附近美食，同 success）
        star: '#FFD700',            // 星級評分色
        overlay: 'rgba(0,0,0,0.45)', // Modal 半透明遮罩
        placeholder: '#F0F0F0',     // 圖片佔位背景

        // 按鈕上的文字色（用於深色背景上的白字）
        onPrimary: '#FFFFFF',
        onAccent: '#FFFFFF',
    },

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
    // md 從 8 → 12，對齊 PAGE_SPEC § 4.1 按鈕圓角建議
    borderRadius: {
        sm: 4,
        md: 12,
        lg: 16,
        xl: 24,
        full: 9999,
    },

    // ── 字型尺規（Type Scale）──
    // 統一管理所有頁面的字型大小與粗細
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

    // ── 陰影系統（跨平台）──
    // Web：boxShadow CSS（避免 shadow* 棄用警告）
    // Android：elevation
    // iOS：原生 shadow* props
    shadows: {
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
    },

    // ── 統一互動回饋 ──
    interaction: {
        pressedOpacity: 0.7,
    },
};
