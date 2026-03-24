// ============================================================================
// ❤️ Favorites Group List Screen — P4a 群組列表頁
// ============================================================================
//
// 依照 PAGE_SPEC.md § P4a 規格實作。
//
// 功能：
//   - 顯示所有群組卡片（名稱 + 餐廳數量 + 箭頭）
//   - 點選群組卡片 → 進入群組詳情頁（P4b）
//   - 新增群組（底部 FAB）
//   - 群組三點選單 → 重命名 / 刪除
//   - 建立/重命名群組 Modal
//
// 💡 此頁面不處理餐廳 CRUD，餐廳管理在 P4b（favorites/[groupId].tsx）
// ============================================================================

import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    Alert,
    Platform,
    TextInput,
    Modal,
    Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '../../src/constants/theme';
import type { ThemeColors, ThemeShadows } from '../../src/constants/theme';
import { useThemeColors, useThemeShadows, useThemedStyles } from '../../src/contexts/ThemeContext';
import { PageHeader } from '../../src/components/common/PageHeader';
import { useFavoriteStore, FavoriteGroup, MAX_GROUPS } from '../../src/store/useFavoriteStore';
import { Ionicons } from '@expo/vector-icons';

// ─────────────────────────────────────────────────────────────────────────────
// 📱 FavoritesGroupListScreen — Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function FavoritesGroupListScreen() {
    'use no memo';
    const router = useRouter();
    const {
        favorites,
        groups,
        activeGroupId,
        createGroup,
        renameGroup,
        deleteGroup,
        setActiveGroup,
        getNextGroupName,
    } = useFavoriteStore();

    // ── 動態主題 ──
    const colors = useThemeColors();
    const shadows = useThemeShadows();
    const styles = useThemedStyles((c, s) => createFavGroupStyles(c, s));

    // ── 群組管理狀態 ──
    const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
    const [createGroupName, setCreateGroupName] = useState('');
    const [showRenameGroupModal, setShowRenameGroupModal] = useState(false);
    const [renameGroupTarget, setRenameGroupTarget] = useState<FavoriteGroup | null>(null);
    const [renameGroupName, setRenameGroupName] = useState('');
    const [showGroupMenu, setShowGroupMenu] = useState<string | null>(null);

    // ── 每個群組的餐廳數量 ──
    const getGroupFavCount = useCallback((groupId: string) => {
        return favorites.filter((f) => f.groupId === groupId).length;
    }, [favorites]);

    // ── 群組管理 Handlers ──
    const handleCreateGroup = useCallback(() => {
        const trimmed = createGroupName.trim();
        const result = createGroup(trimmed || undefined);
        if (result) {
            setShowCreateGroupModal(false);
            setCreateGroupName('');
        } else {
            if (Platform.OS === 'web') {
                window.alert('已達群組上限（最多 10 個）');
            } else {
                Alert.alert('已達群組上限', '最多只能建立 10 個群組');
            }
        }
    }, [createGroupName, createGroup]);

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

    // ── 點選群組 → 進入詳情頁 ──
    const handleGroupPress = (group: FavoriteGroup) => {
        router.push(`/favorites/${group.id}` as any);
    };

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: 群組卡片
    // ═══════════════════════════════════════════════════════════════════════
    const renderGroupCard = ({ item: group }: { item: FavoriteGroup }) => {
        const favCount = getGroupFavCount(group.id);
        const isActive = group.id === activeGroupId;

        return (
            <Pressable
                onPress={() => handleGroupPress(group)}
                style={({ pressed }) => [
                    styles.groupCard,
                    isActive && styles.groupCardActive,
                    pressed && { opacity: theme.interaction.pressedOpacity },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`群組 ${group.name}，${favCount} 家餐廳`}
            >
                {/* 左側：群組圖示 */}
                <View style={[styles.groupIconWrap, isActive && styles.groupIconWrapActive]}>
                    <Ionicons
                        name="folder-outline"
                        size={24}
                        color={isActive ? colors.primary : colors.textSecondary}
                    />
                </View>

                {/* 中間：名稱 + 餐廳數 */}
                <View style={styles.groupInfo}>
                    <View style={styles.groupNameRow}>
                        <Text style={[styles.groupName, isActive && styles.groupNameActive]} numberOfLines={1}>
                            {group.name}
                        </Text>
                        {isActive && (
                            <View style={styles.activeBadge}>
                                <Text style={styles.activeBadgeText}>啟用中</Text>
                            </View>
                        )}
                    </View>
                    <Text style={styles.groupCount}>
                        {favCount > 0 ? `${favCount} 家餐廳` : '尚無餐廳'}
                    </Text>
                </View>

                {/* 右側：三點選單 */}
                <Pressable
                    onPress={(e) => {
                        e.stopPropagation?.();
                        setShowGroupMenu(showGroupMenu === group.id ? null : group.id);
                    }}
                    hitSlop={8}
                    style={({ pressed }) => [
                        styles.groupMenuBtn,
                        pressed && { opacity: theme.interaction.pressedOpacity },
                    ]}
                    accessibilityLabel={`管理群組 ${group.name}`}
                >
                    <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
                </Pressable>
            </Pressable>
        );
    };

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: 空群組狀態
    // ═══════════════════════════════════════════════════════════════════════
    const renderEmptyState = () => (
        <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
                <Ionicons name="folder-open-outline" size={72} color={colors.primary + '80'} />
            </View>
            <Text style={styles.emptyTitle}>還沒有群組</Text>
            <Text style={styles.emptyDesc}>建立一個群組來開始收藏餐廳吧！</Text>
        </View>
    );

    return (
        <View style={styles.screenContainer}>
            {/* ── Header ── */}
            <PageHeader title="最愛清單" onBack={handleBack} />

            {/* ── 群組列表說明 ── */}
            <View style={styles.sectionHint}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                <Text style={styles.sectionHintText}>點選群組查看與管理餐廳</Text>
            </View>

            {/* ── 群組卡片列表 ── */}
            <FlatList
                data={groups}
                keyExtractor={(item) => item.id}
                renderItem={renderGroupCard}
                contentContainerStyle={styles.list}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                ListEmptyComponent={renderEmptyState}
            />

            {/* ── FAB 新增群組按鈕 ── */}
            <Pressable
                style={({ pressed }) => [
                    styles.fab,
                    pressed && { opacity: theme.interaction.pressedOpacity },
                    groups.length >= MAX_GROUPS && { opacity: 0.4 },
                ]}
                onPress={openCreateGroupModal}
                disabled={groups.length >= MAX_GROUPS}
                accessibilityRole="button"
                accessibilityLabel="新增群組"
            >
                <Ionicons name="add" size={28} color={colors.onPrimary} />
            </Pressable>

            {/* ── 群組三點選單 Modal ── */}
            <Modal visible={showGroupMenu !== null} transparent animationType="fade">
                <Pressable
                    style={styles.menuOverlay}
                    onPress={() => setShowGroupMenu(null)}
                >
                    <View style={styles.menuPopup}>
                        {(() => {
                            const targetGroup = groups.find(g => g.id === showGroupMenu);
                            if (!targetGroup) return null;
                            return (
                                <>
                                    <Text style={styles.menuPopupTitle}>{targetGroup.name}</Text>
                                    <View style={styles.dropdownDivider} />
                                    <Pressable
                                        onPress={() => {
                                            setActiveGroup(targetGroup.id);
                                            setShowGroupMenu(null);
                                        }}
                                        disabled={targetGroup.id === activeGroupId}
                                        style={({ pressed }) => [
                                            styles.dropdownItem,
                                            pressed && { backgroundColor: colors.background },
                                            targetGroup.id === activeGroupId && { opacity: 0.4 },
                                        ]}
                                    >
                                        <Ionicons
                                            name={targetGroup.id === activeGroupId ? 'checkmark-circle' : 'checkmark-circle-outline'}
                                            size={16}
                                            color={targetGroup.id === activeGroupId ? colors.success : colors.text}
                                        />
                                        <Text style={styles.dropdownText}>
                                            {targetGroup.id === activeGroupId ? '已啟用' : '啟用群組'}
                                        </Text>
                                    </Pressable>
                                    <View style={styles.dropdownDivider} />
                                    <Pressable
                                        onPress={() => openRenameGroupModal(targetGroup)}
                                        style={({ pressed }) => [
                                            styles.dropdownItem,
                                            pressed && { backgroundColor: colors.background },
                                        ]}
                                    >
                                        <Ionicons name="pencil-outline" size={16} color={colors.text} />
                                        <Text style={styles.dropdownText}>重新命名</Text>
                                    </Pressable>
                                    <View style={styles.dropdownDivider} />
                                    <Pressable
                                        onPress={() => {
                                            setShowGroupMenu(null);
                                            handleDeleteGroup(targetGroup);
                                        }}
                                        disabled={groups.length <= 1}
                                        style={({ pressed }) => [
                                            styles.dropdownItem,
                                            pressed && { backgroundColor: colors.background },
                                            groups.length <= 1 && { opacity: 0.4 },
                                        ]}
                                    >
                                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                                        <Text style={[styles.dropdownText, { color: colors.error }]}>刪除群組</Text>
                                    </Pressable>
                                </>
                            );
                        })()}
                    </View>
                </Pressable>
            </Modal>

            {/* ── 建立群組 Modal ── */}
            <Modal visible={showCreateGroupModal} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>建立新群組</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="群組名稱"
                            placeholderTextColor={colors.textSecondary}
                            value={createGroupName}
                            onChangeText={setCreateGroupName}
                            autoFocus
                            maxLength={20}
                        />
                        <View style={styles.modalActions}>
                            <Pressable
                                onPress={() => { setShowCreateGroupModal(false); setCreateGroupName(''); }}
                                style={({ pressed }) => [styles.modalBtn, styles.modalCancelBtn, pressed && { opacity: 0.6 }]}
                            >
                                <Text style={styles.modalCancelText}>取消</Text>
                            </Pressable>
                            <Pressable
                                onPress={handleCreateGroup}
                                style={({ pressed }) => [styles.modalBtn, styles.modalConfirmBtn, pressed && { opacity: 0.6 }]}
                            >
                                <Text style={styles.modalConfirmText}>建立</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── 重命名群組 Modal ── */}
            <Modal visible={showRenameGroupModal} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>重新命名群組</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="新名稱"
                            placeholderTextColor={colors.textSecondary}
                            value={renameGroupName}
                            onChangeText={setRenameGroupName}
                            autoFocus
                            maxLength={20}
                        />
                        <View style={styles.modalActions}>
                            <Pressable
                                onPress={() => { setShowRenameGroupModal(false); setRenameGroupTarget(null); }}
                                style={({ pressed }) => [styles.modalBtn, styles.modalCancelBtn, pressed && { opacity: 0.6 }]}
                            >
                                <Text style={styles.modalCancelText}>取消</Text>
                            </Pressable>
                            <Pressable
                                onPress={handleRenameGroupConfirm}
                                style={({ pressed }) => [styles.modalBtn, styles.modalConfirmBtn, pressed && { opacity: 0.6 }]}
                            >
                                <Text style={styles.modalConfirmText}>確定</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 🎨 Dynamic Styles Factory
// ─────────────────────────────────────────────────────────────────────────────

function createFavGroupStyles(c: ThemeColors, s: ThemeShadows) {
    return StyleSheet.create({
        screenContainer: {
            flex: 1,
            backgroundColor: c.background,
            paddingTop: Platform.OS === 'web' ? 16 : 52,
        },

        // ── Section Hint ──
        sectionHint: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xs,
            paddingHorizontal: theme.spacing.md + theme.spacing.xs,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.xs,
        },
        sectionHintText: {
            ...theme.typography.caption,
            color: c.textSecondary,
        },

        // ── Group Card List ──
        list: {
            padding: theme.spacing.md,
            paddingBottom: 100,
        },
        separator: {
            height: theme.spacing.sm,
        },

        // ── Group Card ──
        groupCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: c.surface,
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.md,
            gap: theme.spacing.md,
            ...s.sm,
        },
        groupCardActive: {
            borderWidth: 1,
            borderColor: c.primary + '40',
            backgroundColor: c.primary + '06',
        },
        groupIconWrap: {
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: c.textSecondary + '18',
            justifyContent: 'center',
            alignItems: 'center',
        },
        groupIconWrapActive: {
            backgroundColor: c.primary + '18',
        },
        groupInfo: {
            flex: 1,
        },
        groupNameRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
        },
        groupName: {
            ...theme.typography.body,
            fontWeight: '600',
            color: c.text,
            flexShrink: 1,
        },
        groupNameActive: {
            color: c.primary,
        },
        activeBadge: {
            backgroundColor: c.primary + '20',
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 2,
            borderRadius: theme.borderRadius.sm,
        },
        activeBadgeText: {
            ...theme.typography.caption,
            fontSize: 11,
            color: c.primary,
            fontWeight: '700',
        },
        groupCount: {
            ...theme.typography.caption,
            color: c.textSecondary,
            marginTop: 2,
        },
        groupMenuBtn: {
            padding: theme.spacing.xs,
        },

        // ── FAB ──
        fab: {
            position: 'absolute',
            bottom: 24,
            right: 24,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: c.primary,
            justifyContent: 'center',
            alignItems: 'center',
            ...s.lg,
        },

        // ── 空狀態 ──
        emptyContainer: {
            flex: 1,
            backgroundColor: c.background,
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.spacing.xl,
            gap: theme.spacing.md,
        },
        emptyIconWrap: {
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: c.primary + '10',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: theme.spacing.sm,
        },
        emptyTitle: {
            ...theme.typography.h2,
            color: c.text,
        },
        emptyDesc: {
            ...theme.typography.bodySmall,
            fontSize: 15,
            color: c.textSecondary,
            textAlign: 'center',
            lineHeight: 22,
            maxWidth: 280,
        },

        // ── 群組三點選單 Modal ──
        menuOverlay: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.35)',
        },
        menuPopup: {
            width: '70%',
            maxWidth: 280,
            backgroundColor: c.surface,
            borderRadius: theme.borderRadius.lg,
            ...s.lg,
            overflow: 'hidden' as const,
        },
        menuPopupTitle: {
            ...theme.typography.bodySmall,
            fontWeight: '700',
            color: c.textSecondary,
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
            color: c.text,
        },
        dropdownDivider: {
            height: 1,
            backgroundColor: c.border,
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
            backgroundColor: c.surface,
            borderRadius: theme.borderRadius.lg,
            padding: theme.spacing.xl,
            ...s.lg,
        },
        modalTitle: {
            ...theme.typography.h3,
            color: c.text,
            marginBottom: theme.spacing.lg,
            textAlign: 'center',
        },
        modalInput: {
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.md,
            ...theme.typography.body,
            color: c.text,
            backgroundColor: c.surface,
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
            backgroundColor: c.background,
            borderWidth: 1,
            borderColor: c.border,
        },
        modalCancelText: {
            color: c.textSecondary,
            fontWeight: '600',
        },
        modalConfirmBtn: {
            backgroundColor: c.primary,
        },
        modalConfirmText: {
            color: c.onPrimary,
            fontWeight: '600',
        },
    });
}
