// ============================================================
// 📍 nearest.tsx — P3 附近美食
// ============================================================
//
// 以使用者 GPS 為中心，列出附近符合條件的餐廳清單。
// 支援分類篩選、下拉刷新、加入最愛、導航。
// ============================================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Alert, Platform, TextInput, ScrollView } from 'react-native';
import { Link } from 'expo-router';
import { theme } from '../../src/constants/theme';
import { useLocation } from '../../src/hooks/useLocation';
import { useRestaurant } from '../../src/hooks/useRestaurant';
import { restaurantService } from '../../src/services/restaurant';
import { RestaurantCard } from '../../src/components/features/RestaurantCard';
import { FilterModal, FilterOptions } from '../../src/components/features/FilterModal';
import { Loader } from '../../src/components/common/Loader';
import { Ionicons } from '@expo/vector-icons';
import { useMapJump } from '../../src/hooks/useMapJump';
import { Restaurant } from '../../src/types/models';
import { useUserStore } from '../../src/store/useUserStore';
import { useFavoriteStore } from '../../src/store/useFavoriteStore';
import { CATEGORY_LABELS } from '../../src/constants/categories';

export default function NearestScreen() {
    const { location } = useLocation();
    const { restaurants, fetchNearest, loading, error } = useRestaurant();
    const { jumpToMap } = useMapJump();
    const transportMode = useUserStore((s) => s.transportMode);

    // ── 最愛 Store ──
    const favorites = useFavoriteStore((s) => s.favorites);
    const addFavorite = useFavoriteStore((s) => s.addFavorite);
    const removeFavorite = useFavoriteStore((s) => s.removeFavorite);

    const [filterVisible, setFilterVisible] = useState(false);
    const [currentFilters, setCurrentFilters] = useState<FilterOptions>({});
    const [searchText, setSearchText] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);


    // ── 防止重複呼叫的 Refs ──
    const hasInitialFetched = useRef(false);
    const fetchNearestRef = useRef(fetchNearest);
    fetchNearestRef.current = fetchNearest;
    const currentFiltersRef = useRef(currentFilters);
    currentFiltersRef.current = currentFilters;

    // ── Effect 1：首次定位完成 → 觸發初始搜尋 ──
    useEffect(() => {
        if (!location.latitude || !location.longitude) return;
        if (hasInitialFetched.current) return;
        hasInitialFetched.current = true;

        fetchNearestRef.current({
            latitude: location.latitude,
            longitude: location.longitude,
            radius: currentFiltersRef.current.maxDistance,
            category: currentFiltersRef.current.category,
        });
    }, [location.latitude, location.longitude]);

    // ── Effect 2：篩選條件變更 → 重新搜尋（必須已有位置）──
    useEffect(() => {
        // 首次定位由 Effect 1 處理，避免重複
        if (!hasInitialFetched.current) return;
        if (!location.latitude || !location.longitude) return;

        fetchNearestRef.current({
            latitude: location.latitude,
            longitude: location.longitude,
            radius: currentFilters.maxDistance,
            category: currentFilters.category,
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFilters]);

    const handleApplyFilters = (filters: FilterOptions) => {
        setCurrentFilters(filters);
        // 同步分類選擇狀態
        setSelectedCategory(filters.category || null);
    };

    // ── Chip 點擊處理：更新篩選條件並重新查詢 ──
    const handleCategoryChip = useCallback((cat: string) => {
        const newCat = cat === '全部' ? null : cat;
        setSelectedCategory(newCat);
        setCurrentFilters((prev) => ({
            ...prev,
            category: newCat || undefined,
        }));
    }, []);

    // ── 客戶端搜尋過濾 ──
    const filteredRestaurants = searchText.trim()
        ? restaurants.filter((r) =>
            r.name.toLowerCase().includes(searchText.trim().toLowerCase())
        )
        : restaurants;

    // ── ❤️ 加入/移除最愛 ──
    const handleToggleFavorite = useCallback((restaurant: Restaurant) => {
        const existing = favorites.find(
            (f) => f.name.trim().toLowerCase() === restaurant.name.trim().toLowerCase()
        );
        if (existing) {
            if (Platform.OS === 'web') {
                const confirmed = window.confirm(`確定要把「${restaurant.name}」從最愛清單移除嗎？`);
                if (confirmed) removeFavorite(existing.id);
            } else {
                Alert.alert('移除最愛', `確定要把「${restaurant.name}」從最愛清單移除嗎？`, [
                    { text: '取消', style: 'cancel' },
                    { text: '移除', style: 'destructive', onPress: () => removeFavorite(existing.id) },
                ]);
            }
        } else {
            addFavorite(restaurant.name, restaurant.category, {
                address: restaurant.address,
                category: restaurant.category,
                placeId: restaurant.id, // Google Places ID
            });
            if (Platform.OS === 'web') {
                window.alert(`✅「${restaurant.name}」已加入你的最愛清單`);
            } else {
                Alert.alert('✅ 已加入最愛', `「${restaurant.name}」已加入你的最愛清單`);
            }
        }
    }, [favorites, addFavorite, removeFavorite]);

    // ── 🗺️ 導航 ──
    const handleNavigate = useCallback((restaurant: Restaurant) => {
        const dest = restaurant.address || restaurant.name;

        if (Platform.OS === 'web') {
            const confirmed = typeof window !== 'undefined'
                ? window.confirm(`確定要出發前往 ${restaurant.name} 嗎？`)
                : true;
            if (confirmed) {
                jumpToMap(dest, transportMode);
            }
        } else {
            Alert.alert(
                restaurant.name,
                `確定要出發前往 ${restaurant.name} 嗎？`,
                [
                    { text: '取消', style: 'cancel' },
                    {
                        text: '導航',
                        onPress: () => jumpToMap(dest, transportMode),
                    },
                ],
            );
        }
    }, [jumpToMap, transportMode]);

    // ── 判斷是否為最愛 ──
    const isFavorite = useCallback((restaurant: Restaurant): boolean => {
        return favorites.some(
            (f) => f.name.trim().toLowerCase() === restaurant.name.trim().toLowerCase()
        );
    }, [favorites]);

    const renderEmpty = () => {
        if (loading) return null;
        return (
            <View style={styles.emptyContainer}>
                <Ionicons name="restaurant-outline" size={48} color={theme.colors.border} />
                <Text style={styles.emptyText}>附近沒有符合條件的餐廳喔</Text>
            </View>
        );
    };

    return (
        <View style={styles.screenContainer}>
            {/* ── 自訂 Header（與 menu / favorites / settings 統一 3 欄式版面）── */}
            <View style={styles.customHeader}>
                <Link href="/" asChild>
                    <Pressable style={styles.backButton}>
                        {({ pressed }) => (
                            <View style={[styles.backButtonInner, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                <Ionicons name="arrow-back-outline" size={20} color={theme.colors.primary} />
                                <Text style={styles.backText}>返回</Text>
                            </View>
                        )}
                    </Pressable>
                </Link>
                <Text style={styles.customHeaderTitle}>附近美食</Text>
                <View style={styles.headerSpacer} />
            </View>
            <View style={styles.divider} />

            {/* ── 搜尋列 + 篩選按鈕（Spec § P3 主要 UI 區塊）── */}
            <View style={styles.header}>
                <View style={styles.searchRow}>
                    <View style={styles.searchInputContainer}>
                        <Ionicons name="search-outline" size={18} color={theme.colors.textSecondary} style={styles.searchIcon} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="搜尋餐廳名稱..."
                            placeholderTextColor={theme.colors.textSecondary}
                            value={searchText}
                            onChangeText={setSearchText}
                            returnKeyType="search"
                            accessibilityLabel="搜尋餐廳名稱"
                        />
                        {searchText.length > 0 && (
                            <Pressable
                                onPress={() => setSearchText('')}
                                hitSlop={8}
                                accessibilityLabel="清除搜尋"
                            >
                                <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                            </Pressable>
                        )}
                    </View>
                    <Pressable
                        style={({ pressed }) => [styles.filterButton, pressed && { opacity: theme.interaction.pressedOpacity }]}
                        onPress={() => setFilterVisible(true)}
                        accessibilityRole="button"
                        accessibilityLabel="開啟篩選條件"
                    >
                        <Ionicons name="options-outline" size={22} color={theme.colors.primary} />
                    </Pressable>
                </View>

                {/* ── 分類標籤橫向滑動（Spec: 分類標籤橫向滑動）── */}
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
                                onPress={() => handleCategoryChip(cat)}
                                style={({ pressed }) => [
                                    styles.chip,
                                    isActive && styles.chipActive,
                                    pressed && { opacity: theme.interaction.pressedOpacity },
                                ]}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isActive }}
                                accessibilityLabel={`篩選分類：${cat}`}
                            >
                                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                                    {cat}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            {loading && !restaurants.length ? (
                <Loader message="正在尋找附近美食..." fullScreen />
            ) : (
                <FlatList
                    data={filteredRestaurants}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => (
                        <RestaurantCard
                            restaurant={item}
                            onNavigate={() => handleNavigate(item)}
                            onToggleFavorite={() => handleToggleFavorite(item)}
                            isFavorite={isFavorite(item)}
                        />
                    )}
                    contentContainerStyle={styles.listContainer}
                    showsVerticalScrollIndicator={false}
                    refreshing={loading}
                    onRefresh={() => {
                        if (location.latitude && location.longitude) {
                            restaurantService.clearCache();
                            fetchNearest({
                                latitude: location.latitude,
                                longitude: location.longitude,
                                ...currentFilters,
                            });
                        }
                    }}
                    ListEmptyComponent={renderEmpty}
                />
            )}

            <FilterModal
                visible={filterVisible}
                onClose={() => setFilterVisible(false)}
                onApply={handleApplyFilters}
                initialFilters={currentFilters}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screenContainer: {
        flex: 1,
        backgroundColor: theme.colors.background,
        paddingTop: Platform.OS === 'web' ? 16 : 52,
    },
    // ── 自訂 Header（與 menu / favorites / settings 統一風格）──
    customHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: theme.spacing.md,
        paddingBottom: theme.spacing.md,
    },
    customHeaderTitle: {
        ...theme.typography.h2,
        color: theme.colors.text,
    },
    backButton: {
        width: 80,
    },
    backButtonInner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
    },
    backText: {
        ...theme.typography.body,
        color: theme.colors.primary,
        fontWeight: '500',
    },
    headerSpacer: {
        width: 80,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginHorizontal: theme.spacing.md,
        marginBottom: theme.spacing.sm + 4,
    },
    header: {
        padding: theme.spacing.lg,
        paddingBottom: theme.spacing.sm,
    },
    // ── 搜尋列 ──
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.sm,
    },
    searchInputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.md,
        paddingHorizontal: theme.spacing.md,
        height: 40,
        ...theme.shadows.sm,
    },
    searchIcon: {
        marginRight: theme.spacing.sm,
    },
    searchInput: {
        flex: 1,
        ...theme.typography.bodySmall,
        color: theme.colors.text,
        padding: 0,
    },
    // ── 分類 Chip ──
    chipScroll: {
        marginBottom: theme.spacing.xs,
    },
    chipScrollContent: {
        flexDirection: 'row',
        flexWrap: 'nowrap',
        gap: theme.spacing.sm,
        paddingRight: theme.spacing.md,
    },
    chip: {
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm - 2,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    chipActive: {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
    },
    chipText: {
        ...theme.typography.caption,
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    chipTextActive: {
        color: theme.colors.onPrimary,
        fontWeight: 'bold',
    },
    // ── 其他 ──
    title: {
        ...theme.typography.h1,
        marginBottom: theme.spacing.xs,
        color: theme.colors.text
    },
    locationText: {
        ...theme.typography.caption,
        color: theme.colors.textSecondary
    },
    filterButton: {
        padding: theme.spacing.sm,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.full,
        ...theme.shadows.sm,
    },
    listContainer: {
        padding: theme.spacing.lg,
        paddingTop: 0,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 100,
    },
    emptyText: {
        marginTop: theme.spacing.md,
        color: theme.colors.textSecondary,
        ...theme.typography.body,
    },
    errorText: {
        margin: theme.spacing.lg,
        color: theme.colors.error,
        textAlign: 'center',
    }
});
