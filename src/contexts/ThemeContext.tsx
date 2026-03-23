// ============================================================
// 🎨 ThemeContext — 動態主題上下文
// ============================================================
//
// 職責：
//   1. 根據 useUserStore.themeMode 決定使用 lightTheme / darkTheme
//   2. 提供 useThemeColors() Hook 讓所有頁面/元件取得當前色票
//   3. 提供 useThemeShadows() Hook 取得當前陰影
//   4. 提供 useThemedStyles(factory) 快取動態樣式
//   5. 支援 'system' 模式（跟隨裝置設定）
//
// 用法：
//   const colors = useThemeColors();
//   const shadows = useThemeShadows();
//   const styles = useThemedStyles((c, s) => StyleSheet.create({ ... }));
// ============================================================

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import {
    lightTheme,
    darkTheme,
    type ThemeColors,
    type ThemeShadows,
    type ThemeColorSet,
    type ThemeMode,
} from '../constants/theme';
import { useUserStore } from '../store/useUserStore';

// ── Context 定義 ──
interface ThemeContextValue {
    /** 當前主題色票 */
    colors: ThemeColors;
    /** 當前主題陰影 */
    shadows: ThemeShadows;
    /** 當前實際使用的主題模式（已解析 'system'） */
    resolvedMode: 'light' | 'dark';
    /** 使用者選擇的主題模式（可能為 'system'） */
    themeMode: ThemeMode;
}

const ThemeContext = createContext<ThemeContextValue>({
    colors: lightTheme.colors,
    shadows: lightTheme.shadows,
    resolvedMode: 'light',
    themeMode: 'light',
});

// ── Provider ──
export function AppThemeProvider({ children }: { children: React.ReactNode }) {
    const themeMode = useUserStore((s) => s.themeMode);
    const systemScheme = useColorScheme();

    const value = useMemo<ThemeContextValue>(() => {
        // 解析 'system' → 實際的 'light' | 'dark'
        let resolvedMode: 'light' | 'dark';
        if (themeMode === 'system') {
            resolvedMode = systemScheme === 'dark' ? 'dark' : 'light';
        } else {
            resolvedMode = themeMode;
        }

        const themeSet: ThemeColorSet = resolvedMode === 'dark' ? darkTheme : lightTheme;

        return {
            colors: themeSet.colors,
            shadows: themeSet.shadows,
            resolvedMode,
            themeMode,
        };
    }, [themeMode, systemScheme]);

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

// ── Hooks ──

/**
 * 取得當前主題的完整色票
 *
 * @example
 * const colors = useThemeColors();
 * <View style={{ backgroundColor: colors.background }} />
 */
export function useThemeColors(): ThemeColors {
    return useContext(ThemeContext).colors;
}

/**
 * 取得當前主題的陰影
 *
 * @example
 * const shadows = useThemeShadows();
 * <View style={[styles.card, shadows.md]} />
 */
export function useThemeShadows(): ThemeShadows {
    return useContext(ThemeContext).shadows;
}

/**
 * 取得當前已解析的主題模式 ('light' | 'dark')
 */
export function useResolvedThemeMode(): 'light' | 'dark' {
    return useContext(ThemeContext).resolvedMode;
}

/**
 * 根據當前主題動態產生並快取 StyleSheet
 *
 * @param factory - 接收 (colors, shadows) 參數，回傳 StyleSheet.create 結果
 * @returns 隨主題切換自動更新的樣式物件
 *
 * @example
 * function MyScreen() {
 *   const styles = useThemedStyles((c, s) => StyleSheet.create({
 *     container: { backgroundColor: c.background, ...s.sm },
 *     title: { color: c.text },
 *   }));
 *   return <View style={styles.container}><Text style={styles.title}>Hi</Text></View>;
 * }
 */
export function useThemedStyles<T>(
    factory: (colors: ThemeColors, shadows: ThemeShadows) => T,
): T {
    const { colors, shadows, resolvedMode } = useContext(ThemeContext);
    return useMemo(() => factory(colors, shadows), [resolvedMode]);
}
