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
    ActivityIndicator,
    Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { theme } from '../../constants/theme';
import { useFavoriteStore } from '../../store/useFavoriteStore';
import { usePlaceSearch } from '../../hooks/usePlaceSearch';
import { useLocation } from '../../hooks/useLocation';
import { parseGoogleMapsUrl, isGoogleMapsUrl, ParseResult, batchParseGoogleMapsUrls, BatchParseResult } from '../../services/googleMapsUrlParser';
import { PlaceSearchResult } from '../../types/models';

interface AddFavoriteModalProps {
    visible: boolean;
    onClose: () => void;
    /** 在成功新增後（含批量）呼叫的回調，可用於開啟其他 UI（如隨機推薦頁面的列表） */
    onAdded?: () => void;
}

export default function AddFavoriteModal({ visible, onClose, onAdded }: AddFavoriteModalProps) {
    const { addFavorite, findDuplicate } = useFavoriteStore();
    const { location } = useLocation();
    const { results: searchResults, loading: searchLoading, error: searchError, searchImmediate, clearResults } = usePlaceSearch();

    // ── 狀態 ──
    const [addMode, setAddMode] = useState<'search' | 'manual' | 'paste'>('search');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedPlace, setSelectedPlace] = useState<PlaceSearchResult | null>(null);

    const [newName, setNewName] = useState('');
    const [newNote, setNewNote] = useState('');

    const [pasteUrl, setPasteUrl] = useState('');
    const [pasteLoading, setPasteLoading] = useState(false);
    const [pasteResult, setPasteResult] = useState<ParseResult | null>(null);

    const [batchResults, setBatchResults] = useState<BatchParseResult | null>(null);
    const [batchImporting, setBatchImporting] = useState(false);

    // ── 剪貼簿自動偵測 ──
    useEffect(() => {
        if (addMode !== 'paste' || !visible) return;
        let cancelled = false;
        (async () => {
            try {
                const text = await Clipboard.getStringAsync();
                if (cancelled || !text) return;
                const trimmed = text.trim();
                if (isGoogleMapsUrl(trimmed) && trimmed !== pasteUrl) {
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
                // 忽略權限問題
            }
        })();
        return () => { cancelled = true; };
    }, [addMode, visible, location, pasteUrl]);

    // ── 重置 ──
    const resetModal = useCallback(() => {
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
        onClose();
    }, [clearResults, onClose]);

    // ── Handlers ──
    const handleSearch = useCallback(() => {
        searchImmediate(searchQuery, location?.latitude && location?.longitude ? { lat: location.latitude, lng: location.longitude } : undefined);
    }, [searchQuery, searchImmediate, location]);

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
            resetModal();
            onAdded?.();
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
    }, [selectedPlace, newNote, addFavorite, findDuplicate, resetModal, onAdded]);

    const handleAddManual = useCallback(() => {
        const trimmed = newName.trim();
        if (!trimmed) {
            Alert.alert('請輸入餐廳名稱');
            return;
        }
        const dup = findDuplicate(trimmed);
        const doAdd = () => {
            addFavorite(trimmed, newNote.trim() || undefined);
            resetModal();
            onAdded?.();
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
    }, [newName, newNote, addFavorite, findDuplicate, resetModal, onAdded]);

    const handlePasteUrl = useCallback(async () => {
        const trimmed = pasteUrl.trim();
        if (!trimmed) {
            Alert.alert('請貼上 Google Maps 連結');
            return;
        }
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
    }, [pasteUrl, location]);

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
            resetModal();
            onAdded?.();
            Alert.alert('✅ 新增成功', `「${r.name}」已加入最愛清單`);
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
    }, [pasteResult, newNote, addFavorite, findDuplicate, resetModal, onAdded]);

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
        resetModal();
        if (addedCount > 0) onAdded?.();
        const msg = skippedCount > 0
            ? `成功新增 ${addedCount} 家，${skippedCount} 家已存在已略過`
            : `成功新增 ${addedCount} 家餐廳`;
        Alert.alert('✅ 批量匯入完成', msg);
    }, [batchResults, addFavorite, findDuplicate, resetModal, onAdded]);

    return (
        <Modal visible={visible} transparent animationType="slide">
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

                            {searchLoading && (
                                <View style={addModalStyles.searchStatusRow}>
                                    <ActivityIndicator size="small" color={theme.colors.primary} />
                                    <Text style={addModalStyles.searchStatusText}>搜尋中...</Text>
                                </View>
                            )}
                            {searchError && (
                                <Text style={addModalStyles.searchErrorText}>{searchError}</Text>
                            )}

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

                            {selectedPlace && (
                                <View style={addModalStyles.selectedPreview}>
                                    <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
                                    <Text style={addModalStyles.selectedPreviewText}>已選擇：{selectedPlace.name}</Text>
                                </View>
                            )}
                        </>
                    ) : addMode === 'manual' ? (
                        <>
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
                            <Text style={addModalStyles.inputLabel}>貼上 Google Maps 分享連結</Text>
                            <View style={addModalStyles.searchRow}>
                                <TextInput
                                    style={[addModalStyles.input, { flex: 1, marginBottom: 0, minHeight: 44 }]}
                                    placeholder="https://maps.app.goo.gl/...&#10;可貼上多個連結（每行一個）"
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

                            {pasteLoading && (
                                <View style={addModalStyles.searchStatusRow}>
                                    <ActivityIndicator size="small" color={theme.colors.primary} />
                                    <Text style={addModalStyles.searchStatusText}>解析連結中...</Text>
                                </View>
                            )}

                            {pasteResult?.error && (
                                <View style={addModalStyles.pasteErrorContainer}>
                                    <Ionicons name="alert-circle-outline" size={18} color={theme.colors.error} />
                                    <Text style={addModalStyles.searchErrorText}>{pasteResult.error}</Text>
                                </View>
                            )}

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
                            onPress={resetModal}
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
