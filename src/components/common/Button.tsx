// ============================================================
// 🔘 Button.tsx — 全站通用按鈕組件
// ============================================================
//
// 依照 PAGE_SPEC.md § 4.1 按鈕樣式規範實作，
// 提供 6 種 variant × 4 種 size 的完整矩陣。
//
// Variant:
//   primary    → 主要行動按鈕（CTA），填滿主色背景
//   secondary  → 次要操作按鈕，透明背景 + primary 邊框
//   danger     → 破壞性操作（刪除），紅色背景
//   text       → 純文字按鈕（低強調），無背景無邊框
//   icon       → 僅圖示，正方形圓形按鈕
//   segmented  → 分段選擇器內選項（需搭配 active prop）
//
// Size:
//   lg   → 52px height, 24px paddingH, 16px fontSize — 全寬 CTA
//   md   → 44px height, 20px paddingH, 14px fontSize — 標準按鈕
//   sm   → 36px height, 14px paddingH, 13px fontSize — 卡片內次要
//   icon → 40px height, 10px paddingH — 正方形圖示
// ============================================================

import React from 'react';
import {
    Pressable,
    Text,
    StyleSheet,
    ActivityIndicator,
    ViewStyle,
    TextStyle,
    View,
} from 'react-native';
import { theme } from '../../constants/theme';

// ── Variant / Size 型別 ──

export type ButtonVariant =
    | 'primary'
    | 'secondary'
    | 'danger'
    | 'text'
    | 'icon'
    | 'segmented';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

// ── Props 介面 ──

export interface ButtonProps {
    /** 按鈕文字（icon variant 可省略） */
    label?: string;
    /** 點擊回調 */
    onPress: () => void;
    /** 外觀變體，預設 'primary' */
    variant?: ButtonVariant;
    /** 尺寸，預設 'md' */
    size?: ButtonSize;
    /** 選填：左側圖示（React 元素，例如 <Ionicons />) */
    icon?: React.ReactNode;
    /** 是否禁用 */
    disabled?: boolean;
    /** 載入中：顯示 ActivityIndicator 取代文字 */
    loading?: boolean;
    /** 是否撐滿父容器寬度 */
    fullWidth?: boolean;
    /** segmented variant 的選中狀態 */
    active?: boolean;
    /** 額外 style override */
    style?: ViewStyle;
    /** Accessibility 標籤 */
    accessibilityLabel?: string;
}

// ── 尺寸對應表（Spec § 4.1 尺寸規範）──

const SIZE_MAP: Record<ButtonSize, { height: number; paddingHorizontal: number; fontSize: number }> = {
    lg:   { height: 52, paddingHorizontal: 24, fontSize: 16 },
    md:   { height: 44, paddingHorizontal: 20, fontSize: 14 },
    sm:   { height: 36, paddingHorizontal: 14, fontSize: 13 },
    icon: { height: 40, paddingHorizontal: 10, fontSize: 0  },
};

// ── 主元件 ──

export const Button: React.FC<ButtonProps> = ({
    label,
    onPress,
    variant = 'primary',
    size = 'md',
    icon: iconElement,
    disabled = false,
    loading = false,
    fullWidth = false,
    active = false,
    style,
    accessibilityLabel,
}) => {
    const sizeSpec = SIZE_MAP[size];

    // ── 背景色 ──
    const getBackgroundColor = (): string => {
        switch (variant) {
            case 'primary':
                return theme.colors.primary;
            case 'secondary':
                return 'transparent';
            case 'danger':
                return theme.colors.error;
            case 'text':
                return 'transparent';
            case 'icon':
                return 'transparent';
            case 'segmented':
                return active ? theme.colors.primary : theme.colors.surface;
            default:
                return theme.colors.primary;
        }
    };

    // ── 文字色 ──
    const getTextColor = (): string => {
        switch (variant) {
            case 'primary':
                return '#FFFFFF';
            case 'secondary':
                return theme.colors.primary;
            case 'danger':
                return '#FFFFFF';
            case 'text':
                return theme.colors.textSecondary;
            case 'icon':
                return theme.colors.text;
            case 'segmented':
                return active ? '#FFFFFF' : theme.colors.textSecondary;
            default:
                return '#FFFFFF';
        }
    };

    // ── 邊框 ──
    const getBorder = (): Pick<ViewStyle, 'borderWidth' | 'borderColor'> => {
        switch (variant) {
            case 'secondary':
                return { borderWidth: 1, borderColor: theme.colors.primary };
            case 'segmented':
                return { borderWidth: 1, borderColor: active ? theme.colors.primary : theme.colors.border };
            default:
                return { borderWidth: 0, borderColor: 'transparent' };
        }
    };

    // ── 圓角：icon variant 使用完全圓形，其他使用 borderRadius.md (12px) ──
    const getBorderRadius = (): number => {
        if (variant === 'icon') return theme.borderRadius.full;
        return theme.borderRadius.md;
    };

    // ── 陰影：僅 primary variant ──
    const getShadow = (): ViewStyle => {
        if (variant === 'primary' && !disabled) return theme.shadows.sm;
        return {};
    };

    const textColor = getTextColor();
    const border = getBorder();
    const isDisabled = disabled || loading;

    return (
        <Pressable
            onPress={onPress}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel || label}
            accessibilityState={{ disabled: isDisabled }}
            style={({ pressed }) => [
                {
                    height: sizeSpec.height,
                    paddingHorizontal: sizeSpec.paddingHorizontal,
                    backgroundColor: getBackgroundColor(),
                    borderRadius: getBorderRadius(),
                    ...border,
                    ...getShadow(),
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: iconElement && label ? 8 : 0,
                },
                fullWidth && { width: '100%' } as ViewStyle,
                isDisabled && { opacity: 0.4 },
                pressed && !isDisabled && { opacity: theme.interaction.pressedOpacity },
                style,
            ]}
        >
            {loading ? (
                <ActivityIndicator
                    size="small"
                    color={textColor}
                />
            ) : (
                <>
                    {iconElement && (
                        <View style={{ flexShrink: 0 }}>
                            {iconElement}
                        </View>
                    )}
                    {label && sizeSpec.fontSize > 0 && (
                        <Text
                            style={{
                                color: textColor,
                                fontSize: sizeSpec.fontSize,
                                fontWeight: '600',
                            }}
                            numberOfLines={1}
                        >
                            {label}
                        </Text>
                    )}
                </>
            )}
        </Pressable>
    );
};

export default Button;
