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
import { useFavoriteStore, FavoriteRestaurant } from '../../src/store/useFavoriteStore';
import { useUserStore } from '../../src/store/useUserStore';
import { useMapJump } from '../../src/hooks/useMapJump';
import { usePlaceSearch } from '../../src/hooks/usePlaceSearch';
import { useLocation } from '../../src/hooks/useLocation';
import { placeDetailsService, PlaceOpenStatus } from '../../src/services/placeDetails';
import { parseGoogleMapsUrl, isGoogleMapsUrl, ParseResult, batchParseGoogleMapsUrls, BatchParseResult } from '../../src/services/googleMapsUrlParser';
import { PlaceSearchResult } from '../../src/types/models';

import { CATEGORY_LABELS, FOOD_CATEGORIES, resolveCategory } from '../../src/constants/categories';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

export default function FavoriteRotationScreen() {
    'use no memo'; // React Compiler opt-out: 含 Zustand 外部 store 訂閱時，編譯器可能錯誤 memoize local state 更新
    const router = useRouter();
    const {
        favorites, currentDailyId,
        addFavorite, removeFavorite, skipCurrent, checkDaily, findDuplicate
    } = useFavoriteStore();
    const transportMode = useUserStore((s) => s.transportMode);
    const { jumpToMap } = useMapJump();
    const { location } = useLocation();

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
    const [addMode, setAddMode] = useState<'search' | 'manual' | 'paste'>('search');
    const [newName, setNewName] = useState('');
    const [newNote, setNewNote] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPlace, setSelectedPlace] = useState<PlaceSearchResult | null>(null);

    // ── 貼上連結狀態 ──
    const [pasteUrl, setPasteUrl] = useState('');
    const [pasteLoading, setPasteLoading] = useState(false);
    const [pasteResult, setPasteResult] = useState<ParseResult | null>(null);

    // ── 批量匯入狀態 ──
    const [batchResults, setBatchResults] = useState<BatchParseResult | null>(null);
    const [batchImporting, setBatchImporting] = useState(false);

    // ── 剪貼簿自動偵測：切換到貼上模式時自動讀取 ──
    useEffect(() => {
        if (addMode !== 'paste' || !showAddModal) return;
        let cancelled = false;
        (async () => {
            try {
                const text = await Clipboard.getStringAsync();
                if (cancelled || !text) return;
                const trimmed = text.trim();
                if (isGoogleMapsUrl(trimmed)) {
                    setPasteUrl(trimmed);
                    setPasteLoading(true);
                    setPasteResult(null);
                    try {
                        const userLoc = (location?.latitude != null && location?.longitude != null) ? { lat: location.latitude, lng: location.longitude } : null;
                        const result = await parseGoogleMapsUrl(trimmed, userLoc);
                        if (!cancelled) setPasteResult(result);
                    } catch (err: unknown) {
                        if (!cancelled) {
                            const msg = err instanceof Error ? err.message : '解析失敗';
                            setPasteResult({ restaurant: null, error: msg, source: 'failed' });
                        }
                    } finally {
                        if (!cancelled) setPasteLoading(false);
                    }
                }
            } catch {
                // 剪貼簿讀取失敗——靜默略過
            }
        })();
        return () => { cancelled = true; };
    }, [addMode, showAddModal]);

    // ── Hooks ──
    const { results: searchResults, loading: searchLoading, error: searchError, searchImmediate, clearResults } = usePlaceSearch();

    // 每次進畫面檢查是否要跨日推進
    // eslint-disable-next-line react-hooks/exhaustive-deps — checkDaily 來自 Zustand 穩定引用
    useEffect(() => { checkDaily(); }, [checkDaily]);

    // ── 篩選後的 favorites（需求 3：使用集中管理的 CATEGORY_LABELS，與附近餐廳同步）──
    const filteredFavorites = useMemo(() => {
        if (!selectedCategory) return favorites;
        // 找到選中分類對應的 placesType（用於比對 Google Places 回傳的 category）
        const matchedCategory = FOOD_CATEGORIES.find((c) => c.label === selectedCategory);
        if (!matchedCategory) return favorites;
        // 比對策略（確保新舊資料都能正確篩選）：
        //   1. category 完全等於選中標籤（如 "麵類"）
        //   2. category 完全等於對應的 placesType（如 "ramen_restaurant"）
        //   3. category 經 resolveCategory 轉換後等於選中標籤
        //      → 處理舊資料的 Google displayName（如 "拉麵店" → resolve → "麵類"）
        return favorites.filter((f) => {
            // 沒有 category 的餐廳（手動新增）視為萬用，任何分類都可抽
            if (!f.category) return true;
            if (f.category === selectedCategory) return true;
            if (f.category === matchedCategory.placesType) return true;
            // 逆向解析：將存儲的 category 當作 displayName 或 primaryType 嘗試 resolve
            const resolved = resolveCategory(f.category, f.category);
            return resolved === selectedCategory;
        });
    }, [favorites, selectedCategory]);

    // ── 篩選後的 queue ──
    const filteredQueue = useMemo(() => {
        const filteredIds = new Set(filteredFavorites.map((f) => f.id));
        return useFavoriteStore.getState().queue.filter((id) => filteredIds.has(id));
    }, [filteredFavorites]);

    // ── 當前推薦的餐廳（考慮篩選）──
    const [filteredCurrentId, setFilteredCurrentId] = useState<string | null>(null);

    // 初始化 / 校正 filteredCurrentId
    // 只在 filteredCurrentId 不存在於 filteredQueue 時才重新指定，
    // 避免 skipCurrent() 觸發 queue 重排後覆蓋 handleSkip 設定的 nextId
    useEffect(() => {
        if (filteredQueue.length === 0) {
            setFilteredCurrentId(null);
            return;
        }
        // 當前 ID 仍在篩選後佇列中 → 不干預
        if (filteredCurrentId && filteredQueue.includes(filteredCurrentId)) return;
        // 當前 ID 無效 → 嘗試用 currentDailyId，否則用 queue[0]
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
        // 第一次按下 → 僅揭曉當前餐廳，不需要 skip
        if (!isRevealed) {
            setIsRevealed(true);
            setOpenStatus(null);
            if (currentRestaurant) {
                // 揭曉時也檢查營業狀態，若已打烊則自動跳過
                if (currentRestaurant.placeId) {
                    setCheckingStatus(true);
                    try {
                        const status = await placeDetailsService.getPlaceOpenStatus(currentRestaurant.placeId);
                        if (status.isVerified && !status.isOpenNow && filteredQueue.length > 1) {
                            // 已打烊 → 自動跳到下一家
                            setCheckingStatus(false);
                            setIsRevealed(true); // 保持揭曉狀態
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

        // 已揭曉狀態下，需要至少 2 個以上才能「換一家」
        if (filteredQueue.length <= 1) return;

        const currentIdx = filteredQueue.indexOf(filteredCurrentId ?? '');
        await skipToNextOpen(currentIdx);
    }, [isRevealed, filteredQueue, filteredCurrentId, filteredFavorites, currentRestaurant, skipCurrent]);

    /**
     * 從 startIdx 開始往後找第一個「營業中」或「無法確認」的餐廳。
     * 最多嘗試 filteredQueue.length 次，避免全部打烊時無限迴圈。
     */
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

            // 沒有 placeId → 無法確認營業狀態 → 視為可用
            if (!restaurant.placeId) {
                setFilteredCurrentId(candidateId);
                skipCurrent();
                setOpenStatus({ isOpenNow: true, isVerified: false });
                setCheckingStatus(false);
                return;
            }

            // 查詢營業狀態
            try {
                const status = await placeDetailsService.getPlaceOpenStatus(restaurant.placeId);
                if (!status.isVerified || status.isOpenNow) {
                    // 營業中 or 無法確認 → 選中
                    setFilteredCurrentId(candidateId);
                    skipCurrent();
                    setOpenStatus(status);
                    setCheckingStatus(false);
                    return;
                }
                // 已打烊（verified closed）→ 繼續找下一家
            } catch {
                // API 失敗 → 視為無法確認，選中此家
                setFilteredCurrentId(candidateId);
                skipCurrent();
                setOpenStatus({ isOpenNow: true, isVerified: false });
                setCheckingStatus(false);
                return;
            }
        }

        // 全部都打烊了 → 退而求其次，選下一家並告知使用者
        const fallbackIdx = (startIdx + 1) % filteredQueue.length;
        const fallbackId = filteredQueue[fallbackIdx];
        setFilteredCurrentId(fallbackId);
        skipCurrent();
        setOpenStatus({ isOpenNow: false, isVerified: true });
        setCheckingStatus(false);
        Alert.alert('😴 所有餐廳都已打烊', '目前篩選範圍內的餐廳皆已打烊，已為你選擇下一家');
    }, [filteredQueue, filteredFavorites, skipCurrent]);

    // ── 新增餐廳處理（含重複防呆） ──
    const handleAddFromSearch = useCallback(() => {
        if (!selectedPlace) {
            Alert.alert('請先選擇一家餐廳');
            return;
        }
        const dup = findDuplicate(selectedPlace.name, selectedPlace.placeId);
        const doAdd = () => {
            addFavorite(selectedPlace.name, newNote.trim() || undefined, {
                address: selectedPlace.address,
                category: selectedPlace.category,
                placeId: selectedPlace.placeId,
                latitude: selectedPlace.latitude,
                longitude: selectedPlace.longitude,
            });
            resetAddModal();
            Alert.alert('✅ 新增成功', `「${selectedPlace.name}」已加入最愛清單`);
            setShowListModal(true);
        };
        if (dup) {
            Alert.alert('⚠️ 此餐廳已在清單中', `「${dup.name}」已經是你的最愛了`, [
                { text: '仍要新增', onPress: doAdd },
                { text: '取消', style: 'cancel' },
            ]);
            return;
        }
        doAdd();
    }, [selectedPlace, newNote, addFavorite, clearResults, findDuplicate]);

    const handleAddManual = useCallback(() => {
        const trimmed = newName.trim();
        if (!trimmed) {
            Alert.alert('請輸入餐廳名稱');
            return;
        }
        const dup = findDuplicate(trimmed);
        const doAdd = () => {
            addFavorite(trimmed, newNote.trim() || undefined);
            setNewName('');
            setNewNote('');
            setShowAddModal(false);
            Alert.alert('✅ 新增成功', `「${trimmed}」已加入最愛清單`);
            setShowListModal(true);
        };
        if (dup) {
            Alert.alert('⚠️ 此餐廳已在清單中', `「${dup.name}」已經是你的最愛了`, [
                { text: '仍要新增', onPress: doAdd },
                { text: '取消', style: 'cancel' },
            ]);
            return;
        }
        doAdd();
    }, [newName, newNote, addFavorite, findDuplicate]);

    const handleRemove = (id: string, name: string) => {
        Alert.alert('確認刪除', `確定要把「${name}」從最愛清單移除嗎？`, [
            { text: '取消', style: 'cancel' },
            { text: '刪除', style: 'destructive', onPress: () => removeFavorite(id) },
        ]);
    };

    const handleSearch = useCallback(() => {
        searchImmediate(searchQuery, location?.latitude && location?.longitude ? { lat: location.latitude, lng: location.longitude } : undefined);
    }, [searchQuery, searchImmediate, location]);

    const resetAddModal = useCallback(() => {
        setShowAddModal(false);
        setSearchQuery('');
        setSelectedPlace(null);
        setNewName('');
        setNewNote('');
        setPasteUrl('');
        setPasteResult(null);
        setBatchResults(null);
        setBatchImporting(false);
        clearResults();
        setAddMode('search');
    }, [clearResults]);

    // ── 貼上連結解析處理（單一 or 批量） ──
    const handlePasteUrl = useCallback(async () => {
        const trimmed = pasteUrl.trim();
        if (!trimmed) {
            Alert.alert('請貼上 Google Maps 連結');
            return;
        }
        // 偵測多行 URL → 批量模式
        const lines = trimmed.split(/[\n\r]+/).filter((l) => l.trim().length > 0);
        const validLines = lines.filter((l) => isGoogleMapsUrl(l.trim()));
        if (validLines.length > 1) {
            setPasteLoading(true);
            setBatchResults(null);
            setPasteResult(null);
            try {
                const result = await batchParseGoogleMapsUrls(trimmed);
                setBatchResults(result);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : '批量解析失敗';
                Alert.alert('解析失敗', msg);
            } finally {
                setPasteLoading(false);
            }
            return;
        }
        // 單一 URL 模式
        if (!isGoogleMapsUrl(trimmed)) {
            Alert.alert('無效連結', '請貼上 Google Maps 的分享連結');
            return;
        }
        setPasteLoading(true);
        setPasteResult(null);
        setBatchResults(null);
        try {
            const userLoc = (location?.latitude != null && location?.longitude != null) ? { lat: location.latitude, lng: location.longitude } : null;
            const result = await parseGoogleMapsUrl(trimmed, userLoc);
            setPasteResult(result);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '解析失敗';
            setPasteResult({ restaurant: null, error: msg, source: 'failed' });
        } finally {
            setPasteLoading(false);
        }
    }, [pasteUrl]);

    const handleAddFromPaste = useCallback(() => {
        if (!pasteResult?.restaurant) {
            Alert.alert('請先解析連結並確認餐廳資訊');
            return;
        }
        const r = pasteResult.restaurant;
        const dup = findDuplicate(r.name, r.placeId);
        const doAdd = () => {
            addFavorite(r.name, newNote.trim() || undefined, {
                address: r.address,
                category: r.category,
                placeId: r.placeId,
                latitude: r.latitude,
                longitude: r.longitude,
            });
            resetAddModal();
            Alert.alert('✅ 新增成功', `「${r.name}」已加入最愛清單`);
            setShowListModal(true);
        };
        if (dup) {
            if (Platform.OS === 'web' && typeof window !== 'undefined') {
                const confirmed = window.confirm(`⚠️ 「${dup.name}」已在清單中，仍要新增嗎？`);
                if (confirmed) doAdd();
                return;
            }
            Alert.alert('⚠️ 此餐廳已在清單中', `「${dup.name}」已經是你的最愛了`, [
                { text: '仍要新增', onPress: doAdd },
                { text: '取消', style: 'cancel' },
            ]);
            return;
        }
        doAdd();
    }, [pasteResult, newNote, addFavorite, findDuplicate]);

    // ── 批量新增所有成功解析的餐廳（含重複過濾） ──
    const handleBatchAdd = useCallback(() => {
        if (!batchResults) return;
        const successItems = batchResults.results.filter((r) => r.restaurant !== null);
        if (successItems.length === 0) {
            Alert.alert('沒有可新增的餐廳');
            return;
        }
        setBatchImporting(true);
        let addedCount = 0;
        let skippedCount = 0;
        for (const item of successItems) {
            const r = item.restaurant!;
            const dup = findDuplicate(r.name, r.placeId);
            if (dup) {
                skippedCount++;
                continue;
            }
            addFavorite(r.name, undefined, {
                address: r.address,
                category: r.category,
                placeId: r.placeId,
                latitude: r.latitude,
                longitude: r.longitude,
            });
            addedCount++;
        }
        setBatchImporting(false);
        resetAddModal();
        const msg = skippedCount > 0
            ? `成功新增 ${addedCount} 家，${skippedCount} 家已存在已略過`
            : `成功新增 ${addedCount} 家餐廳`;
        Alert.alert('✅ 批量匯入完成', msg);
        setShowListModal(true);
    }, [batchResults, addFavorite, findDuplicate]);

    // ─── 自訂 Header（與 menu / favorites / settings 統一 3 欄式版面）───
    const renderHeader = () => (
        <>
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
                <Text style={styles.customHeaderTitle}>最愛抽獎</Text>
                <Pressable style={styles.headerRightBtn} onPress={() => router.push('/favorites')} accessibilityRole="button" accessibilityLabel="我的清單">
                    {({ pressed }) => (
                        <View style={[styles.headerRightInner, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                            <Ionicons name="list-outline" size={20} color={theme.colors.primary} />
                            <Text style={styles.headerRightText}>清單</Text>
                        </View>
                    )}
                </Pressable>
            </View>
            <View style={styles.divider} />
        </>
    );

    // ─── 分類篩選 Chip 列（需求 3：使用集中管理的 CATEGORY_LABELS，與附近餐廳同步）───
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
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    <Text style={styles.statusBadgeText}>查詢營業狀態...</Text>
                </View>
            );
        }
        if (!openStatus) return null;
        if (!openStatus.isVerified) {
            return (
                <View style={[styles.statusBadge, styles.statusBadgeUnknown]}>
                    <Ionicons name="help-circle-outline" size={16} color={theme.colors.textSecondary} />
                    <Text style={[styles.statusBadgeText, { color: theme.colors.textSecondary }]}>無法確認營業狀態</Text>
                </View>
            );
        }
        return (
            <View style={[styles.statusBadge, openStatus.isOpenNow ? styles.statusBadgeOpen : styles.statusBadgeClosed]}>
                <Ionicons
                    name={openStatus.isOpenNow ? 'checkmark-circle' : 'close-circle'}
                    size={16}
                    color={openStatus.isOpenNow ? theme.colors.success : theme.colors.error}
                />
                <Text style={[styles.statusBadgeText, { color: openStatus.isOpenNow ? theme.colors.success : theme.colors.error }]}>
                    {openStatus.isOpenNow ? '營業中' : '已打烊'}
                </Text>
            </View>
        );
    };

    // ─── 新增餐廳 Modal（需求 2：搜尋模式 + 手動輸入）───
    function renderAddModal() {
        return (
            <Modal visible={showAddModal} transparent animationType="slide">
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.modalOverlay}
                >
                    <View style={[styles.modalContent, { maxHeight: '85%' }]}>
                        <Text style={styles.modalTitle}>新增最愛餐廳</Text>

                        {/* 模式切換 Tab */}
                        <View style={styles.modeTabRow}>
                            <Pressable
                                onPress={() => setAddMode('search')}
                                style={[styles.modeTab, addMode === 'search' && styles.modeTabActive]}
                            >
                                <Ionicons name="search-outline" size={16} color={addMode === 'search' ? theme.colors.onPrimary : theme.colors.textSecondary} />
                                <Text style={[styles.modeTabText, addMode === 'search' && styles.modeTabTextActive]}>搜尋餐廳</Text>
                            </Pressable>
                            <Pressable
                                onPress={() => setAddMode('manual')}
                                style={[styles.modeTab, addMode === 'manual' && styles.modeTabActive]}
                            >
                                <Ionicons name="pencil-outline" size={16} color={addMode === 'manual' ? theme.colors.onPrimary : theme.colors.textSecondary} />
                                <Text style={[styles.modeTabText, addMode === 'manual' && styles.modeTabTextActive]}>手動輸入</Text>
                            </Pressable>
                            <Pressable
                                onPress={() => setAddMode('paste')}
                                style={[styles.modeTab, addMode === 'paste' && styles.modeTabActive]}
                            >
                                <Ionicons name="link-outline" size={16} color={addMode === 'paste' ? theme.colors.onPrimary : theme.colors.textSecondary} />
                                <Text style={[styles.modeTabText, addMode === 'paste' && styles.modeTabTextActive]}>貼上連結</Text>
                            </Pressable>
                        </View>

                        {addMode === 'search' ? (
                            <>
                                {/* 搜尋列 */}
                                <Text style={styles.inputLabel}>搜尋餐廳名稱</Text>
                                <View style={styles.searchRow}>
                                    <TextInput
                                        style={[styles.input, { flex: 1, marginBottom: 0 }]}
                                        placeholder="例如：鼎泰豐"
                                        value={searchQuery}
                                        onChangeText={setSearchQuery}
                                        onSubmitEditing={handleSearch}
                                        autoFocus
                                        returnKeyType="search"
                                    />
                                    <Pressable
                                        onPress={handleSearch}
                                        style={({ pressed }) => [styles.searchBtn, pressed && { opacity: theme.interaction.pressedOpacity }]}
                                    >
                                        <Ionicons name="search" size={20} color={theme.colors.onPrimary} />
                                    </Pressable>
                                </View>

                                {/* 搜尋狀態 */}
                                {searchLoading && (
                                    <View style={styles.searchStatusRow}>
                                        <ActivityIndicator size="small" color={theme.colors.primary} />
                                        <Text style={styles.searchStatusText}>搜尋中...</Text>
                                    </View>
                                )}
                                {searchError && (
                                    <Text style={styles.searchErrorText}>{searchError}</Text>
                                )}

                                {/* 搜尋結果列表 */}
                                {searchResults.length > 0 && (
                                    <FlatList
                                        data={searchResults}
                                        keyExtractor={(item) => item.placeId}
                                        style={{ maxHeight: 220, marginBottom: theme.spacing.md }}
                                        renderItem={({ item }) => {
                                            const isSelected = selectedPlace?.placeId === item.placeId;
                                            return (
                                                <Pressable
                                                    onPress={() => setSelectedPlace(item)}
                                                    style={[styles.searchResultItem, isSelected && styles.searchResultItemSelected]}
                                                >
                                                    <View style={{ flex: 1 }}>
                                                        <Text style={styles.searchResultName}>{item.name}</Text>
                                                        <Text style={styles.searchResultAddress}>{item.address}</Text>
                                                        <View style={styles.searchResultMeta}>
                                                            <Text style={styles.searchResultCategory}>{item.category}</Text>
                                                            {item.rating > 0 && (
                                                                <Text style={styles.searchResultRating}>⭐ {item.rating.toFixed(1)}</Text>
                                                            )}
                                                            <Text style={[styles.searchResultOpen, { color: item.isOpenNow ? theme.colors.success : theme.colors.error }]}>
                                                                {item.isOpenNow ? '營業中' : '已打烊'}
                                                            </Text>
                                                        </View>
                                                    </View>
                                                    {isSelected && (
                                                        <Ionicons name="checkmark-circle" size={24} color={theme.colors.primary} />
                                                    )}
                                                </Pressable>
                                            );
                                        }}
                                        ItemSeparatorComponent={() => <View style={styles.separator} />}
                                    />
                                )}

                                {/* 已選擇的餐廳預覽 */}
                                {selectedPlace && (
                                    <View style={styles.selectedPreview}>
                                        <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
                                        <Text style={styles.selectedPreviewText}>已選擇：{selectedPlace.name}</Text>
                                    </View>
                                )}

                            </>
                        ) : addMode === 'manual' ? (
                            <>
                                {/* 手動輸入模式 */}
                                <Text style={styles.inputLabel}>餐廳名稱 *</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="例如：鼎泰豐"
                                    value={newName}
                                    onChangeText={setNewName}
                                    autoFocus
                                />

                                <Text style={styles.inputLabel}>備註（選填）</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="例如：推薦小籠包"
                                    value={newNote}
                                    onChangeText={setNewNote}
                                />
                            </>
                        ) : (
                            <>
                                {/* 貼上連結模式 */}
                                <Text style={styles.inputLabel}>貼上 Google Maps 分享連結</Text>
                                <View style={styles.searchRow}>
                                    <TextInput
                                        style={[styles.input, { flex: 1, marginBottom: 0, minHeight: 44 }]}
                                        placeholder={"https://maps.app.goo.gl/...\n可貼上多個連結（每行一個）"}
                                        value={pasteUrl}
                                        onChangeText={(text) => {
                                            setPasteUrl(text);
                                            setPasteResult(null);
                                            setBatchResults(null);
                                        }}
                                        onSubmitEditing={handlePasteUrl}
                                        autoFocus
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        multiline
                                        numberOfLines={3}
                                        textAlignVertical="top"
                                    />
                                    <Pressable
                                        onPress={handlePasteUrl}
                                        style={({ pressed }) => [styles.searchBtn, pressed && { opacity: theme.interaction.pressedOpacity }]}
                                        disabled={pasteLoading}
                                    >
                                        {pasteLoading ? (
                                            <ActivityIndicator size="small" color={theme.colors.onPrimary} />
                                        ) : (
                                            <Ionicons name="arrow-forward" size={20} color={theme.colors.onPrimary} />
                                        )}
                                    </Pressable>
                                </View>

                                {/* 解析狀態 */}
                                {pasteLoading && (
                                    <View style={styles.searchStatusRow}>
                                        <ActivityIndicator size="small" color={theme.colors.primary} />
                                        <Text style={styles.searchStatusText}>解析連結中...</Text>
                                    </View>
                                )}

                                {/* 解析錯誤 */}
                                {pasteResult?.error && (
                                    <View style={styles.pasteErrorContainer}>
                                        <Ionicons name="alert-circle-outline" size={18} color={theme.colors.error} />
                                        <Text style={styles.searchErrorText}>{pasteResult.error}</Text>
                                    </View>
                                )}

                                {/* 解析結果預覽 */}
                                {pasteResult?.restaurant && (
                                    <View style={styles.pasteResultPreview}>
                                        <View style={styles.selectedPreview}>
                                            <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
                                            <Text style={styles.selectedPreviewText}>{pasteResult.restaurant.name}</Text>
                                        </View>
                                        <Text style={styles.pasteResultAddress}>📍 {pasteResult.restaurant.address}</Text>
                                        <View style={styles.searchResultMeta}>
                                            <Text style={styles.searchResultCategory}>{pasteResult.restaurant.category}</Text>
                                            {pasteResult.restaurant.rating > 0 && (
                                                <Text style={styles.searchResultRating}>⭐ {pasteResult.restaurant.rating.toFixed(1)}</Text>
                                            )}
                                            <Text style={[styles.searchResultOpen, { color: pasteResult.restaurant.isOpenNow ? theme.colors.success : theme.colors.error }]}>
                                                {pasteResult.restaurant.isOpenNow ? '營業中' : '已打烊'}
                                            </Text>
                                        </View>


                                    </View>
                                )}

                                {/* 備註 */}
                                {pasteResult?.restaurant && (
                                    <>
                                        <Text style={styles.inputLabel}>備註（選填）</Text>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="例如：朋友推薦"
                                            value={newNote}
                                            onChangeText={setNewNote}
                                        />
                                    </>
                                )}

                                {/* 批量解析結果 */}
                                {batchResults && (
                                    <View style={styles.pasteResultPreview}>
                                        <View style={styles.selectedPreview}>
                                            <Ionicons name="layers-outline" size={18} color={theme.colors.primary} />
                                            <Text style={[styles.selectedPreviewText, { color: theme.colors.primary }]}>
                                                偵測到 {batchResults.results.length} 個連結：{batchResults.successCount} 個成功、{batchResults.failedCount} 個失敗
                                            </Text>
                                        </View>
                                        <View style={{ marginTop: theme.spacing.sm }}>
                                            {batchResults.results.map((r, i) => (
                                                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, paddingVertical: 4 }}>
                                                    <Ionicons
                                                        name={r.restaurant ? 'checkmark-circle' : 'close-circle'}
                                                        size={16}
                                                        color={r.restaurant ? theme.colors.success : theme.colors.error}
                                                    />
                                                    <Text style={[styles.searchResultName, { fontSize: 13, flex: 1 }]} numberOfLines={1}>
                                                        {r.restaurant ? r.restaurant.name : (r.error || '解析失敗')}
                                                    </Text>
                                                    {r.restaurant?.category && (
                                                        <Text style={[styles.searchResultCategory, { fontSize: 11 }]}>{r.restaurant.category}</Text>
                                                    )}
                                                </View>
                                            ))}
                                        </View>
                                    </View>
                                )}
                            </>
                        )}

                        {/* 底部按鈕 */}
                        <View style={styles.modalActions}>
                            <Pressable
                                style={({ pressed }) => [styles.modalBtn, styles.cancelBtn, pressed && { opacity: theme.interaction.pressedOpacity }]}
                                onPress={resetAddModal}
                            >
                                <Text style={styles.cancelBtnText}>取消</Text>
                            </Pressable>
                            <Pressable
                                style={({ pressed }) => [
                                    styles.modalBtn, styles.confirmBtn,
                                    pressed && { opacity: theme.interaction.pressedOpacity },
                                    (addMode === 'search' && !selectedPlace) && { opacity: 0.4 },
                                    (addMode === 'paste' && !pasteResult?.restaurant && !batchResults) && { opacity: 0.4 },
                                ]}
                                onPress={
                                    addMode === 'search' ? handleAddFromSearch
                                        : addMode === 'paste'
                                            ? (batchResults ? handleBatchAdd : handleAddFromPaste)
                                            : handleAddManual
                                }
                                disabled={
                                    (addMode === 'search' && !selectedPlace)
                                    || (addMode === 'paste' && !pasteResult?.restaurant && !batchResults)
                                    || batchImporting
                                }
                            >
                                <Text style={styles.confirmBtnText}>
                                    {batchResults
                                        ? (batchImporting ? '匯入中...' : `全部新增 (${batchResults.successCount})`)
                                        : '確認新增'
                                    }
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        );
    }

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
                                        <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
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
                    <Ionicons name="restaurant-outline" size={80} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyTitle}>還沒有最愛餐廳</Text>
                    <Text style={styles.emptyDesc}>先新增幾家愛吃的餐廳{'\n'}系統會每天幫你排一家！</Text>
                    <Pressable onPress={() => setShowAddModal(true)} accessibilityRole="button" accessibilityLabel="新增最愛餐廳">
                        {({ pressed }) => (
                            <View style={[styles.addButton, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                <Ionicons name="add-circle-outline" size={22} color={theme.colors.onPrimary} />
                                <Text style={styles.addButtonText}>新增最愛餐廳</Text>
                            </View>
                        )}
                    </Pressable>
                    {showAddModal && renderAddModal()}
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
                    <Ionicons name="filter-outline" size={60} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyTitle}>此分類沒有餐廳</Text>
                    <Text style={styles.emptyDesc}>試試選擇「全部」或其他分類</Text>
                </View>
                {showAddModal && renderAddModal()}
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
                            style={({ pressed }) => [styles.actionBtn, { backgroundColor: theme.colors.primary }, pressed && { opacity: theme.interaction.pressedOpacity }]}
                            onPress={() => jumpToMap(currentRestaurant.address || currentRestaurant.name, transportMode)}
                            accessibilityRole="button"
                            accessibilityLabel="在 Google Maps 上查看"
                        >
                            <Ionicons name="navigate-outline" size={20} color={theme.colors.onPrimary} />
                            <Text style={styles.actionBtnText}>導航</Text>
                        </Pressable>
                    )}
                    <Pressable
                        style={({ pressed }) => [styles.actionBtn, { backgroundColor: theme.colors.secondary }, pressed && { opacity: theme.interaction.pressedOpacity }]}
                        onPress={handleSkip}
                        disabled={filteredQueue.length <= 1 && isRevealed}
                        accessibilityRole="button"
                        accessibilityLabel="抽獎"
                    >
                        <Ionicons name="dice-outline" size={20} color={theme.colors.onPrimary} />
                        <Text style={styles.actionBtnText}>抽獎</Text>
                    </Pressable>
                </View>

                {/* 已打烊提示（需求 4）*/}
                {isRevealed && openStatus?.isVerified && !openStatus.isOpenNow && (
                    <View style={styles.closedHint}>
                        <Ionicons name="warning-outline" size={18} color={theme.colors.error} />
                        <Text style={styles.closedHintText}>這家已打烊，要再換一家嗎？</Text>
                    </View>
                )}

            </View>

            {showAddModal && renderAddModal()}
            {showListModal && renderListModal()}
        </View>
    );
}

// ──────────── Styles ────────────
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
        paddingHorizontal: 16,
        paddingBottom: 16,
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
        gap: 4,
    },
    backText: {
        ...theme.typography.body,
        color: theme.colors.primary,
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
        color: theme.colors.primary,
        fontWeight: '500',
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.border,
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
        color: theme.colors.text,
        marginTop: theme.spacing.lg,
    },
    emptyDesc: {
        ...theme.typography.bodySmall,
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: theme.spacing.sm,
        marginBottom: theme.spacing.xl,
        lineHeight: 22,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: theme.colors.primary,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.xl,
        borderRadius: theme.borderRadius.lg,
    },
    addButtonText: {
        color: theme.colors.onPrimary,
        ...theme.typography.label,
    },
    // ── 盲盒卡片（需求 1）──
    blindBoxCard: {
        backgroundColor: theme.colors.surface,
        width: '100%',
        padding: theme.spacing.xl,
        borderRadius: theme.borderRadius.lg,
        alignItems: 'center',
        ...theme.shadows.md,
        marginBottom: theme.spacing.xl,
        borderWidth: 2,
        borderColor: theme.colors.primary,
        borderStyle: 'dashed',
    },
    blindBoxEmoji: { fontSize: 64, marginBottom: theme.spacing.md },
    blindBoxTitle: {
        ...theme.typography.h2,
        color: theme.colors.text,
        marginBottom: theme.spacing.xs,
    },
    blindBoxDesc: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    // ── 今日推薦 ──
    todayLabel: {
        ...theme.typography.body,
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.sm,
    },
    todayCard: {
        backgroundColor: theme.colors.surface,
        width: '100%',
        padding: theme.spacing.xl,
        borderRadius: theme.borderRadius.lg,
        alignItems: 'center',
        ...theme.shadows.md,
        marginBottom: theme.spacing.xl,
    },
    todayEmoji: { fontSize: 48, marginBottom: theme.spacing.md },
    todayName: {
        ...theme.typography.h1,
        color: theme.colors.text,
    },
    todayCategory: {
        ...theme.typography.caption,
        color: theme.colors.primary,
        marginTop: theme.spacing.xs,
        fontWeight: '600',
    },
    todayNote: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        marginTop: theme.spacing.xs,
    },
    todayAddress: {
        ...theme.typography.caption,
        color: theme.colors.textSecondary,
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
        backgroundColor: theme.colors.background,
    },
    statusBadgeOpen: {
        backgroundColor: `${theme.colors.success}18`,
    },
    statusBadgeClosed: {
        backgroundColor: `${theme.colors.error}18`,
    },
    statusBadgeUnknown: {
        backgroundColor: theme.colors.background,
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
        backgroundColor: `${theme.colors.error}12`,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.md,
        marginBottom: theme.spacing.md,
    },
    closedHintText: {
        ...theme.typography.bodySmall,
        color: theme.colors.error,
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
        color: theme.colors.onPrimary,
        ...theme.typography.bodySmall,
        fontSize: 15,
        fontWeight: '600',
    },


    // ── Modal 共用 ──
    modalOverlay: {
        flex: 1,
        backgroundColor: theme.colors.overlay,
        justifyContent: 'center',
        padding: theme.spacing.lg,
    },
    modalContent: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.xl,
    },
    modalTitle: {
        ...theme.typography.h3,
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.text,
        marginBottom: theme.spacing.lg,
    },
    // ── 模式切換 Tab（需求 2）──
    modeTabRow: {
        flexDirection: 'row',
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.lg,
    },
    modeTab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.background,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    modeTabActive: {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
    },
    modeTabText: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        fontWeight: '600',
    },
    modeTabTextActive: {
        color: theme.colors.onPrimary,
    },
    // ── 搜尋列 ──
    searchRow: {
        flexDirection: 'row',
        gap: theme.spacing.sm,
        alignItems: 'center',
        marginBottom: theme.spacing.md,
    },
    searchBtn: {
        width: 44,
        height: 44,
        borderRadius: theme.borderRadius.md,
        backgroundColor: theme.colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    searchStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.sm,
    },
    searchStatusText: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
    },
    searchErrorText: {
        ...theme.typography.bodySmall,
        color: theme.colors.error,
        marginBottom: theme.spacing.sm,
    },
    // ── 搜尋結果列表 ──
    searchResultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.borderRadius.md,
    },
    searchResultItemSelected: {
        backgroundColor: `${theme.colors.primary}12`,
    },
    searchResultName: {
        ...theme.typography.body,
        fontWeight: '600',
        color: theme.colors.text,
    },
    searchResultAddress: {
        ...theme.typography.caption,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    searchResultMeta: {
        flexDirection: 'row',
        gap: theme.spacing.sm,
        marginTop: 4,
    },
    searchResultCategory: {
        ...theme.typography.caption,
        color: theme.colors.primary,
        fontWeight: '600',
    },
    searchResultRating: {
        ...theme.typography.caption,
        color: theme.colors.star,
    },
    searchResultOpen: {
        ...theme.typography.caption,
        fontWeight: '500',
    },
    // ── 已選擇預覽 ──
    selectedPreview: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        backgroundColor: `${theme.colors.success}12`,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.md,
        marginBottom: theme.spacing.md,
    },
    selectedPreviewText: {
        ...theme.typography.bodySmall,
        color: theme.colors.success,
        fontWeight: '600',
    },
    // ── 表單元素 ──
    inputLabel: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.xs,
    },
    input: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        ...theme.typography.body,
        marginBottom: theme.spacing.md,
        color: theme.colors.text,
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
        backgroundColor: theme.colors.background,
    },
    cancelBtnText: { color: theme.colors.textSecondary, fontWeight: '600' },
    confirmBtn: {
        backgroundColor: theme.colors.primary,
    },
    confirmBtnText: { color: theme.colors.onPrimary, fontWeight: '600' },
    // ── 清單 Modal ──
    listItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: theme.spacing.md,
    },
    listItemName: { ...theme.typography.body, fontWeight: '600', color: theme.colors.text },
    listItemCategory: { ...theme.typography.caption, color: theme.colors.primary, marginTop: 2, fontWeight: '500' },
    listItemNote: { ...theme.typography.caption, fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 },
    listItemAddress: { ...theme.typography.caption, fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
    // ── 貼上連結模式 ──
    pasteErrorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        marginBottom: theme.spacing.sm,
        paddingHorizontal: theme.spacing.sm,
    },
    pasteResultPreview: {
        backgroundColor: `${theme.colors.primary}08`,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.md,
        borderWidth: 1,
        borderColor: `${theme.colors.primary}20`,
    },
    pasteResultAddress: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.sm,
    },
    separator: { height: 1, backgroundColor: theme.colors.border },
});
