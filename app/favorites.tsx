// ============================================================================
// ❤️ Favorites Screen — P4 最愛餐廳紀錄
// ============================================================================
//
// 依照 PAGE_SPEC.md § P4 規格實作。
//
// 3 大 UI 區塊：
//   1. Header — 三欄式（返回 / 標題 / 編輯排序）
//   2. Card List — 一般模式 + 編輯模式（可拖曳排序）
//   3. FAB — 浮動新增按鈕
//
// 額外功能：
//   - 編輯 Modal — 點擊卡片修改名稱/備註
//   - 🗺️ 導航至外部地圖
//
// 💡 Web 嵌套 <button> 修復：
//   外層卡片在 Web 用 View + onClick（而非 Pressable），
//   避免 <button> 嵌套 <button> 的 hydration 錯誤。
// ============================================================================

import React, { useState, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    Alert,
    Platform,
    TextInput,
    Modal,
    KeyboardAvoidingView,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '../src/constants/theme';
import { useFavoriteStore, FavoriteRestaurant } from '../src/store/useFavoriteStore';
import { useUserStore } from '../src/store/useUserStore';
import { useMapJump } from '../src/hooks/useMapJump';
import { usePlaceSearch } from '../src/hooks/usePlaceSearch';
import { useLocation } from '../src/hooks/useLocation';
import { parseGoogleMapsUrl, isGoogleMapsUrl, ParseResult, batchParseGoogleMapsUrls, BatchParseResult } from '../src/services/googleMapsUrlParser';
import { PlaceSearchResult } from '../src/types/models';

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

// ── 拖曳排序（Native + Web 相容）──
import DraggableFlatList, {
    RenderItemParams,
    ScaleDecorator,
} from 'react-native-draggable-flatlist';
// ── RNGH Touchable — 在 DraggableFlatList 內部必須使用 RNGH 自己的觸控元件 ──
// 原因：DraggableFlatList 使用 RNGH 的手勢系統，會攔截所有 DOM 事件，
//       導致 RN Pressable 和 View+onClick 在 Web 上無法觸發。
import { TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';

// 注意：不引入 Swipeable，刪除操作統一在編輯模式中處理

// ─────────────────────────────────────────────────────────────────────────────
// 📱 FavoritesScreen — Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function FavoritesScreen() {
    'use no memo';
    const router = useRouter();
    const {
        favorites,
        queue,
        removeFavorite,
        addFavorite,
        updateFavoriteName,
        updateFavoriteNote,
        reorderQueue,
        findDuplicate,
    } = useFavoriteStore();
    const transportMode = useUserStore((s) => s.transportMode);
    const { jumpToMap } = useMapJump();
    const { location } = useLocation();
    const { results: searchResults, loading: searchLoading, error: searchError, searchImmediate, clearResults } = usePlaceSearch();

    // ── 狀態 ──
    const [isEditing, setIsEditing] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editTarget, setEditTarget] = useState<FavoriteRestaurant | null>(null);
    const [editName, setEditName] = useState('');
    const [editNote, setEditNote] = useState('');
    const [newName, setNewName] = useState('');
    const [newNote, setNewNote] = useState('');

    // ── 新增 Modal 多模式狀態 ──
    const [addMode, setAddMode] = useState<'search' | 'manual' | 'paste'>('search');
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
                    // 自動觸發解析
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
                // 剪貼簿讀取失敗（權限問題等）——靜默略過
            }
        })();
        return () => { cancelled = true; };
    }, [addMode, showAddModal]);

    // ── 按佇列順序排列 favorites ──
    const sortedByQueue = [...favorites].sort((a, b) => {
        const ai = queue.indexOf(a.id);
        const bi = queue.indexOf(b.id);
        // 不在佇列中的排最後
        const aPriority = ai === -1 ? Infinity : ai;
        const bPriority = bi === -1 ? Infinity : bi;
        return aPriority - bPriority;
    });

    // ── Header 返回 ──
    const handleBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/');
    };

    // ── 刪除確認 ──
    const handleRemove = (id: string, name: string) => {
        console.log('[handleRemove] called for:', name, id);
        if (Platform.OS === 'web') {
            // Web: 使用 window.confirm（Alert.alert 在部分 RNW 版本可能靜默失敗）
            const confirmed = window.confirm(`確定要把「${name}」從最愛清單移除嗎？`);
            if (confirmed) {
                removeFavorite(id);
            }
        } else {
            Alert.alert('確認刪除', `確定要把「${name}」從最愛清單移除嗎？`, [
                { text: '取消', style: 'cancel' },
                { text: '刪除', style: 'destructive', onPress: () => removeFavorite(id) },
            ]);
        }
    };

    // ── 搜尋按鈕處理 ──
    const handleSearch = useCallback(() => {
        searchImmediate(searchQuery, location?.latitude && location?.longitude ? { lat: location.latitude, lng: location.longitude } : undefined);
    }, [searchQuery, searchImmediate, location]);

    // ── 從搜尋結果新增（含重複防呆） ──
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
        };
        if (dup) {
            Alert.alert('⚠️ 此餐廳已在清單中', `「${dup.name}」已經是你的最愛了`, [
                { text: '仍要新增', onPress: doAdd },
                { text: '取消', style: 'cancel' },
            ]);
            return;
        }
        doAdd();
    }, [selectedPlace, newNote, addFavorite, findDuplicate]);

    // ── 手動新增（含重複防呆） ──
    const handleAddManual = useCallback(() => {
        const trimmed = newName.trim();
        if (!trimmed) {
            Alert.alert('請輸入餐廳名稱');
            return;
        }
        const dup = findDuplicate(trimmed);
        const doAdd = () => {
            addFavorite(trimmed, newNote.trim() || undefined);
            resetAddModal();
            Alert.alert('✅ 新增成功', `「${trimmed}」已加入最愛清單`);
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

    // ── 貼上連結解析（單一 or 批量） ──
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
            // 批量模式
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

    // ── 從貼上連結結果新增（單一，含重複防呆） ──
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
        };
        if (dup) {
            // Web 上 Alert.alert 帶按鈕回調可能不觸發，改用 window.confirm
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
    }, [batchResults, addFavorite, findDuplicate]);

    // ── 重置新增 Modal 所有狀態 ──
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

    // ── 開啟編輯 Modal ──
    const openEditModal = (item: FavoriteRestaurant) => {
        setEditTarget(item);
        setEditName(item.name);
        setEditNote(item.note ?? '');
        setShowEditModal(true);
    };

    // ── 儲存編輯 ──
    const handleSaveEdit = () => {
        if (!editTarget) return;
        const trimmedName = editName.trim();
        if (!trimmedName) {
            Alert.alert('餐廳名稱不可為空');
            return;
        }
        if (trimmedName !== editTarget.name) {
            updateFavoriteName(editTarget.id, trimmedName);
        }
        const trimmedNote = editNote.trim();
        if (trimmedNote !== (editTarget.note ?? '')) {
            updateFavoriteNote(editTarget.id, trimmedNote);
        }
        setShowEditModal(false);
        setEditTarget(null);
    };

    // ── 導航 ──
    const handleNavigate = (item: FavoriteRestaurant) => {
        jumpToMap(item.address || item.name, transportMode);
    };

    // ── 拖曳排序完成 ──
    const handleDragEnd = useCallback(({ data }: { data: FavoriteRestaurant[] }) => {
        const newOrder = data.map((item) => item.id);
        reorderQueue(newOrder);
    }, [reorderQueue]);

    // ── 上移 / 下移（Web 編輯模式）──
    const handleMoveUp = useCallback((id: string) => {
        const idx = sortedByQueue.findIndex((f) => f.id === id);
        if (idx <= 0) return;
        const newOrder = sortedByQueue.map((f) => f.id);
        [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
        reorderQueue(newOrder);
    }, [sortedByQueue, reorderQueue]);

    const handleMoveDown = useCallback((id: string) => {
        const idx = sortedByQueue.findIndex((f) => f.id === id);
        if (idx === -1 || idx >= sortedByQueue.length - 1) return;
        const newOrder = sortedByQueue.map((f) => f.id);
        [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
        reorderQueue(newOrder);
    }, [sortedByQueue, reorderQueue]);

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: 新增餐廳 Modal（三模式：搜尋 / 手動 / 貼上連結）
    // ═══════════════════════════════════════════════════════════════════════
    function renderAddModal() {
        return (
            <Modal visible={showAddModal} transparent animationType="slide">
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={addModalStyles.overlay}
                >
                    <View style={[addModalStyles.content, { maxHeight: '85%' }]}>
                        <Text style={addModalStyles.title}>新增最愛餐廳</Text>

                        {/* 模式切換 Tab */}
                        <View style={addModalStyles.modeTabRow}>
                            <Pressable
                                onPress={() => setAddMode('search')}
                                style={[addModalStyles.modeTab, addMode === 'search' && addModalStyles.modeTabActive]}
                            >
                                <Ionicons name="search-outline" size={16} color={addMode === 'search' ? theme.colors.onPrimary : theme.colors.textSecondary} />
                                <Text style={[addModalStyles.modeTabText, addMode === 'search' && addModalStyles.modeTabTextActive]}>搜尋餐廳</Text>
                            </Pressable>
                            <Pressable
                                onPress={() => setAddMode('manual')}
                                style={[addModalStyles.modeTab, addMode === 'manual' && addModalStyles.modeTabActive]}
                            >
                                <Ionicons name="pencil-outline" size={16} color={addMode === 'manual' ? theme.colors.onPrimary : theme.colors.textSecondary} />
                                <Text style={[addModalStyles.modeTabText, addMode === 'manual' && addModalStyles.modeTabTextActive]}>手動輸入</Text>
                            </Pressable>
                            <Pressable
                                onPress={() => setAddMode('paste')}
                                style={[addModalStyles.modeTab, addMode === 'paste' && addModalStyles.modeTabActive]}
                            >
                                <Ionicons name="link-outline" size={16} color={addMode === 'paste' ? theme.colors.onPrimary : theme.colors.textSecondary} />
                                <Text style={[addModalStyles.modeTabText, addMode === 'paste' && addModalStyles.modeTabTextActive]}>貼上連結</Text>
                            </Pressable>
                        </View>

                        {addMode === 'search' ? (
                            <>
                                {/* 搜尋列 */}
                                <Text style={addModalStyles.inputLabel}>餐廳名稱 *</Text>
                                <View style={addModalStyles.searchRow}>
                                    <TextInput
                                        style={[addModalStyles.input, { flex: 1, marginBottom: 0 }]}
                                        placeholder="搜尋餐廳名稱（如：鼎泰豐）"
                                        placeholderTextColor={theme.colors.textSecondary}
                                        value={searchQuery}
                                        onChangeText={setSearchQuery}
                                        onSubmitEditing={handleSearch}
                                        autoFocus
                                        returnKeyType="search"
                                    />
                                    <Pressable
                                        onPress={handleSearch}
                                        style={({ pressed }) => [addModalStyles.searchBtn, pressed && { opacity: theme.interaction.pressedOpacity }]}
                                    >
                                        <Ionicons name="search" size={20} color={theme.colors.onPrimary} />
                                    </Pressable>
                                </View>

                                {/* 搜尋狀態 */}
                                {searchLoading && (
                                    <View style={addModalStyles.searchStatusRow}>
                                        <ActivityIndicator size="small" color={theme.colors.primary} />
                                        <Text style={addModalStyles.searchStatusText}>搜尋中...</Text>
                                    </View>
                                )}
                                {searchError && (
                                    <Text style={addModalStyles.searchErrorText}>{searchError}</Text>
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
                                                    style={[addModalStyles.searchResultItem, isSelected && addModalStyles.searchResultItemSelected]}
                                                >
                                                    <View style={{ flex: 1 }}>
                                                        <Text style={addModalStyles.searchResultName}>{item.name}</Text>
                                                        <Text style={addModalStyles.searchResultAddress}>{item.address}</Text>
                                                        <View style={addModalStyles.searchResultMeta}>
                                                            <Text style={addModalStyles.searchResultCategory}>{item.category}</Text>
                                                            {item.rating > 0 && (
                                                                <Text style={addModalStyles.searchResultRating}>⭐ {item.rating.toFixed(1)}</Text>
                                                            )}
                                                            <Text style={[addModalStyles.searchResultOpen, { color: item.isOpenNow ? theme.colors.success : theme.colors.error }]}>
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
                                        ItemSeparatorComponent={() => <View style={addModalStyles.separator} />}
                                    />
                                )}

                                {/* 已選擇的餐廳預覽 */}
                                {selectedPlace && (
                                    <View style={addModalStyles.selectedPreview}>
                                        <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
                                        <Text style={addModalStyles.selectedPreviewText}>已選擇：{selectedPlace.name}</Text>
                                    </View>
                                )}


                            </>
                        ) : addMode === 'manual' ? (
                            <>
                                {/* 手動輸入模式 */}
                                <Text style={addModalStyles.inputLabel}>餐廳名稱 *</Text>
                                <TextInput
                                    style={addModalStyles.input}
                                    placeholder="例如：鼎泰豐"
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={newName}
                                    onChangeText={setNewName}
                                    autoFocus
                                />

                                <Text style={addModalStyles.inputLabel}>備註（選填）</Text>
                                <TextInput
                                    style={addModalStyles.input}
                                    placeholder="例如：推薦小籠包"
                                    placeholderTextColor={theme.colors.textSecondary}
                                    value={newNote}
                                    onChangeText={setNewNote}
                                />
                            </>
                        ) : (
                            <>
                                {/* 貼上連結模式 */}
                                <Text style={addModalStyles.inputLabel}>貼上 Google Maps 分享連結</Text>
                                <View style={addModalStyles.searchRow}>
                                    <TextInput
                                        style={[addModalStyles.input, { flex: 1, marginBottom: 0, minHeight: 44 }]}
                                        placeholder="https://maps.app.goo.gl/...
可貼上多個連結（每行一個）"
                                        placeholderTextColor={theme.colors.textSecondary}
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
                                        style={({ pressed }) => [addModalStyles.searchBtn, pressed && { opacity: theme.interaction.pressedOpacity }]}
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
                                    <View style={addModalStyles.searchStatusRow}>
                                        <ActivityIndicator size="small" color={theme.colors.primary} />
                                        <Text style={addModalStyles.searchStatusText}>解析連結中...</Text>
                                    </View>
                                )}

                                {/* 解析錯誤 */}
                                {pasteResult?.error && (
                                    <View style={addModalStyles.pasteErrorContainer}>
                                        <Ionicons name="alert-circle-outline" size={18} color={theme.colors.error} />
                                        <Text style={addModalStyles.searchErrorText}>{pasteResult.error}</Text>
                                    </View>
                                )}

                                {/* 解析結果預覽 */}
                                {pasteResult?.restaurant && (
                                    <View style={addModalStyles.pasteResultPreview}>
                                        <View style={addModalStyles.selectedPreview}>
                                            <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
                                            <Text style={addModalStyles.selectedPreviewText}>{pasteResult.restaurant.name}</Text>
                                        </View>
                                        <Text style={addModalStyles.pasteResultAddress}>📍 {pasteResult.restaurant.address}</Text>
                                        <View style={addModalStyles.searchResultMeta}>
                                            <Text style={addModalStyles.searchResultCategory}>{pasteResult.restaurant.category}</Text>
                                            {pasteResult.restaurant.rating > 0 && (
                                                <Text style={addModalStyles.searchResultRating}>⭐ {pasteResult.restaurant.rating.toFixed(1)}</Text>
                                            )}
                                            <Text style={[addModalStyles.searchResultOpen, { color: pasteResult.restaurant.isOpenNow ? theme.colors.success : theme.colors.error }]}>
                                                {pasteResult.restaurant.isOpenNow ? '營業中' : '已打烊'}
                                            </Text>
                                        </View>


                                    </View>
                                )}

                                {/* 備註 */}
                                {pasteResult?.restaurant && (
                                    <>
                                        <Text style={addModalStyles.inputLabel}>備註（選填）</Text>
                                        <TextInput
                                            style={addModalStyles.input}
                                            placeholder="例如：朋友推薦"
                                            placeholderTextColor={theme.colors.textSecondary}
                                            value={newNote}
                                            onChangeText={setNewNote}
                                        />
                                    </>
                                )}

                                {/* 批量解析結果 */}
                                {batchResults && (
                                    <View style={addModalStyles.pasteResultPreview}>
                                        <View style={addModalStyles.selectedPreview}>
                                            <Ionicons name="layers-outline" size={18} color={theme.colors.primary} />
                                            <Text style={[addModalStyles.selectedPreviewText, { color: theme.colors.primary }]}>
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
                                                    <Text style={[addModalStyles.searchResultName, { fontSize: 13, flex: 1 }]} numberOfLines={1}>
                                                        {r.restaurant ? r.restaurant.name : (r.error || '解析失敗')}
                                                    </Text>
                                                    {r.restaurant?.category && (
                                                        <Text style={[addModalStyles.searchResultCategory, { fontSize: 11 }]}>{r.restaurant.category}</Text>
                                                    )}
                                                </View>
                                            ))}
                                        </View>
                                    </View>
                                )}
                            </>
                        )}

                        {/* 底部按鈕 */}
                        <View style={addModalStyles.actions}>
                            <Pressable
                                style={({ pressed }) => [addModalStyles.btn, addModalStyles.cancelBtn, pressed && { opacity: theme.interaction.pressedOpacity }]}
                                onPress={resetAddModal}
                            >
                                <Text style={addModalStyles.cancelText}>取消</Text>
                            </Pressable>
                            <Pressable
                                style={({ pressed }) => [
                                    addModalStyles.btn, addModalStyles.confirmBtn,
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
                                <Text style={addModalStyles.confirmText}>
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

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: 空狀態
    // ═══════════════════════════════════════════════════════════════════════
    if (favorites.length === 0) {
        return (
            <View style={styles.screenContainer}>
                <HeaderBar isEditing={false} onBack={handleBack} onToggleEdit={() => {}} hideEdit />
                <View style={styles.divider} />
                <View style={styles.emptyContainer}>
                    <View style={styles.emptyIconWrap}>
                        <Ionicons name="heart-outline" size={72} color={theme.colors.primary + '80'} />
                    </View>
                    <Text style={styles.emptyTitle}>還沒有最愛餐廳</Text>
                    <Text style={styles.emptyDesc}>
                        去附近逛逛，找到喜歡的餐廳加入最愛吧！
                    </Text>
                    {/* 主要 CTA → P3 */}
                    <Pressable
                        style={({ pressed }) => [styles.ctaBtn, pressed && { opacity: theme.interaction.pressedOpacity }]}
                        onPress={() => router.push('/(tabs)/nearest')}
                    >
                        <Ionicons name="location-outline" size={18} color={theme.colors.onPrimary} />
                        <Text style={styles.ctaBtnText}>探索附近餐廳</Text>
                    </Pressable>
                    {/* 次要 CTA → AddModal */}
                    <Pressable
                        style={({ pressed }) => [styles.ctaBtnSecondary, pressed && { opacity: theme.interaction.pressedOpacity }]}
                        onPress={() => setShowAddModal(true)}
                    >
                        <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary} />
                        <Text style={styles.ctaBtnSecondaryText}>手動新增</Text>
                    </Pressable>
                </View>
                {showAddModal && renderAddModal()}
            </View>
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: 一般模式 + 編輯模式
    // ═══════════════════════════════════════════════════════════════════════

    return (
        <View style={styles.screenContainer}>
            {/* ── 1. Header ── */}
            <HeaderBar
                isEditing={isEditing}
                onBack={handleBack}
                onToggleEdit={() => setIsEditing((v) => !v)}
            />
            <View style={styles.divider} />

            {/* ── 2. Card List ── */}
            {isEditing ? (
                // 編輯模式
                Platform.OS === 'web' ? (
                    // Web：用普通 FlatList + 上下按鈕（DraggableFlatList 在 Web 會吞吃所有事件）
                    <FlatList
                        data={sortedByQueue}
                        keyExtractor={(item) => item.id}
                        renderItem={({ item, index }) => (
                            <WebEditCard
                                item={item}
                                index={index}
                                total={sortedByQueue.length}
                                onRemove={() => handleRemove(item.id, item.name)}
                                onMoveUp={() => handleMoveUp(item.id)}
                                onMoveDown={() => handleMoveDown(item.id)}
                            />
                        )}
                        contentContainerStyle={styles.list}
                        ItemSeparatorComponent={() => <View style={styles.separator} />}
                    />
                ) : (
                    // Native：拖曳排序
                    <DraggableFlatList
                        data={sortedByQueue}
                        keyExtractor={(item) => item.id}
                        onDragEnd={handleDragEnd}
                        renderItem={({ item, drag, isActive }: RenderItemParams<FavoriteRestaurant>) => (
                            <ScaleDecorator>
                                <EditCard
                                    item={item}
                                    onDrag={drag}
                                    isActive={isActive}
                                    onRemove={() => handleRemove(item.id, item.name)}
                                />
                            </ScaleDecorator>
                        )}
                        contentContainerStyle={styles.list}
                        ItemSeparatorComponent={() => <View style={styles.separator} />}
                    />
                )
            ) : (
                // 一般模式
                <FlatList
                    data={sortedByQueue}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <NormalCard
                            item={item}
                            onPress={() => openEditModal(item)}
                            onNavigate={() => handleNavigate(item)}
                        />
                    )}
                    ItemSeparatorComponent={() => <View style={styles.separator} />}
                    contentContainerStyle={styles.list}
                />
            )}

            {/* ── 3. FAB 浮動新增按鈕 ── */}
            {!isEditing && (
                <Pressable
                    style={({ pressed }) => [styles.fab, pressed && { opacity: theme.interaction.pressedOpacity }]}
                    onPress={() => setShowAddModal(true)}
                    accessibilityRole="button"
                    accessibilityLabel="新增最愛餐廳"
                >
                    <Ionicons name="add" size={28} color={theme.colors.onPrimary} />
                </Pressable>
            )}

            {/* ── 新增 Modal（三模式：搜尋/手動/貼上連結） ── */}
            {showAddModal && renderAddModal()}

            {/* ── 編輯 Modal ── */}
            <EditModal
                visible={showEditModal}
                onClose={() => { setShowEditModal(false); setEditTarget(null); }}
                onSave={handleSaveEdit}
                name={editName}
                note={editNote}
                onNameChange={setEditName}
                onNoteChange={setEditNote}
            />
        </View>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 🧩 子元件
// ─────────────────────────────────────────────────────────────────────────────

// ── Header Bar ──
function HeaderBar({
    isEditing,
    onBack,
    onToggleEdit,
    hideEdit,
}: {
    isEditing: boolean;
    onBack: () => void;
    onToggleEdit: () => void;
    hideEdit?: boolean;
}) {
    return (
        <View style={styles.customHeader}>
            <Pressable
                onPress={onBack}
                hitSlop={12}
                style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
            >
                <Ionicons name="arrow-back-outline" size={20} color={theme.colors.primary} />
                <Text style={styles.backText}>返回</Text>
            </Pressable>

            <Text style={styles.customHeaderTitle}>最愛清單</Text>

            {hideEdit ? (
                <View style={styles.headerSpacer} />
            ) : (
                <Pressable
                    onPress={onToggleEdit}
                    hitSlop={12}
                    style={({ pressed }) => [styles.headerActionBtn, pressed && { opacity: 0.6 }]}
                >
                    <Ionicons
                        name={isEditing ? 'checkmark-outline' : 'create-outline'}
                        size={20}
                        color={isEditing ? theme.colors.success : theme.colors.primary}
                    />
                    <Text style={[styles.headerActionText, isEditing && { color: theme.colors.success }]}>
                        {isEditing ? '完成' : '編輯'}
                    </Text>
                </Pressable>
            )}
        </View>
    );
}

// ── Normal Card（一般模式）──
// 💡 Web：外層用 View + onClick 避免 <button> 嵌套 <button>
//    Native：用 Pressable（原生端無 HTML 嵌套限制）
function NormalCard({
    item,
    onPress,
    onNavigate,
}: {
    item: FavoriteRestaurant;
    onPress: () => void;
    onNavigate: () => void;
}) {
    const [pressed, setPressed] = useState(false);
    const [navPressed, setNavPressed] = useState(false);

    const isWeb = Platform.OS === 'web';

    // ── 導航按鈕：Web 用 View + onClick 避免嵌套 <button> ──
    const navButton = isWeb ? (
        <View
            // @ts-expect-error — RNW 支援 onClick/onMouseDown 等但型別不完整
            onClick={(e: any) => {
                e?.stopPropagation?.();
                onNavigate();
            }}
            onMouseDown={() => setNavPressed(true)}
            onMouseUp={() => setNavPressed(false)}
            onMouseLeave={() => setNavPressed(false)}
            aria-label={`導航至 ${item.name}`}
            style={[
                styles.cardIconBtn,
                { cursor: 'pointer' } as any,
                navPressed && { opacity: theme.interaction.pressedOpacity },
            ]}
        >
            <Ionicons name="navigate-outline" size={20} color={theme.colors.primary} />
        </View>
    ) : (
        <Pressable
            onPress={(e) => {
                e.stopPropagation?.();
                onNavigate();
            }}
            hitSlop={8}
            style={({ pressed: p }) => [styles.cardIconBtn, p && { opacity: theme.interaction.pressedOpacity }]}
            accessibilityRole="button"
            accessibilityLabel={`導航至 ${item.name}`}
        >
            <Ionicons name="navigate-outline" size={20} color={theme.colors.primary} />
        </Pressable>
    );

    const cardInner = (
        <>
            {/* 餐廳資訊 */}
            <View style={styles.cardInfo}>
                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                {item.note ? (
                    <Text style={styles.cardNote} numberOfLines={1}>{item.note}</Text>
                ) : null}
            </View>

            {/* 🗺️ 導航 */}
            {navButton}
        </>
    );

    // ── Web：View + onClick 避免嵌套 <button> ──
    // 💡 不設 accessibilityRole="button"，因為 RNW 會將其渲染為 <button>
    //    改用 role="none" + aria-label 保留語意但避免產生 <button> 標籤
    if (isWeb) {
        return (
            <View
                // @ts-expect-error — RNW 支援 onClick 但型別定義不完整
                onClick={onPress}
                onMouseDown={() => setPressed(true)}
                onMouseUp={() => setPressed(false)}
                onMouseLeave={() => setPressed(false)}
                aria-label={`${item.name}，點擊編輯`}
                tabIndex={0}
                onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPress(); } }}
                style={[
                    styles.card,
                    { cursor: 'pointer' } as any,
                    pressed && { opacity: theme.interaction.pressedOpacity },
                ]}
            >
                {cardInner}
            </View>
        );
    }

    // ── Native：Pressable（無 HTML 嵌套限制）──
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed: p }) => [
                styles.card,
                p && { opacity: theme.interaction.pressedOpacity },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}，點擊編輯`}
        >
            {cardInner}
        </Pressable>
    );
}

// ── Edit Card（Native 編輯模式 — 拖曳排序）──
// 💡 僅 Native 使用，使用 RNGH TouchableOpacity
function EditCard({
    item,
    onDrag,
    isActive,
    onRemove,
}: {
    item: FavoriteRestaurant;
    onDrag: () => void;
    isActive: boolean;
    onRemove: () => void;
}) {
    return (
        <View style={[styles.editCard, isActive && styles.editCardActive]}>
            <GHTouchableOpacity
                onLongPress={onDrag}
                delayLongPress={100}
                activeOpacity={0.6}
                style={styles.dragHandle}
                accessibilityLabel="長按拖曳排序"
            >
                <Ionicons name="menu-outline" size={22} color={theme.colors.textSecondary} />
            </GHTouchableOpacity>

            <View style={styles.editCardInfo}>
                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                {item.note ? (
                    <Text style={styles.cardNote} numberOfLines={1}>{item.note}</Text>
                ) : null}
            </View>

            <GHTouchableOpacity
                onPress={onRemove}
                activeOpacity={theme.interaction.pressedOpacity}
                style={styles.editDeleteBtn}
                accessibilityLabel={`刪除 ${item.name}`}
            >
                <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
            </GHTouchableOpacity>
        </View>
    );
}

// ── Web Edit Card（Web 編輯模式 — 上下排序 + 刪除）──
// 💡 Web 不用 DraggableFlatList（它會吞吃所有 DOM 事件），
//    改用普通 FlatList + Pressable 按鈕。
function WebEditCard({
    item,
    index,
    total,
    onRemove,
    onMoveUp,
    onMoveDown,
}: {
    item: FavoriteRestaurant;
    index: number;
    total: number;
    onRemove: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
}) {
    return (
        <View style={styles.editCard}>
            {/* 上移 / 下移 */}
            <View style={styles.reorderBtns}>
                <Pressable
                    onPress={onMoveUp}
                    disabled={index === 0}
                    style={({ pressed }) => [
                        styles.reorderBtn,
                        index === 0 && styles.reorderBtnDisabled,
                        pressed && { opacity: theme.interaction.pressedOpacity },
                    ]}
                    accessibilityLabel="上移"
                >
                    <Ionicons name="chevron-up" size={18} color={index === 0 ? theme.colors.border : theme.colors.textSecondary} />
                </Pressable>
                <Pressable
                    onPress={onMoveDown}
                    disabled={index === total - 1}
                    style={({ pressed }) => [
                        styles.reorderBtn,
                        index === total - 1 && styles.reorderBtnDisabled,
                        pressed && { opacity: theme.interaction.pressedOpacity },
                    ]}
                    accessibilityLabel="下移"
                >
                    <Ionicons name="chevron-down" size={18} color={index === total - 1 ? theme.colors.border : theme.colors.textSecondary} />
                </Pressable>
            </View>

            {/* 餐廳資訊 */}
            <View style={styles.editCardInfo}>
                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                {item.note ? (
                    <Text style={styles.cardNote} numberOfLines={1}>{item.note}</Text>
                ) : null}
            </View>

            {/* 刪除 — 使用 View+onClick 避免 Pressable 在 Web 端的未知交互問題 */}
            <View
                // @ts-expect-error — RNW 支援 onClick 但型別定義不完整
                onClick={() => onRemove()}
                aria-label={`刪除 ${item.name}`}
                tabIndex={0}
                onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(); } }}
                style={[
                    styles.editDeleteBtn,
                    { cursor: 'pointer' } as any,
                ]}
            >
                <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
            </View>
        </View>
    );
}



// ── Edit Modal（修改名稱/備註）──
function EditModal({
    visible,
    onClose,
    onSave,
    name,
    note,
    onNameChange,
    onNoteChange,
}: {
    visible: boolean;
    onClose: () => void;
    onSave: () => void;
    name: string;
    note: string;
    onNameChange: (v: string) => void;
    onNoteChange: (v: string) => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={modalStyles.overlay}
            >
                <Pressable style={modalStyles.overlay} onPress={onClose}>
                    <Pressable onPress={() => {}} style={modalStyles.content}>
                        <Text style={modalStyles.title}>編輯餐廳資訊</Text>
                        <Text style={modalStyles.inputLabel}>餐廳名稱 *</Text>
                        <TextInput
                            style={modalStyles.input}
                            placeholder="餐廳名稱"
                            placeholderTextColor={theme.colors.textSecondary}
                            value={name}
                            onChangeText={onNameChange}
                            autoFocus
                            returnKeyType="next"
                        />
                        <Text style={modalStyles.inputLabel}>備註（選填）</Text>
                        <TextInput
                            style={modalStyles.input}
                            placeholder="例：推薦菜色"
                            placeholderTextColor={theme.colors.textSecondary}
                            value={note}
                            onChangeText={onNoteChange}
                            returnKeyType="done"
                            onSubmitEditing={onSave}
                        />
                        <View style={modalStyles.actions}>
                            <Pressable
                                onPress={onClose}
                                style={({ pressed }) => [
                                    modalStyles.btn,
                                    modalStyles.cancelBtn,
                                    pressed && { opacity: theme.interaction.pressedOpacity },
                                ]}
                            >
                                <Text style={modalStyles.cancelText}>取消</Text>
                            </Pressable>
                            <Pressable
                                onPress={onSave}
                                style={({ pressed }) => [
                                    modalStyles.btn,
                                    modalStyles.confirmBtn,
                                    pressed && { opacity: theme.interaction.pressedOpacity },
                                ]}
                            >
                                <Text style={modalStyles.confirmText}>儲存</Text>
                            </Pressable>
                        </View>
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 🎨 Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    screenContainer: {
        flex: 1,
        backgroundColor: theme.colors.background,
        paddingTop: Platform.OS === 'web' ? 16 : 52,
    },

    // ── Header ──
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
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        width: 80,
    },
    backText: {
        ...theme.typography.body,
        color: theme.colors.primary,
        fontWeight: '500',
    },
    headerSpacer: {
        width: 80,
    },
    headerActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        width: 80,
        justifyContent: 'flex-end',
    },
    headerActionText: {
        ...theme.typography.body,
        color: theme.colors.primary,
        fontWeight: '500',
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginHorizontal: theme.spacing.md,
    },



    // ── Card List ──
    list: {
        padding: theme.spacing.md,
        paddingBottom: 100, // FAB 預留空間
    },
    separator: {
        height: theme.spacing.sm,
    },

    // ── Normal Card ──
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        gap: theme.spacing.md,
        ...theme.shadows.sm,
    },

    cardInfo: {
        flex: 1,
    },
    cardName: {
        ...theme.typography.body,
        fontWeight: '600',
        color: theme.colors.text,
    },
    cardNote: {
        ...theme.typography.caption,
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    cardIconBtn: {
        padding: theme.spacing.xs + 2,
        borderRadius: theme.borderRadius.full,
    },

    // ── Edit Card（編輯模式）──
    editCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        gap: theme.spacing.md,
        ...theme.shadows.sm,
    },
    editCardActive: {
        backgroundColor: theme.colors.primary + '0D',
        ...theme.shadows.md,
    },
    dragHandle: {
        padding: theme.spacing.xs,
    },
    editCardInfo: {
        flex: 1,
    },
    editDeleteBtn: {
        padding: theme.spacing.xs + 2,
    },

    // ── Web 排序按鈕 ──
    reorderBtns: {
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
    },
    reorderBtn: {
        padding: theme.spacing.xs,
        borderRadius: theme.borderRadius.sm,
    },
    reorderBtnDisabled: {
        opacity: 0.3,
    },

    // ── FAB ──
    fab: {
        position: 'absolute',
        bottom: 24,
        right: 24,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: theme.colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        ...theme.shadows.lg,
    },

    // ── 空狀態 ──
    emptyContainer: {
        flex: 1,
        backgroundColor: theme.colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing.xl,
        gap: theme.spacing.md,
    },
    emptyIconWrap: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: theme.colors.primary + '10',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: theme.spacing.sm,
    },
    emptyTitle: {
        ...theme.typography.h2,
        color: theme.colors.text,
    },
    emptyDesc: {
        ...theme.typography.bodySmall,
        fontSize: 15,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
        maxWidth: 280,
    },
    ctaBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        backgroundColor: theme.colors.primary,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.xl,
        borderRadius: theme.borderRadius.lg,
        marginTop: theme.spacing.md,
        ...theme.shadows.sm,
    },
    ctaBtnText: {
        color: theme.colors.onPrimary,
        ...theme.typography.label,
    },
    ctaBtnSecondary: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.sm + 2,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.borderRadius.lg,
        borderWidth: 1,
        borderColor: theme.colors.primary,
        marginTop: theme.spacing.sm,
    },
    ctaBtnSecondaryText: {
        color: theme.colors.primary,
        ...theme.typography.bodySmall,
        fontWeight: '600',
    },
});

// ── Modal Styles（共用）──
const modalStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: theme.colors.overlay,
        justifyContent: 'center',
        padding: theme.spacing.lg,
    },
    content: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.xl,
    },
    title: {
        ...theme.typography.h3,
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.text,
        marginBottom: theme.spacing.lg,
    },
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
    actions: {
        flexDirection: 'row',
        gap: theme.spacing.md,
        marginTop: theme.spacing.sm,
    },
    btn: {
        flex: 1,
        paddingVertical: theme.spacing.md,
        borderRadius: theme.borderRadius.md,
        alignItems: 'center',
    },
    cancelBtn: {
        backgroundColor: theme.colors.background,
    },
    cancelText: {
        color: theme.colors.textSecondary,
        fontWeight: '600',
    },
    confirmBtn: {
        backgroundColor: theme.colors.primary,
    },
    confirmText: {
        color: theme.colors.onPrimary,
        fontWeight: '600',
    },
});

// ── Add Modal Styles（三模式新增 Modal 專用）──
const addModalStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: theme.colors.overlay,
        justifyContent: 'center',
        padding: theme.spacing.lg,
    },
    content: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.xl,
    },
    title: {
        ...theme.typography.h3,
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.text,
        marginBottom: theme.spacing.lg,
    },
    // ── 模式切換 Tab ──
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
    separator: {
        height: 1,
        backgroundColor: theme.colors.border,
    },
    // ── 按鈕 ──
    actions: {
        flexDirection: 'row',
        gap: theme.spacing.md,
        marginTop: theme.spacing.sm,
    },
    btn: {
        flex: 1,
        paddingVertical: theme.spacing.md,
        borderRadius: theme.borderRadius.md,
        alignItems: 'center',
    },
    cancelBtn: {
        backgroundColor: theme.colors.background,
    },
    cancelText: {
        color: theme.colors.textSecondary,
        fontWeight: '600',
    },
    confirmBtn: {
        backgroundColor: theme.colors.primary,
    },
    confirmText: {
        color: theme.colors.onPrimary,
        fontWeight: '600',
    },
});
