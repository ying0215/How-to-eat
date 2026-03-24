// ============================================================================
// 🧭 PageHeader.tsx — 統一頁面 Header 元件
// ============================================================================
//
// 跨頁面共用的 3 欄式 Header：返回按鈕 + 標題 + 右側動作區。
// 採用組合式 API，提供以下使用模式：
//
// 1. 純標題（左有返回、右無動作）→ <PageHeader title="XX" onBack={fn} />
// 2. 右側自訂按鈕                → <PageHeader ... rightIcon="list-outline" rightLabel="清單" onRightPress={fn} />
// 3. 切換狀態按鈕（如 編輯/完成） → <PageHeader ... rightIcon="create-outline" rightLabel="編輯" onRightPress={fn} />
// 4. 帶 Link 的返回按鈕          → <PageHeader ... backHref="/" />
//
// 所有 padding / gap / typography / color 皆從 theme Token 取得，
// 確保各頁面 Header 100% 視覺一致。
// ============================================================================

import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../constants/theme';
import type { ThemeColors } from '../../constants/theme';
import { useThemeColors, useThemedStyles } from '../../contexts/ThemeContext';

// ── Props ───────────────────────────────────────────────────────────────────

export interface PageHeaderProps {
    /** Header 標題文字 */
    title: string;
    /** 返回按鈕處理函式（與 backHref 二擇一） */
    onBack?: () => void;
    /** 使用 expo-router Link 作為返回按鈕的 href（與 onBack 二擇一） */
    backHref?: string;
    /** 返回按鈕文字，預設「返回」 */
    backLabel?: string;
    /** 右側按鈕圖示（Ionicons name） */
    rightIcon?: React.ComponentProps<typeof Ionicons>['name'];
    /** 右側按鈕文字 */
    rightLabel?: string;
    /** 右側按鈕按下事件 */
    onRightPress?: () => void;
    /** 右側按鈕圖示色（預設 colors.primary） */
    rightColor?: string;
    /** 右側按鈕 accessibilityLabel */
    rightAccessibilityLabel?: string;
    /** 是否隱藏右側按鈕（顯示空白佔位） */
    hideRight?: boolean;
    /** 是否顯示 Header 下方的分隔線，預設 true */
    showDivider?: boolean;
    /** 標題 typography 變體：'h2'（預設）或 'h3'（較小標題） */
    titleVariant?: 'h2' | 'h3';
}

// ── 元件 ────────────────────────────────────────────────────────────────────

export const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    onBack,
    backHref,
    backLabel = '返回',
    rightIcon,
    rightLabel,
    onRightPress,
    rightColor,
    rightAccessibilityLabel,
    hideRight,
    showDivider = true,
    titleVariant = 'h2',
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles((c) => createHeaderStyles(c));
    const resolvedRightColor = rightColor ?? colors.primary;

    const titleStyle: TextStyle = titleVariant === 'h3'
        ? { ...theme.typography.h3, color: colors.text }
        : { ...theme.typography.h2, color: colors.text };

    // ── 返回按鈕內容 ──
    const backContent = (pressed: boolean) => (
        <View style={[styles.backButtonInner, pressed && { opacity: theme.interaction.pressedOpacity }]}>
            <Ionicons name="arrow-back-outline" size={20} color={colors.primary} />
            <Text style={styles.backText}>{backLabel}</Text>
        </View>
    );

    // ── 返回按鈕：Link 模式 vs onPress 模式 ──
    const renderBackButton = () => {
        if (backHref) {
            return (
                <Link href={backHref as any} asChild>
                    <Pressable style={styles.backButton}>
                        {({ pressed }) => backContent(pressed)}
                    </Pressable>
                </Link>
            );
        }
        return (
            <Pressable
                onPress={onBack}
                hitSlop={12}
                style={({ pressed }) => [styles.backButton, pressed && { opacity: theme.interaction.pressedOpacity }]}
            >
                <Ionicons name="arrow-back-outline" size={20} color={colors.primary} />
                <Text style={styles.backText}>{backLabel}</Text>
            </Pressable>
        );
    };

    // ── 右側區域 ──
    const renderRight = () => {
        // 無右側按鈕 → 顯示佔位空間
        if (hideRight || (!rightIcon && !rightLabel && !onRightPress)) {
            return <View style={styles.headerSpacer} />;
        }

        return (
            <Pressable
                onPress={onRightPress}
                hitSlop={12}
                style={({ pressed }) => [
                    styles.rightButton,
                    pressed && { opacity: theme.interaction.pressedOpacity },
                ]}
                accessibilityRole="button"
                accessibilityLabel={rightAccessibilityLabel ?? rightLabel}
            >
                {rightIcon && (
                    <Ionicons name={rightIcon} size={20} color={resolvedRightColor} />
                )}
                {rightLabel && (
                    <Text style={[styles.rightText, { color: resolvedRightColor }]}>
                        {rightLabel}
                    </Text>
                )}
            </Pressable>
        );
    };

    return (
        <>
            <View style={styles.headerContainer}>
                {renderBackButton()}
                <Text style={[styles.headerTitle, titleStyle]} numberOfLines={1}>
                    {title}
                </Text>
                {renderRight()}
            </View>
            {showDivider && <View style={styles.divider} />}
        </>
    );
};

// ── 動態樣式工廠 ──────────────────────────────────────────────────────────────

/** 返回按鈕 / 右側按鈕的固定寬度，確保標題居中 */
const SIDE_WIDTH = 80;

function createHeaderStyles(c: ThemeColors) {
    return StyleSheet.create({
        headerContainer: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: theme.spacing.md,
            paddingBottom: theme.spacing.md,
        },
        headerTitle: {
            flex: 1,
            textAlign: 'center',
        },
        // ── 返回按鈕 ──
        backButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            width: SIDE_WIDTH,
        },
        backButtonInner: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
        },
        backText: {
            ...theme.typography.body,
            color: c.primary,
            fontWeight: '500',
        },
        // ── 右側按鈕 ──
        rightButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            width: SIDE_WIDTH,
            justifyContent: 'flex-end',
        },
        rightText: {
            ...theme.typography.body,
            color: c.primary,
            fontWeight: '500',
        },
        // ── 佔位空間（無右側按鈕時） ──
        headerSpacer: {
            width: SIDE_WIDTH,
        },
        // ── 分隔線 ──
        divider: {
            height: 1,
            backgroundColor: c.border,
            marginHorizontal: theme.spacing.md,
        },
    });
}
