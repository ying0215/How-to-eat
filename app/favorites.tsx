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
import { useFavoriteStore, FavoriteRestaurant, FavoriteGroup, MAX_GROUPS } from '../src/store/useFavoriteStore';
import { useUserStore } from '../src/store/useUserStore';
import { useMapJump } from '../src/hooks/useMapJump';
import AddFavoriteModal from '../src/components/features/AddFavoriteModal';
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
        groups,
        activeGroupId,
        groupQueues,
        removeFavorite,
        addFavorite,
        updateFavoriteName,
        updateFavoriteNote,
        reorderQueue,
        findDuplicate,
        createGroup,
        renameGroup,
        deleteGroup,
        setActiveGroup,
        getNextGroupName,
    } = useFavoriteStore();
    const transportMode = useUserStore((s) => s.transportMode);
    const { jumpToMap } = useMapJump();

    // ── 群組內餐廳 & queue ──
    const queue = groupQueues[activeGroupId] ?? [];
    const groupFavorites = favorites.filter((f) => f.groupId === activeGroupId);
    const activeGroup = groups.find((g) => g.id === activeGroupId);

    // ── 狀態 ──
    const [isEditing, setIsEditing] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editTarget, setEditTarget] = useState<FavoriteRestaurant | null>(null);
    const [editName, setEditName] = useState('');
    const [editNote, setEditNote] = useState('');

    // ── 群組管理狀態 ──
    const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
    const [createGroupName, setCreateGroupName] = useState('');
    const [showRenameGroupModal, setShowRenameGroupModal] = useState(false);
    const [renameGroupTarget, setRenameGroupTarget] = useState<FavoriteGroup | null>(null);
    const [renameGroupName, setRenameGroupName] = useState('');
    const [showGroupMenu, setShowGroupMenu] = useState<string | null>(null); // 顯示哪個群組的三點選單



    // ── 按佇列順序排列 favorites（限啟用群組） ──
    const sortedByQueue = [...groupFavorites].sort((a, b) => {
        const ai = queue.indexOf(a.id);
        const bi = queue.indexOf(b.id);
        // 不在佇列中的排最後
        const aPriority = ai === -1 ? Infinity : ai;
        const bPriority = bi === -1 ? Infinity : bi;
        return aPriority - bPriority;
    });

    // ── 群組管理 Handlers ──
    const handleCreateGroup = useCallback(() => {
        const trimmed = createGroupName.trim();
        const result = createGroup(trimmed || undefined);
        if (result) {
            setShowCreateGroupModal(false);
            setCreateGroupName('');
            // 自動切換到新群組
            setActiveGroup(result.id);
        } else {
            if (Platform.OS === 'web') {
                window.alert('已達群組上限（最多 10 個）');
            } else {
                Alert.alert('已達群組上限', '最多只能建立 10 個群組');
            }
        }
    }, [createGroupName, createGroup, setActiveGroup]);

    const handleRenameGroupConfirm = useCallback(() => {
        if (!renameGroupTarget) return;
        const trimmed = renameGroupName.trim();
        if (!trimmed) {
            if (Platform.OS === 'web') {
                window.alert('群組名稱不可為空');
            } else {
                Alert.alert('群組名稱不可為空');
            }
            return;
        }
        renameGroup(renameGroupTarget.id, trimmed);
        setShowRenameGroupModal(false);
        setRenameGroupTarget(null);
        setRenameGroupName('');
    }, [renameGroupTarget, renameGroupName, renameGroup]);

    const handleDeleteGroup = useCallback((group: FavoriteGroup) => {
        if (groups.length <= 1) {
            if (Platform.OS === 'web') {
                window.alert('不能刪除最後一個群組');
            } else {
                Alert.alert('無法刪除', '至少需要保留一個群組');
            }
            return;
        }

        const groupFavCount = favorites.filter((f) => f.groupId === group.id).length;
        const message = groupFavCount > 0
            ? `確定要刪除「${group.name}」嗎？\n群組內的 ${groupFavCount} 家餐廳也會一併移除。`
            : `確定要刪除「${group.name}」嗎？`;

        if (Platform.OS === 'web') {
            const confirmed = window.confirm(message);
            if (confirmed) deleteGroup(group.id);
        } else {
            Alert.alert('刪除群組', message, [
                { text: '取消', style: 'cancel' },
                { text: '刪除', style: 'destructive', onPress: () => deleteGroup(group.id) },
            ]);
        }
    }, [groups, favorites, deleteGroup]);

    const openRenameGroupModal = useCallback((group: FavoriteGroup) => {
        setRenameGroupTarget(group);
        setRenameGroupName(group.name);
        setShowRenameGroupModal(true);
        setShowGroupMenu(null);
    }, []);

    const openCreateGroupModal = useCallback(() => {
        if (groups.length >= MAX_GROUPS) {
            if (Platform.OS === 'web') {
                window.alert('已達群組上限（最多 10 個）');
            } else {
                Alert.alert('已達群組上限', '最多只能建立 10 個群組');
            }
            return;
        }
        setCreateGroupName(getNextGroupName());
        setShowCreateGroupModal(true);
    }, [groups.length, getNextGroupName]);

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
    // RENDER: 群組 Tab 列
    // ═══════════════════════════════════════════════════════════════════════
    function renderGroupTabs() {
        return (
            <View style={groupStyles.tabContainer}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={groupStyles.tabScroll}
                    style={groupStyles.tabScrollView}
                >
                    {groups.map((group) => {
                        const isActive = group.id === activeGroupId;
                        const showMenu = showGroupMenu === group.id;
                        return (
                            <View key={group.id} style={groupStyles.tabItem}>
                                <Pressable
                                    onPress={() => {
                                        setActiveGroup(group.id);
                                        setShowGroupMenu(null);
                                    }}
                                    style={({ pressed }) => [
                                        groupStyles.tab,
                                        isActive && groupStyles.tabActive,
                                        pressed && { opacity: theme.interaction.pressedOpacity },
                                    ]}
                                    accessibilityRole="tab"
                                    accessibilityState={{ selected: isActive }}
                                >
                                    <Text
                                        style={[
                                            groupStyles.tabText,
                                            isActive && groupStyles.tabTextActive,
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {group.name}
                                    </Text>
                                </Pressable>
                                {/* 三點選單 */}
                                <Pressable
                                    onPress={() => setShowGroupMenu(showMenu ? null : group.id)}
                                    hitSlop={6}
                                    style={({ pressed }) => [
                                        groupStyles.menuBtn,
                                        pressed && { opacity: theme.interaction.pressedOpacity },
                                    ]}
                                    accessibilityLabel={`管理群組 ${group.name}`}
                                >
                                    <Ionicons
                                        name="ellipsis-vertical"
                                        size={14}
                                        color={isActive ? theme.colors.primary : theme.colors.textSecondary}
                                    />
                                </Pressable>
                            </View>
                        );
                    })}

                    {/* ＋ 新增群組按鈕 */}
                    <Pressable
                        onPress={openCreateGroupModal}
                        disabled={groups.length >= MAX_GROUPS}
                        style={({ pressed }) => [
                            groupStyles.addGroupBtn,
                            pressed && { opacity: theme.interaction.pressedOpacity },
                            groups.length >= MAX_GROUPS && { opacity: 0.3 },
                        ]}
                        accessibilityLabel="新增群組"
                    >
                        <Ionicons name="add" size={18} color={theme.colors.primary} />
                    </Pressable>
                </ScrollView>
                {groups.length >= MAX_GROUPS && (
                    <Text style={groupStyles.limitHint}>已達群組上限</Text>
                )}
                {/* 群組三點選單 — 使用 Modal 避免被 ScrollView 裁切 */}
                <Modal visible={showGroupMenu !== null} transparent animationType="fade">
                    <Pressable
                        style={groupStyles.menuOverlay}
                        onPress={() => setShowGroupMenu(null)}
                    >
                        <View style={groupStyles.menuPopup}>
                            {(() => {
                                const targetGroup = groups.find(g => g.id === showGroupMenu);
                                if (!targetGroup) return null;
                                return (
                                    <>
                                        <Text style={groupStyles.menuPopupTitle}>{targetGroup.name}</Text>
                                        <View style={groupStyles.dropdownDivider} />
                                        <Pressable
                                            onPress={() => openRenameGroupModal(targetGroup)}
                                            style={({ pressed }) => [
                                                groupStyles.dropdownItem,
                                                pressed && { backgroundColor: theme.colors.background },
                                            ]}
                                        >
                                            <Ionicons name="pencil-outline" size={16} color={theme.colors.text} />
                                            <Text style={groupStyles.dropdownText}>重新命名</Text>
                                        </Pressable>
                                        <View style={groupStyles.dropdownDivider} />
                                        <Pressable
                                            onPress={() => {
                                                setShowGroupMenu(null);
                                                handleDeleteGroup(targetGroup);
                                            }}
                                            disabled={groups.length <= 1}
                                            style={({ pressed }) => [
                                                groupStyles.dropdownItem,
                                                pressed && { backgroundColor: theme.colors.background },
                                                groups.length <= 1 && { opacity: 0.4 },
                                            ]}
                                        >
                                            <Ionicons name="trash-outline" size={16} color={theme.colors.error} />
                                            <Text style={[groupStyles.dropdownText, { color: theme.colors.error }]}>刪除群組</Text>
                                        </Pressable>
                                    </>
                                );
                            })()}
                        </View>
                    </Pressable>
                </Modal>
            </View>
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: 群組管理 Modals
    // ═══════════════════════════════════════════════════════════════════════
    function renderGroupModals() {
        return (
            <>
                {/* 建立群組 Modal */}
                <Modal visible={showCreateGroupModal} transparent animationType="fade">
                    <View style={groupStyles.modalOverlay}>
                        <View style={groupStyles.modalContent}>
                            <Text style={groupStyles.modalTitle}>建立新群組</Text>
                            <TextInput
                                style={groupStyles.modalInput}
                                placeholder="群組名稱"
                                placeholderTextColor={theme.colors.textSecondary}
                                value={createGroupName}
                                onChangeText={setCreateGroupName}
                                autoFocus
                                maxLength={20}
                            />
                            <View style={groupStyles.modalActions}>
                                <Pressable
                                    onPress={() => { setShowCreateGroupModal(false); setCreateGroupName(''); }}
                                    style={({ pressed }) => [groupStyles.modalBtn, groupStyles.modalCancelBtn, pressed && { opacity: 0.6 }]}
                                >
                                    <Text style={groupStyles.modalCancelText}>取消</Text>
                                </Pressable>
                                <Pressable
                                    onPress={handleCreateGroup}
                                    style={({ pressed }) => [groupStyles.modalBtn, groupStyles.modalConfirmBtn, pressed && { opacity: 0.6 }]}
                                >
                                    <Text style={groupStyles.modalConfirmText}>建立</Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>
                </Modal>

                {/* 重命名群組 Modal */}
                <Modal visible={showRenameGroupModal} transparent animationType="fade">
                    <View style={groupStyles.modalOverlay}>
                        <View style={groupStyles.modalContent}>
                            <Text style={groupStyles.modalTitle}>重新命名群組</Text>
                            <TextInput
                                style={groupStyles.modalInput}
                                placeholder="新名稱"
                                placeholderTextColor={theme.colors.textSecondary}
                                value={renameGroupName}
                                onChangeText={setRenameGroupName}
                                autoFocus
                                maxLength={20}
                            />
                            <View style={groupStyles.modalActions}>
                                <Pressable
                                    onPress={() => { setShowRenameGroupModal(false); setRenameGroupTarget(null); }}
                                    style={({ pressed }) => [groupStyles.modalBtn, groupStyles.modalCancelBtn, pressed && { opacity: 0.6 }]}
                                >
                                    <Text style={groupStyles.modalCancelText}>取消</Text>
                                </Pressable>
                                <Pressable
                                    onPress={handleRenameGroupConfirm}
                                    style={({ pressed }) => [groupStyles.modalBtn, groupStyles.modalConfirmBtn, pressed && { opacity: 0.6 }]}
                                >
                                    <Text style={groupStyles.modalConfirmText}>確定</Text>
                                </Pressable>
                            </View>
                        </View>
                    </View>
                </Modal>
            </>
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: 空狀態（群組內無餐廳）
    // ═══════════════════════════════════════════════════════════════════════
    if (groupFavorites.length === 0) {
        return (
            <View style={styles.screenContainer}>
                <HeaderBar isEditing={false} onBack={handleBack} onToggleEdit={() => {}} hideEdit />
                <View style={styles.divider} />
                {renderGroupTabs()}
                <View style={styles.emptyContainer}>
                    <View style={styles.emptyIconWrap}>
                        <Ionicons name="heart-outline" size={72} color={theme.colors.primary + '80'} />
                    </View>
                    <Text style={styles.emptyTitle}>
                        {activeGroup ? `「${activeGroup.name}」還沒有餐廳` : '還沒有最愛餐廳'}
                    </Text>
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
                <AddFavoriteModal visible={showAddModal} onClose={() => setShowAddModal(false)} />
                {renderGroupModals()}
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
            {renderGroupTabs()}

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
            {/* ── 新增 Modal ── */}
            <AddFavoriteModal visible={showAddModal} onClose={() => setShowAddModal(false)} onAdded={() => { /* 可以選擇加上一些動作 */ }} />
            {renderGroupModals()}

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


// ── 群組 Tab & 管理選單 Styles ──
const groupStyles = StyleSheet.create({
    tabContainer: {
        backgroundColor: theme.colors.background,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        paddingBottom: theme.spacing.xs,
    },
    tabScrollView: {
        flexGrow: 0,
    },
    tabScroll: {
        paddingHorizontal: theme.spacing.md,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.xs,
        gap: theme.spacing.xs,
        alignItems: 'center',
    },
    tabItem: {
        position: 'relative' as const,
        flexDirection: 'row',
        alignItems: 'center',
    },
    tab: {
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    tabActive: {
        backgroundColor: theme.colors.primary + '18',
        borderColor: theme.colors.primary,
    },
    tabText: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        fontWeight: '600',
        maxWidth: 100,
    },
    tabTextActive: {
        color: theme.colors.primary,
    },
    menuBtn: {
        padding: 4,
        marginLeft: -2,
    },
    addGroupBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.primary + '40',
        backgroundColor: theme.colors.primary + '08',
        justifyContent: 'center',
        alignItems: 'center',
    },
    limitHint: {
        ...theme.typography.caption,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        paddingVertical: 2,
    },
    // ── 群組管理選單（Modal 方式） ──
    menuOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    menuPopup: {
        width: '70%',
        maxWidth: 280,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        ...theme.shadows.lg,
        overflow: 'hidden' as const,
    },
    menuPopupTitle: {
        ...theme.typography.bodySmall,
        fontWeight: '700',
        color: theme.colors.textSecondary,
        textAlign: 'center',
        paddingVertical: theme.spacing.sm + 2,
        paddingHorizontal: theme.spacing.md,
    },
    dropdownItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.sm + 2,
        paddingHorizontal: theme.spacing.md,
    },
    dropdownText: {
        ...theme.typography.bodySmall,
        color: theme.colors.text,
    },
    dropdownDivider: {
        height: 1,
        backgroundColor: theme.colors.border,
    },
    // ── Modals ──
    modalOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    modalContent: {
        width: '85%',
        maxWidth: 360,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.xl,
        ...theme.shadows.lg,
    },
    modalTitle: {
        ...theme.typography.h3,
        color: theme.colors.text,
        marginBottom: theme.spacing.lg,
        textAlign: 'center',
    },
    modalInput: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        ...theme.typography.body,
        color: theme.colors.text,
        backgroundColor: theme.colors.surface,
        marginBottom: theme.spacing.lg,
    },
    modalActions: {
        flexDirection: 'row',
        gap: theme.spacing.md,
    },
    modalBtn: {
        flex: 1,
        paddingVertical: theme.spacing.md,
        borderRadius: theme.borderRadius.md,
        alignItems: 'center',
    },
    modalCancelBtn: {
        backgroundColor: theme.colors.background,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    modalCancelText: {
        color: theme.colors.textSecondary,
        fontWeight: '600',
    },
    modalConfirmBtn: {
        backgroundColor: theme.colors.primary,
    },
    modalConfirmText: {
        color: theme.colors.onPrimary,
        fontWeight: '600',
    },
});
