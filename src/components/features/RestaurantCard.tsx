// ============================================================
// 🍽️ RestaurantCard.tsx — 通用餐廳卡片元件
// ============================================================
//
// 依照 PAGE_SPEC.md § 4.3 通用卡片規範。
// P2 最愛抽獎、P3 附近美食、P4 最愛紀錄共用。
//
// Props:
//   restaurant       — 資料模型
//   onNavigate       — 🗺️ 導航按鈕回調
//   onToggleFavorite — ❤️ 最愛 Toggle 回調
//   isFavorite       — 控制愛心圖示填滿/空心
//   showQueue        — P4 顯示佇列序號
//   queueIndex       — 佇列序號數字
//   onPress          — 整卡片點擊回調（可選）
//
// 結構（對齊 Spec）：
// ┌─────────────────────────────────┐
// │  [佇列號碼]  餐廳名稱       ❤️  │
// │             分類 · ⭐ 評分      │
// │─────────────────────────────────│
// │  📍 距離 xxx m                  │
// │  🚶/🚗/🚌 預估交通時間 xx 分    │
// │─────────────────────────────────│
// │               [🗺️ 導航]        │
// └─────────────────────────────────┘
// ============================================================

import React, { useCallback, useState } from 'react';
import { Platform, View, Text, StyleSheet, Image, Pressable } from 'react-native';
import { Card } from '../common/Card';
import { theme } from '../../constants/theme';
import { Restaurant } from '../../types/models';
import { Ionicons } from '@expo/vector-icons';
import { formatDistance, formatTimeMins } from '../../utils/helpers';
import { useUserStore } from '../../store/useUserStore';

// ── 交通方式圖示映射 ──

const getTransportIcon = (mode: 'walk' | 'drive' | 'transit'): keyof typeof Ionicons.glyphMap => {
    switch (mode) {
        case 'drive': return 'car-outline';
        case 'transit': return 'bus-outline';
        default: return 'walk-outline';
    }
};

// ── Props 介面（對齊 PAGE_SPEC § 4.3）──

interface RestaurantCardProps {
    /** 餐廳資料 */
    restaurant: Restaurant;
    /** 🗺️ 導航按鈕回調 */
    onNavigate?: () => void;
    /** ❤️ 最愛 Toggle 回調 */
    onToggleFavorite?: () => void;
    /** 控制愛心圖示狀態 */
    isFavorite?: boolean;
    /** 是否顯示佇列順序號碼（P4 使用） */
    showQueue?: boolean;
    /** 佇列中的序號（1-based，配合 showQueue） */
    queueIndex?: number;
    /** 整卡片點擊回調（可選，保留原有行為） */
    onPress?: (restaurant: Restaurant) => void;
}

// ──────────────────────────────────────────────────────────────
// CardWrapper — 解決 Web 上「<button> 不能嵌套 <button>」的問題
// ──────────────────────────────────────────────────────────────
// 問題：外層用 Pressable（Web 渲染為 <button>），內部的
// ❤️ 和 🗺️ 也是 Pressable（也是 <button>），形成非法嵌套。
//
// 方案：
//   - Web：外層改用 <div>（View），加 onClick + cursor + 按壓
//     回饋，role="button" 確保無障礙。
//   - Native：繼續使用 Pressable（原生端沒有 HTML 元素嵌套限制）。
// ──────────────────────────────────────────────────────────────

interface CardWrapperProps {
    onPress?: () => void;
    accessibilityLabel: string;
    children: React.ReactNode;
}

const CardWrapper: React.FC<CardWrapperProps> = ({ onPress, accessibilityLabel, children }) => {
    const [pressed, setPressed] = useState(false);

    if (Platform.OS === 'web') {
        // Web：使用 View 避免嵌套 <button>
        return (
            <View
                // @ts-expect-error — RNW 支援 onClick 但型別定義不完整
                onClick={onPress}
                onMouseDown={() => onPress && setPressed(true)}
                onMouseUp={() => setPressed(false)}
                onMouseLeave={() => setPressed(false)}
                accessibilityRole={onPress ? 'button' : undefined}
                accessibilityLabel={accessibilityLabel}
                style={[
                    onPress && { cursor: 'pointer' } as any,
                    pressed && onPress && { opacity: theme.interaction.pressedOpacity },
                ]}
            >
                {children}
            </View>
        );
    }

    // Native：使用 Pressable，沒有 HTML 嵌套限制
    return (
        <Pressable
            style={({ pressed: p }) =>
                p && onPress ? { opacity: theme.interaction.pressedOpacity } : undefined
            }
            onPress={onPress}
            disabled={!onPress}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
        >
            {children}
        </Pressable>
    );
};

export const RestaurantCard: React.FC<RestaurantCardProps> = ({
    restaurant,
    onNavigate,
    onToggleFavorite,
    isFavorite = false,
    showQueue = false,
    queueIndex,
    onPress,
}) => {
    const [imageError, setImageError] = useState(false);
    const showImage = !!restaurant.imageUrl && !imageError;
    const transportMode = useUserStore((s) => s.transportMode);

    const handleCardPress = useCallback(() => {
        onPress?.(restaurant);
    }, [onPress, restaurant]);

    const a11yLabel = `${restaurant.name}, ${restaurant.category}, 評分 ${restaurant.rating.toFixed(1)}, 距離 ${formatDistance(restaurant.distanceMeter)}`;

    return (
        <CardWrapper
            onPress={onPress ? handleCardPress : undefined}
            accessibilityLabel={a11yLabel}
        >
            <Card style={styles.cardContainer}>
                {/* ── 圖片區塊 ── */}
                <View style={styles.imageContainer}>
                    {showImage ? (
                        <Image
                            source={{ uri: restaurant.imageUrl }}
                            style={styles.image}
                            resizeMode="cover"
                            onError={() => setImageError(true)}
                        />
                    ) : (
                        <View style={styles.placeholderImage}>
                            <Ionicons name="restaurant-outline" size={40} color={theme.colors.textSecondary} />
                        </View>
                    )}

                    {/* 休息中 Badge */}
                    {!restaurant.isOpenNow && (
                        <View style={styles.closedBadge}>
                            <Text style={styles.closedText}>目前休息中</Text>
                        </View>
                    )}
                </View>

                {/* ── 資訊區塊 ── */}
                <View style={styles.infoContainer}>
                    {/* 標題列：[佇列號碼] 餐廳名稱 ❤️ */}
                    <View style={styles.headerRow}>
                        {showQueue && queueIndex != null && (
                            <View style={styles.queueBadge}>
                                <Text style={styles.queueText}>#{queueIndex}</Text>
                            </View>
                        )}
                        <Text style={styles.name} numberOfLines={1}>
                            {restaurant.name}
                        </Text>

                        {/* ❤️ 最愛 Toggle */}
                        {onToggleFavorite && (
                            <Pressable
                                onPress={(e) => {
                                    e.stopPropagation?.();
                                    onToggleFavorite();
                                }}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel={isFavorite ? '移除最愛' : '加入最愛'}
                                style={({ pressed }) => pressed && { opacity: theme.interaction.pressedOpacity }}
                            >
                                <Ionicons
                                    name={isFavorite ? 'heart' : 'heart-outline'}
                                    size={22}
                                    color={isFavorite ? theme.colors.primary : theme.colors.textSecondary}
                                />
                            </Pressable>
                        )}
                    </View>

                    {/* 分類 · ⭐ 評分 */}
                    <View style={styles.categoryRow}>
                        <Text style={styles.category}>{restaurant.category}</Text>
                        <View style={styles.ratingContainer}>
                            <Ionicons name="star" size={14} color={theme.colors.star} />
                            <Text style={styles.rating}>{restaurant.rating.toFixed(1)}</Text>
                        </View>
                    </View>

                    {/* 距離 + 交通時間 */}
                    <View style={styles.detailsRow}>
                        <View style={styles.detailItem}>
                            <Ionicons name="location-outline" size={14} color={theme.colors.textSecondary} />
                            <Text style={styles.detailText}>
                                {formatDistance(restaurant.distanceMeter)}
                            </Text>
                        </View>
                        <View style={styles.detailItem}>
                            <Ionicons name={getTransportIcon(transportMode)} size={14} color={theme.colors.textSecondary} />
                            <Text style={styles.detailText}>約 {formatTimeMins(restaurant.estimatedTimeMins)}</Text>
                        </View>
                    </View>

                    {/* 地址 */}
                    {restaurant.address && (
                        <Text style={styles.address} numberOfLines={1}>{restaurant.address}</Text>
                    )}

                    {/* ── 操作列：🗺️ 導航按鈕（Spec § 4.3） ── */}
                    {onNavigate && (
                        <View style={styles.actionRow}>
                            <Pressable
                                onPress={(e) => {
                                    e.stopPropagation?.();
                                    onNavigate();
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={`導航至 ${restaurant.name}`}
                                style={({ pressed }) => [
                                    styles.navigateButton,
                                    pressed && { opacity: theme.interaction.pressedOpacity },
                                ]}
                            >
                                <Ionicons name="navigate-outline" size={16} color={theme.colors.primary} />
                                <Text style={styles.navigateText}>導航</Text>
                            </Pressable>
                        </View>
                    )}
                </View>
            </Card>
        </CardWrapper>
    );
};

// ── Styles ──

const styles = StyleSheet.create({
    cardContainer: {
        padding: 0,
        overflow: 'hidden',
    },
    // ── 圖片 ──
    imageContainer: {
        position: 'relative',
    },
    image: {
        width: '100%',
        height: 150,
        backgroundColor: theme.colors.placeholder,
    },
    placeholderImage: {
        width: '100%',
        height: 150,
        backgroundColor: theme.colors.placeholder,
        alignItems: 'center',
        justifyContent: 'center',
    },
    closedBadge: {
        position: 'absolute',
        top: 12,
        right: 12,
        backgroundColor: theme.colors.error + 'E6',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: theme.borderRadius.sm,
    },
    closedText: {
        color: theme.colors.onPrimary,
        ...theme.typography.caption,
        fontWeight: 'bold',
    },
    // ── 資訊 ──
    infoContainer: {
        padding: theme.spacing.lg,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing.xs,
        gap: theme.spacing.sm,
    },
    queueBadge: {
        backgroundColor: theme.colors.primary + '18',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: theme.borderRadius.sm,
        marginRight: 4,
    },
    queueText: {
        ...theme.typography.caption,
        fontWeight: 'bold',
        color: theme.colors.primary,
    },
    name: {
        ...theme.typography.h3,
        fontWeight: 'bold',
        color: theme.colors.text,
        flex: 1,
    },
    // ── 分類 + 評分 ──
    categoryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.sm,
    },
    category: {
        ...theme.typography.bodySmall,
        color: theme.colors.primary,
    },
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.background,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        borderRadius: theme.borderRadius.sm,
    },
    rating: {
        marginLeft: 4,
        ...theme.typography.bodySmall,
        fontWeight: 'bold',
        color: theme.colors.text,
    },
    // ── 詳情列 ──
    detailsRow: {
        flexDirection: 'row',
        marginBottom: theme.spacing.sm,
        gap: theme.spacing.md,
    },
    detailItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    detailText: {
        ...theme.typography.caption,
        color: theme.colors.textSecondary,
    },
    // ── 地址 ──
    address: {
        ...theme.typography.caption,
        color: theme.colors.textSecondary,
        marginTop: theme.spacing.xs,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingTop: theme.spacing.sm,
    },
    // ── 操作列（Spec § 4.3 底部按鈕）──
    actionRow: {
        marginTop: theme.spacing.md,
        paddingTop: theme.spacing.sm,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        alignItems: 'center',
    },
    navigateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.borderRadius.md,
        borderWidth: 1,
        borderColor: theme.colors.primary,
    },
    navigateText: {
        ...theme.typography.bodySmall,
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.primary,
    },
});
