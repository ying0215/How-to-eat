// ============================================================
// 🎲 random.tsx — P2 最愛抽獎（盲盒模式 + 分類篩選 + 營業狀態）
// ============================================================
//
// 📖 四大需求：
//   1. 延遲顯示結果 — 進入頁面時顯示盲盒（❓），點擊「換一家」才揭曉
//   2. Google Places 搜尋新增 — 搜尋真實餐廳加入最愛（含地址/類型/placeId）
//   3. 分類篩選 — 依餐廳類型篩選抽獎範圍
//   4. 營業狀態驗證 — 揭曉時即時查詢營業狀態
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    View, Text, StyleSheet, Pressable, TextInput,
    Modal, FlatList, Alert, KeyboardAvoidingView, Platform,
    ScrollView, ActivityIndicator,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { theme } from '../../src/constants/theme';
import type { ThemeColors, ThemeShadows } from '../../src/constants/theme';
import { useThemeColors, useThemeShadows, useThemedStyles, useResolvedThemeMode } from '../../src/contexts/ThemeContext';
import { useFavoriteStore, FavoriteRestaurant } from '../../src/store/useFavoriteStore';
import { useUserStore } from '../../src/store/useUserStore';
import { useMapJump } from '../../src/hooks/useMapJump';
import AddFavoriteModal from '../../src/components/features/AddFavoriteModal';
import { placeDetailsService, PlaceOpenStatus } from '../../src/services/placeDetails';

import { CATEGORY_LABELS, FOOD_CATEGORIES, resolveCategory } from '../../src/constants/categories';
import { Ionicons } from '@expo/vector-icons';

export default function FavoriteRotationScreen() {
    'use no memo'; // React Compiler opt-out: 含 Zustand 外部 store 訂閱時，編譯器可能錯誤 memoize local state 更新
    const router = useRouter();
    const {
        favorites: allFavorites,
        groups,
        activeGroupId,
        groupQueues,
        groupCurrentDailyIds,
        addFavorite, removeFavorite, skipCurrent, checkDaily, findDuplicate
    } = useFavoriteStore();
    const transportMode = useUserStore((s) => s.transportMode);
    const { jumpToMap } = useMapJump();

    // ── 動態主題 ──
    const colors = useThemeColors();
    const shadows = useThemeShadows();
    const resolvedMode = useResolvedThemeMode();
    const styles = useThemedStyles((c, s) => createStyles(c, s));

    // ── 群組感知：只從啟用中群組抽獎 ──
    const favorites = useMemo(() => allFavorites.filter((f) => f.groupId === activeGroupId), [allFavorites, activeGroupId]);
    const currentDailyId = groupCurrentDailyIds[activeGroupId] ?? null;
    const activeGroupName = groups.find((g) => g.id === activeGroupId)?.name ?? '最愛';

    // ── 盲盒狀態（需求 1）──
    const [isRevealed, setIsRevealed] = useState(false);

    // ── 營業狀態（需求 4）──
    const [openStatus, setOpenStatus] = useState<PlaceOpenStatus | null>(null);
    const [checkingStatus, setCheckingStatus] = useState(false);

    // ── 分類篩選（需求 3）──
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    // ── Modal 狀態 ──
    const [showAddModal, setShowAddModal] = useState(false);
    const [showListModal, setShowListModal] = useState(false);

    // 每次進畫面檢查是否要跨日推進
    // eslint-disable-next-line react-hooks/exhaustive-deps — checkDaily 來自 Zustand 穩定引用
    useEffect(() => { checkDaily(); }, [checkDaily]);

    // ── 篩選後的 favorites（需求 3：使用集中管理的 CATEGORY_LABELS，與附近餐廳同步）──
    const filteredFavorites = useMemo(() => {
        if (!selectedCategory) return favorites;
        const matchedCategory = FOOD_CATEGORIES.find((c) => c.label === selectedCategory);
        if (!matchedCategory) return favorites;
        return favorites.filter((f) => {
            if (!f.category) return true;
            if (f.category === selectedCategory) return true;
            if (f.category === matchedCategory.placesType) return true;
            const resolved = resolveCategory(f.category, f.category);
            return resolved === selectedCategory;
        });
    }, [favorites, selectedCategory]);

    // ── 篩選後的 queue ──
    const filteredQueue = useMemo(() => {
        const filteredIds = new Set(filteredFavorites.map((f) => f.id));
        const groupQueue = groupQueues[activeGroupId] ?? [];
        return groupQueue.filter((id) => filteredIds.has(id));
    }, [filteredFavorites, groupQueues, activeGroupId]);

    // ── 當前推薦的餐廳（考慮篩選）──
    const [filteredCurrentId, setFilteredCurrentId] = useState<string | null>(null);

    useEffect(() => {
        if (filteredQueue.length === 0) {
            setFilteredCurrentId(null);
            return;
        }
        if (filteredCurrentId && filteredQueue.includes(filteredCurrentId)) return;
        if (currentDailyId && filteredQueue.includes(currentDailyId)) {
            setFilteredCurrentId(currentDailyId);
        } else {
            setFilteredCurrentId(filteredQueue[0]);
        }
    }, [filteredQueue, currentDailyId, filteredCurrentId]);

    const currentRestaurant: FavoriteRestaurant | undefined =
        filteredFavorites.find(f => f.id === filteredCurrentId);


    // ── 換一家（整合需求 1 + 3 + 4 + 自動跳過已打烊）──
    const handleSkip = useCallback(async () => {
        if (!isRevealed) {
            setIsRevealed(true);
            setOpenStatus(null);
            if (currentRestaurant) {
                if (currentRestaurant.placeId) {
                    setCheckingStatus(true);
                    try {
                        const status = await placeDetailsService.getPlaceOpenStatus(currentRestaurant.placeId);
                        if (status.isVerified && !status.isOpenNow && filteredQueue.length > 1) {
                            setCheckingStatus(false);
                            setIsRevealed(true);
                            await skipToNextOpen(filteredQueue.indexOf(filteredCurrentId ?? ''));
                            return;
                        }
                        setOpenStatus(status);
                    } catch {
                        setOpenStatus({ isOpenNow: true, isVerified: false });
                    } finally {
                        setCheckingStatus(false);
                    }
                } else {
                    setOpenStatus({ isOpenNow: true, isVerified: false });
                }
            }
            return;
        }

        if (filteredQueue.length <= 1) return;

        const currentIdx = filteredQueue.indexOf(filteredCurrentId ?? '');
        await skipToNextOpen(currentIdx);
    }, [isRevealed, filteredQueue, filteredCurrentId, filteredFavorites, currentRestaurant, skipCurrent]);

    const skipToNextOpen = useCallback(async (startIdx: number) => {
        const maxAttempts = filteredQueue.length;
        let candidateIdx = startIdx;

        setOpenStatus(null);
        setCheckingStatus(true);

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            candidateIdx = (candidateIdx + 1) % filteredQueue.length;
            const candidateId = filteredQueue[candidateIdx];
            const restaurant = filteredFavorites.find((f) => f.id === candidateId);

            if (!restaurant) continue;

            if (!restaurant.placeId) {
                setFilteredCurrentId(candidateId);
                skipCurrent();
                setOpenStatus({ isOpenNow: true, isVerified: false });
                setCheckingStatus(false);
                return;
            }

            try {
                const status = await placeDetailsService.getPlaceOpenStatus(restaurant.placeId);
                if (!status.isVerified || status.isOpenNow) {
                    setFilteredCurrentId(candidateId);
                    skipCurrent();
                    setOpenStatus(status);
                    setCheckingStatus(false);
                    return;
                }
            } catch {
                setFilteredCurrentId(candidateId);
                skipCurrent();
                setOpenStatus({ isOpenNow: true, isVerified: false });
                setCheckingStatus(false);
                return;
            }
        }

        const fallbackIdx = (startIdx + 1) % filteredQueue.length;
        const fallbackId = filteredQueue[fallbackIdx];
        setFilteredCurrentId(fallbackId);
        skipCurrent();
        setOpenStatus({ isOpenNow: false, isVerified: true });
        setCheckingStatus(false);
        Alert.alert('😴 所有餐廳都已打烊', '目前篩選範圍內的餐廳皆已打烊，已為你選擇下一家');
    }, [filteredQueue, filteredFavorites, skipCurrent]);

    // ── 新增餐廳處理（含重複防呆） ──
    const handleRemove = (id: string, name: string) => {
        Alert.alert('確認刪除', `確定要把「${name}」從最愛清單移除嗎？`, [
            { text: '取消', style: 'cancel' },
            { text: '刪除', style: 'destructive', onPress: () => removeFavorite(id) },
        ]);
    };


    // ─── 自訂 Header（與 menu / favorites / settings 統一 3 欄式版面）───
    const renderHeader = () => (
        <>
            <View style={styles.customHeader}>
                <Link href="/" asChild>
                    <Pressable style={styles.backButton}>
                        {({ pressed }) => (
                            <View style={[styles.backButtonInner, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                <Ionicons name="arrow-back-outline" size={20} color={colors.primary} />
                                <Text style={styles.backText}>返回</Text>
                            </View>
                        )}
                    </Pressable>
                </Link>
                <Text style={styles.customHeaderTitle}>最愛抽獎</Text>
                <Pressable style={styles.headerRightBtn} onPress={() => router.push('/favorites')} accessibilityRole="button" accessibilityLabel="我的清單">
                    {({ pressed }) => (
                        <View style={[styles.headerRightInner, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                            <Ionicons name="list-outline" size={20} color={colors.primary} />
                            <Text style={styles.headerRightText}>清單</Text>
                        </View>
                    )}
                </Pressable>
            </View>
            <View style={styles.divider} />
        </>
    );

    // ─── 分類篩選 Chip 列（需求 3）───
    const renderCategoryChips = () => (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipScrollContent}
            style={styles.chipScroll}
        >
            {CATEGORY_LABELS.map((cat) => {
                const isActive = selectedCategory === null ? cat === '全部' : selectedCategory === cat;
                return (
                    <Pressable
                        key={cat}
                        onPress={() => setSelectedCategory(cat === '全部' ? null : cat)}
                        style={({ pressed }) => [
                            styles.chip,
                            isActive && styles.chipActive,
                            pressed && { opacity: theme.interaction.pressedOpacity },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isActive }}
                        accessibilityLabel={`篩選分類：${cat}`}
                    >
                        <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{cat}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );

    // ─── 營業狀態 Badge（需求 4）───
    const renderOpenStatusBadge = () => {
        if (!isRevealed) return null;
        if (checkingStatus) {
            return (
                <View style={styles.statusBadge}>
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                    <Text style={styles.statusBadgeText}>查詢營業狀態...</Text>
                </View>
            );
        }
        if (!openStatus) return null;
        if (!openStatus.isVerified) {
            return (
                <View style={[styles.statusBadge, styles.statusBadgeUnknown]}>
                    <Ionicons name="help-circle-outline" size={16} color={colors.textSecondary} />
                    <Text style={[styles.statusBadgeText, { color: colors.textSecondary }]}>無法確認營業狀態</Text>
                </View>
            );
        }
        return (
            <View style={[styles.statusBadge, openStatus.isOpenNow ? styles.statusBadgeOpen : styles.statusBadgeClosed]}>
                <Ionicons
                    name={openStatus.isOpenNow ? 'checkmark-circle' : 'close-circle'}
                    size={16}
                    color={openStatus.isOpenNow ? colors.success : colors.error}
                />
                <Text style={[styles.statusBadgeText, { color: openStatus.isOpenNow ? colors.success : colors.error }]}>
                    {openStatus.isOpenNow ? '營業中' : '已打烊'}
                </Text>
            </View>
        );
    };

    // ─── 餐廳清單 Modal ───
    function renderListModal() {
        return (
            <Modal visible={showListModal} transparent animationType="slide">
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { maxHeight: '70%' }]}>
                        <Text style={styles.modalTitle}>我的最愛清單（{favorites.length} 家）</Text>
                        <FlatList
                            data={favorites}
                            keyExtractor={(item) => item.id}
                            renderItem={({ item }) => (
                                <View style={styles.listItem}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.listItemName}>
                                            {item.id === currentDailyId ? '🍽️ ' : ''}{item.name}
                                        </Text>
                                        {item.category ? (
                                            <Text style={styles.listItemCategory}>{item.category}</Text>
                                        ) : null}
                                        {item.note ? <Text style={styles.listItemNote}>{item.note}</Text> : null}
                                        {item.address ? (
                                            <Text style={styles.listItemAddress} numberOfLines={1}>
                                                📍 {item.address}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <Pressable onPress={() => handleRemove(item.id, item.name)}>
                                        <Ionicons name="trash-outline" size={20} color={colors.error} />
                                    </Pressable>
                                </View>
                            )}
                            ItemSeparatorComponent={() => <View style={styles.separator} />}
                        />
                        <Pressable
                            style={({ pressed }) => [styles.modalBtn, styles.confirmBtn, { marginTop: theme.spacing.md }, pressed && { opacity: theme.interaction.pressedOpacity }]}
                            onPress={() => setShowListModal(false)}
                        >
                            <Text style={styles.confirmBtnText}>關閉</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        );
    }

    // ─── 空狀態：還沒有任何最愛餐廳 ───
    if (favorites.length === 0) {
        return (
            <View style={styles.screenContainer}>
                {renderHeader()}
                <View style={styles.emptyContent}>
                    <Ionicons name="restaurant-outline" size={80} color={colors.textSecondary} />
                    <Text style={styles.emptyTitle}>還沒有最愛餐廳</Text>
                    <Text style={styles.emptyDesc}>先新增幾家愛吃的餐廳{'\n'}系統會每天幫你排一家！</Text>
                    <Pressable onPress={() => setShowAddModal(true)} accessibilityRole="button" accessibilityLabel="新增最愛餐廳">
                        {({ pressed }) => (
                            <View style={[styles.addButton, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                <Ionicons name="add-circle-outline" size={22} color={colors.onPrimary} />
                                <Text style={styles.addButtonText}>新增最愛餐廳</Text>
                            </View>
                        )}
                    </Pressable>
                    <AddFavoriteModal visible={showAddModal} onClose={() => setShowAddModal(false)} onAdded={() => setShowListModal(true)} />
                </View>
            </View>
        );
    }

    // ─── 篩選後無結果 ───
    if (filteredFavorites.length === 0 && selectedCategory) {
        return (
            <View style={styles.screenContainer}>
                {renderHeader()}
                {renderCategoryChips()}
                <View style={styles.emptyContent}>
                    <Ionicons name="filter-outline" size={60} color={colors.textSecondary} />
                    <Text style={styles.emptyTitle}>此分類沒有餐廳</Text>
                    <Text style={styles.emptyDesc}>試試選擇「全部」或其他分類</Text>
                </View>
                <AddFavoriteModal visible={showAddModal} onClose={() => setShowAddModal(false)} onAdded={() => setShowListModal(true)} />
                {showListModal && renderListModal()}
            </View>
        );
    }

    // ─── 主畫面：盲盒 / 今日推薦 ───
    return (
        <View style={styles.screenContainer}>
            {renderHeader()}
            {renderCategoryChips()}

            <View style={styles.mainContent}>
                <Text style={styles.todayLabel}>
                    {isRevealed ? '今日推薦' : '🎲 試試手氣'}
                </Text>

                {!isRevealed ? (
                    /* ── 盲盒模式（需求 1）── */
                    <View style={styles.blindBoxCard}>
                        <Text style={styles.blindBoxEmoji}>❓</Text>
                        <Text style={styles.blindBoxTitle}>按下「抽獎」來試試手氣</Text>
                        <Text style={styles.blindBoxDesc}>
                            從你的 {filteredFavorites.length} 家最愛餐廳中隨機抽取
                        </Text>
                    </View>
                ) : currentRestaurant ? (
                    /* ── 揭曉結果 ── */
                    <View style={styles.todayCard}>
                        <Text style={styles.todayName}>{currentRestaurant.name}</Text>
                        {currentRestaurant.category ? (
                            <Text style={styles.todayCategory}>{currentRestaurant.category}</Text>
                        ) : null}
                        {currentRestaurant.note ? (
                            <Text style={styles.todayNote}>{currentRestaurant.note}</Text>
                        ) : null}
                        {currentRestaurant.address ? (
                            <Text style={styles.todayAddress} numberOfLines={2}>📍 {currentRestaurant.address}</Text>
                        ) : null}
                        {renderOpenStatusBadge()}
                    </View>
                ) : (
                    <Text style={styles.emptyDesc}>佇列為空，請新增餐廳</Text>
                )}

                {/* 操作按鈕 */}
                <View style={styles.actionRow}>
                    {isRevealed && currentRestaurant && (
                        <Pressable
                            style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.primary }, pressed && { opacity: theme.interaction.pressedOpacity }]}
                            onPress={() => jumpToMap(currentRestaurant.address || currentRestaurant.name, transportMode)}
                            accessibilityRole="button"
                            accessibilityLabel="在 Google Maps 上查看"
                        >
                            <Ionicons name="navigate-outline" size={20} color={colors.onPrimary} />
                            <Text style={styles.actionBtnText}>導航</Text>
                        </Pressable>
                    )}
                    <Pressable
                        style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.secondary }, pressed && { opacity: theme.interaction.pressedOpacity }]}
                        onPress={handleSkip}
                        disabled={filteredQueue.length <= 1 && isRevealed}
                        accessibilityRole="button"
                        accessibilityLabel="抽獎"
                    >
                        <Ionicons name="dice-outline" size={20} color={colors.onPrimary} />
                        <Text style={styles.actionBtnText}>抽獎</Text>
                    </Pressable>
                </View>

                {/* 已打烊提示（需求 4）*/}
                {isRevealed && openStatus?.isVerified && !openStatus.isOpenNow && (
                    <View style={styles.closedHint}>
                        <Ionicons name="warning-outline" size={18} color={colors.error} />
                        <Text style={styles.closedHintText}>這家已打烊，要再換一家嗎？</Text>
                    </View>
                )}

            </View>

            <AddFavoriteModal visible={showAddModal} onClose={() => setShowAddModal(false)} onAdded={() => setShowListModal(true)} />
            {showListModal && renderListModal()}
        </View>
    );
}

// ──────────── Dynamic Styles Factory ────────────
function createStyles(c: ThemeColors, s: ThemeShadows) {
    return StyleSheet.create({
        screenContainer: {
            flex: 1,
            backgroundColor: c.background,
            paddingTop: Platform.OS === 'web' ? 16 : 52,
        },
        // ── 自訂 Header ──
        customHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingBottom: 16,
        },
        customHeaderTitle: {
            ...theme.typography.h2,
            color: c.text,
        },
        backButton: {
            width: 80,
        },
        backButtonInner: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
        },
        backText: {
            ...theme.typography.body,
            color: c.primary,
            fontWeight: '500',
        },
        headerRightBtn: {
            width: 80,
            alignItems: 'flex-end',
        },
        headerRightInner: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
        },
        headerRightText: {
            ...theme.typography.body,
            color: c.primary,
            fontWeight: '500',
        },
        divider: {
            height: 1,
            backgroundColor: c.border,
            marginHorizontal: 16,
            marginBottom: 12,
        },
        // ── 分類 Chip（需求 3）──
        chipScroll: {
            marginHorizontal: 16,
            marginBottom: theme.spacing.sm,
            maxHeight: 40,
        },
        chipScrollContent: {
            flexDirection: 'row',
            flexWrap: 'nowrap',
            gap: theme.spacing.sm,
            paddingRight: theme.spacing.md,
        },
        chip: {
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 6,
            borderRadius: theme.borderRadius.full,
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: c.border,
        },
        chipActive: {
            backgroundColor: c.primary,
            borderColor: c.primary,
        },
        chipText: {
            ...theme.typography.caption,
            fontSize: 13,
            color: c.textSecondary,
        },
        chipTextActive: {
            color: c.onPrimary,
            fontWeight: 'bold',
        },
        // ── 主要內容區域 ──
        mainContent: {
            flex: 1,
            padding: theme.spacing.lg,
            alignItems: 'center',
            justifyContent: 'center',
        },
        // ── 空狀態 ──
        emptyContent: {
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.spacing.lg,
        },
        emptyTitle: {
            ...theme.typography.h2,
            color: c.text,
            marginTop: theme.spacing.lg,
        },
        emptyDesc: {
            ...theme.typography.bodySmall,
            fontSize: 15,
            color: c.textSecondary,
            textAlign: 'center',
            marginTop: theme.spacing.sm,
            marginBottom: theme.spacing.xl,
            lineHeight: 22,
        },
        addButton: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            backgroundColor: c.primary,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.xl,
            borderRadius: theme.borderRadius.lg,
        },
        addButtonText: {
            color: c.onPrimary,
            ...theme.typography.label,
        },
        // ── 盲盒卡片（需求 1）──
        blindBoxCard: {
            backgroundColor: c.surface,
            width: '100%',
            padding: theme.spacing.xl,
            borderRadius: theme.borderRadius.lg,
            alignItems: 'center',
            ...s.md,
            marginBottom: theme.spacing.xl,
            borderWidth: 2,
            borderColor: c.primary,
            borderStyle: 'dashed',
        },
        blindBoxEmoji: { fontSize: 64, marginBottom: theme.spacing.md },
        blindBoxTitle: {
            ...theme.typography.h2,
            color: c.text,
            marginBottom: theme.spacing.xs,
        },
        blindBoxDesc: {
            ...theme.typography.bodySmall,
            color: c.textSecondary,
            textAlign: 'center',
        },
        // ── 今日推薦 ──
        todayLabel: {
            ...theme.typography.body,
            color: c.textSecondary,
            marginBottom: theme.spacing.sm,
        },
        todayCard: {
            backgroundColor: c.surface,
            width: '100%',
            padding: theme.spacing.xl,
            borderRadius: theme.borderRadius.lg,
            alignItems: 'center',
            ...s.md,
            marginBottom: theme.spacing.xl,
        },
        todayEmoji: { fontSize: 48, marginBottom: theme.spacing.md },
        todayName: {
            ...theme.typography.h1,
            color: c.text,
        },
        todayCategory: {
            ...theme.typography.caption,
            color: c.primary,
            marginTop: theme.spacing.xs,
            fontWeight: '600',
        },
        todayNote: {
            ...theme.typography.bodySmall,
            color: c.textSecondary,
            marginTop: theme.spacing.xs,
        },
        todayAddress: {
            ...theme.typography.caption,
            color: c.textSecondary,
            marginTop: theme.spacing.xs,
            textAlign: 'center',
        },
        // ── 營業狀態 Badge（需求 4）──
        statusBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginTop: theme.spacing.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: 4,
            borderRadius: theme.borderRadius.full,
            backgroundColor: c.background,
        },
        statusBadgeOpen: {
            backgroundColor: `${c.success}18`,
        },
        statusBadgeClosed: {
            backgroundColor: `${c.error}18`,
        },
        statusBadgeUnknown: {
            backgroundColor: c.background,
        },
        statusBadgeText: {
            ...theme.typography.caption,
            fontWeight: '600',
        },
        // ── 已打烊提示 ──
        closedHint: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            backgroundColor: `${c.error}12`,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            borderRadius: theme.borderRadius.md,
            marginBottom: theme.spacing.md,
        },
        closedHintText: {
            ...theme.typography.bodySmall,
            color: c.error,
            fontWeight: '500',
        },
        // ── 操作按鈕 ──
        actionRow: {
            flexDirection: 'row',
            gap: theme.spacing.md,
            marginBottom: theme.spacing.lg,
        },
        actionBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.xl,
            borderRadius: theme.borderRadius.lg,
        },
        actionBtnText: {
            color: c.onPrimary,
            ...theme.typography.bodySmall,
            fontSize: 15,
            fontWeight: '600',
        },

        // ── Modal 共用 ──
        modalOverlay: {
            flex: 1,
            backgroundColor: c.overlay,
            justifyContent: 'center',
            padding: theme.spacing.lg,
        },
        modalContent: {
            backgroundColor: c.surface,
            borderRadius: theme.borderRadius.lg,
            padding: theme.spacing.xl,
        },
        modalTitle: {
            ...theme.typography.h3,
            fontSize: 20,
            fontWeight: 'bold',
            color: c.text,
            marginBottom: theme.spacing.lg,
        },
        modalActions: {
            flexDirection: 'row',
            gap: theme.spacing.md,
            marginTop: theme.spacing.sm,
        },
        modalBtn: {
            flex: 1,
            paddingVertical: theme.spacing.md,
            borderRadius: theme.borderRadius.md,
            alignItems: 'center',
        },
        cancelBtn: {
            backgroundColor: c.background,
        },
        cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
        confirmBtn: {
            backgroundColor: c.primary,
        },
        confirmBtnText: { color: c.onPrimary, fontWeight: '600' },
        // ── 清單 Modal ──
        listItem: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: theme.spacing.md,
        },
        listItemName: { ...theme.typography.body, fontWeight: '600', color: c.text },
        listItemCategory: { ...theme.typography.caption, color: c.primary, marginTop: 2, fontWeight: '500' },
        listItemNote: { ...theme.typography.caption, fontSize: 13, color: c.textSecondary, marginTop: 2 },
        listItemAddress: { ...theme.typography.caption, fontSize: 12, color: c.textSecondary, marginTop: 2 },
        separator: { height: 1, backgroundColor: c.border },
    });
}
