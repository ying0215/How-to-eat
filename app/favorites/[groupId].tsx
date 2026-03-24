// ============================================================================
// ❤️ Group Detail Screen — P4b 群組詳情頁
// ============================================================================
//
// 從群組列表頁（P4a）點選群組後進入。
// 顯示該群組內的所有餐廳，支援：
//   - 新增餐廳（三模式：搜尋/手動/貼上連結）
//   - 編輯餐廳（修改名稱/備註）
//   - 拖曳排序（Native）/ 上下排序按鈕（Web）
//   - 刪除餐廳
//   - 導航至外部地圖
//
// 💡 進入時自動呼叫 setActiveGroup(groupId)，確保 P2 抽獎頁感知當前群組。
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
    KeyboardAvoidingView,
    Pressable,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { theme } from '../../src/constants/theme';
import type { ThemeColors, ThemeShadows } from '../../src/constants/theme';
import { useThemeColors, useThemeShadows, useThemedStyles } from '../../src/contexts/ThemeContext';
import { PageHeader } from '../../src/components/common/PageHeader';
import { useFavoriteStore, FavoriteRestaurant } from '../../src/store/useFavoriteStore';
import { useUserStore } from '../../src/store/useUserStore';
import { useMapJump } from '../../src/hooks/useMapJump';
import AddFavoriteModal from '../../src/components/features/AddFavoriteModal';
import { Ionicons } from '@expo/vector-icons';

// ── 拖曳排序（Native + Web 相容）──
import DraggableFlatList, {
    RenderItemParams,
    ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';

// ─────────────────────────────────────────────────────────────────────────────
// 📱 GroupDetailScreen — Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function GroupDetailScreen() {
    'use no memo';
    const router = useRouter();
    const { groupId } = useLocalSearchParams<{ groupId: string }>();

    const {
        favorites,
        groups,
        groupQueues,
        removeFavorite,
        updateFavoriteName,
        updateFavoriteNote,
        reorderQueue,
    } = useFavoriteStore();
    const transportMode = useUserStore((s) => s.transportMode);
    const { jumpToMap } = useMapJump();

    // ── 動態主題 ──
    const colors = useThemeColors();
    const shadows = useThemeShadows();
    const styles = useThemedStyles((c, s) => createGroupDetailStyles(c, s));
    const mStyles = useThemedStyles((c, s) => createModalStyles(c, s));

    // ── 群組資料 ──
    const group = groups.find((g) => g.id === groupId);
    const queue = groupQueues[groupId] ?? [];
    const groupFavorites = favorites.filter((f) => f.groupId === groupId);

    // ── 狀態 ──
    const [isEditing, setIsEditing] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editTarget, setEditTarget] = useState<FavoriteRestaurant | null>(null);
    const [editName, setEditName] = useState('');
    const [editNote, setEditNote] = useState('');

    // ── 按佇列順序排列 favorites ──
    const sortedByQueue = [...groupFavorites].sort((a, b) => {
        const ai = queue.indexOf(a.id);
        const bi = queue.indexOf(b.id);
        const aPriority = ai === -1 ? Infinity : ai;
        const bPriority = bi === -1 ? Infinity : bi;
        return aPriority - bPriority;
    });

    // ── Header 返回 ──
    const handleBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/favorites');
    };

    // ── 刪除確認 ──
    const handleRemove = (id: string, name: string) => {
        if (Platform.OS === 'web') {
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

    // ── 群組不存在時的錯誤處理 ──
    if (!group) {
        return (
            <View style={styles.screenContainer}>
                <PageHeader
                    title="群組不存在"
                    onBack={handleBack}
                    hideRight
                />
                <View style={styles.emptyContainer}>
                    <Ionicons name="alert-circle-outline" size={72} color={colors.error + '80'} />
                    <Text style={styles.emptyTitle}>找不到此群組</Text>
                    <Text style={styles.emptyDesc}>此群組可能已被刪除</Text>
                    <Pressable
                        style={({ pressed }) => [styles.ctaBtn, pressed && { opacity: theme.interaction.pressedOpacity }]}
                        onPress={handleBack}
                    >
                        <Text style={styles.ctaBtnText}>返回群組列表</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: 空狀態（群組內無餐廳）
    // ═══════════════════════════════════════════════════════════════════════
    if (groupFavorites.length === 0) {
        return (
            <View style={styles.screenContainer}>
                <PageHeader
                    title={group.name}
                    onBack={handleBack}
                    hideRight
                />
                <View style={styles.emptyContainer}>
                    <View style={styles.emptyIconWrap}>
                        <Ionicons name="heart-outline" size={72} color={colors.primary + '80'} />
                    </View>
                    <Text style={styles.emptyTitle}>
                        {`「${group.name}」還沒有餐廳`}
                    </Text>
                    <Text style={styles.emptyDesc}>
                        去附近逛逛，找到喜歡的餐廳加入最愛吧！
                    </Text>
                    <Pressable
                        style={({ pressed }) => [styles.ctaBtn, pressed && { opacity: theme.interaction.pressedOpacity }]}
                        onPress={() => router.push('/(tabs)/nearest')}
                    >
                        <Ionicons name="location-outline" size={18} color={colors.onPrimary} />
                        <Text style={styles.ctaBtnText}>探索附近餐廳</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.ctaBtnSecondary, pressed && { opacity: theme.interaction.pressedOpacity }]}
                        onPress={() => setShowAddModal(true)}
                    >
                        <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                        <Text style={styles.ctaBtnSecondaryText}>手動新增</Text>
                    </Pressable>
                </View>
                <AddFavoriteModal visible={showAddModal} onClose={() => setShowAddModal(false)} />
            </View>
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: 一般模式 + 編輯模式
    // ═══════════════════════════════════════════════════════════════════════
    return (
        <View style={styles.screenContainer}>
            {/* ── 1. Header ── */}
            <PageHeader
                title={group.name}
                onBack={handleBack}
                rightIcon={isEditing ? 'checkmark-outline' : 'create-outline'}
                rightLabel={isEditing ? '完成' : '編輯'}
                rightColor={isEditing ? colors.success : colors.primary}
                onRightPress={() => setIsEditing((v) => !v)}
            />

            {/* ── 2. Card List ── */}
            {isEditing ? (
                Platform.OS === 'web' ? (
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
                                colors={colors}
                                styles={styles}
                            />
                        )}
                        contentContainerStyle={styles.list}
                        ItemSeparatorComponent={() => <View style={styles.separator} />}
                    />
                ) : (
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
                                    colors={colors}
                                    styles={styles}
                                />
                            </ScaleDecorator>
                        )}
                        contentContainerStyle={styles.list}
                        ItemSeparatorComponent={() => <View style={styles.separator} />}
                    />
                )
            ) : (
                <FlatList
                    data={sortedByQueue}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <NormalCard
                            item={item}
                            onPress={() => openEditModal(item)}
                            onNavigate={() => handleNavigate(item)}
                            colors={colors}
                            styles={styles}
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
                    <Ionicons name="add" size={28} color={colors.onPrimary} />
                </Pressable>
            )}

            {/* ── 新增 Modal ── */}
            <AddFavoriteModal visible={showAddModal} onClose={() => setShowAddModal(false)} onAdded={() => { }} />

            {/* ── 編輯 Modal ── */}
            <EditModal
                visible={showEditModal}
                onClose={() => { setShowEditModal(false); setEditTarget(null); }}
                onSave={handleSaveEdit}
                name={editName}
                note={editNote}
                onNameChange={setEditName}
                onNoteChange={setEditNote}
                colors={colors}
                mStyles={mStyles}
            />
        </View>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 🧩 子元件 (接收 colors/styles as props for dynamic theming)
// ─────────────────────────────────────────────────────────────────────────────

interface SubCompProps {
    colors: ThemeColors;
    styles: ReturnType<typeof createGroupDetailStyles>;
}

// ── Normal Card（一般模式）──
function NormalCard({
    item,
    onPress,
    onNavigate,
    colors,
    styles,
}: {
    item: FavoriteRestaurant;
    onPress: () => void;
    onNavigate: () => void;
} & SubCompProps) {
    const [pressed, setPressed] = useState(false);
    const [navPressed, setNavPressed] = useState(false);

    const isWeb = Platform.OS === 'web';

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
            <Ionicons name="navigate-outline" size={20} color={colors.primary} />
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
            <Ionicons name="navigate-outline" size={20} color={colors.primary} />
        </Pressable>
    );

    const cardInner = (
        <>
            <View style={styles.cardInfo}>
                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                {item.note ? (
                    <Text style={styles.cardNote} numberOfLines={1}>{item.note}</Text>
                ) : null}
            </View>
            {navButton}
        </>
    );

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
function EditCard({
    item,
    onDrag,
    isActive,
    onRemove,
    colors,
    styles,
}: {
    item: FavoriteRestaurant;
    onDrag: () => void;
    isActive: boolean;
    onRemove: () => void;
} & SubCompProps) {
    return (
        <View style={[styles.editCard, isActive && styles.editCardActive]}>
            <GHTouchableOpacity
                onLongPress={onDrag}
                delayLongPress={100}
                activeOpacity={0.6}
                style={styles.dragHandle}
                accessibilityLabel="長按拖曳排序"
            >
                <Ionicons name="menu-outline" size={22} color={colors.textSecondary} />
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
                <Ionicons name="trash-outline" size={20} color={colors.error} />
            </GHTouchableOpacity>
        </View>
    );
}

// ── Web Edit Card（Web 編輯模式 — 上下排序 + 刪除）──
function WebEditCard({
    item,
    index,
    total,
    onRemove,
    onMoveUp,
    onMoveDown,
    colors,
    styles,
}: {
    item: FavoriteRestaurant;
    index: number;
    total: number;
    onRemove: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
} & SubCompProps) {
    return (
        <View style={styles.editCard}>
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
                    <Ionicons name="chevron-up" size={18} color={index === 0 ? colors.border : colors.textSecondary} />
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
                    <Ionicons name="chevron-down" size={18} color={index === total - 1 ? colors.border : colors.textSecondary} />
                </Pressable>
            </View>

            <View style={styles.editCardInfo}>
                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                {item.note ? (
                    <Text style={styles.cardNote} numberOfLines={1}>{item.note}</Text>
                ) : null}
            </View>

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
                <Ionicons name="trash-outline" size={20} color={colors.error} />
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
    colors,
    mStyles,
}: {
    visible: boolean;
    onClose: () => void;
    onSave: () => void;
    name: string;
    note: string;
    onNameChange: (v: string) => void;
    onNoteChange: (v: string) => void;
    colors: ThemeColors;
    mStyles: ReturnType<typeof createModalStyles>;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={mStyles.overlay}
            >
                <Pressable style={mStyles.overlay} onPress={onClose}>
                    <Pressable onPress={() => {}} style={mStyles.content}>
                        <Text style={mStyles.title}>編輯餐廳資訊</Text>
                        <Text style={mStyles.inputLabel}>餐廳名稱 *</Text>
                        <TextInput
                            style={mStyles.input}
                            placeholder="餐廳名稱"
                            placeholderTextColor={colors.textSecondary}
                            value={name}
                            onChangeText={onNameChange}
                            autoFocus
                            returnKeyType="next"
                        />
                        <Text style={mStyles.inputLabel}>備註（選填）</Text>
                        <TextInput
                            style={mStyles.input}
                            placeholder="例：推薦菜色"
                            placeholderTextColor={colors.textSecondary}
                            value={note}
                            onChangeText={onNoteChange}
                            returnKeyType="done"
                            onSubmitEditing={onSave}
                        />
                        <View style={mStyles.actions}>
                            <Pressable
                                onPress={onClose}
                                style={({ pressed }) => [
                                    mStyles.btn,
                                    mStyles.cancelBtn,
                                    pressed && { opacity: theme.interaction.pressedOpacity },
                                ]}
                            >
                                <Text style={mStyles.cancelText}>取消</Text>
                            </Pressable>
                            <Pressable
                                onPress={onSave}
                                style={({ pressed }) => [
                                    mStyles.btn,
                                    mStyles.confirmBtn,
                                    pressed && { opacity: theme.interaction.pressedOpacity },
                                ]}
                            >
                                <Text style={mStyles.confirmText}>儲存</Text>
                            </Pressable>
                        </View>
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 🎨 Dynamic Styles Factory
// ─────────────────────────────────────────────────────────────────────────────

function createGroupDetailStyles(c: ThemeColors, s: ThemeShadows) {
    return StyleSheet.create({
        screenContainer: {
            flex: 1,
            backgroundColor: c.background,
            paddingTop: Platform.OS === 'web' ? 16 : 52,
        },

        // ── Card List ──
        list: {
            padding: theme.spacing.md,
            paddingBottom: 100,
        },
        separator: {
            height: theme.spacing.sm,
        },

        // ── Normal Card ──
        card: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: c.surface,
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.md,
            gap: theme.spacing.md,
            ...s.sm,
        },
        cardInfo: {
            flex: 1,
        },
        cardName: {
            ...theme.typography.body,
            fontWeight: '600',
            color: c.text,
        },
        cardNote: {
            ...theme.typography.caption,
            fontSize: 13,
            color: c.textSecondary,
            marginTop: 2,
        },
        cardIconBtn: {
            padding: theme.spacing.xs + 2,
            borderRadius: theme.borderRadius.full,
        },

        // ── Edit Card ──
        editCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: c.surface,
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.md,
            gap: theme.spacing.md,
            ...s.sm,
        },
        editCardActive: {
            backgroundColor: c.primary + '0D',
            ...s.md,
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
        ctaBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            backgroundColor: c.primary,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.xl,
            borderRadius: theme.borderRadius.lg,
            marginTop: theme.spacing.md,
            ...s.sm,
        },
        ctaBtnText: {
            color: c.onPrimary,
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
            borderColor: c.primary,
            marginTop: theme.spacing.sm,
        },
        ctaBtnSecondaryText: {
            color: c.primary,
            ...theme.typography.bodySmall,
            fontWeight: '600',
        },
    });
}

// ── Modal Styles ──
function createModalStyles(c: ThemeColors, s: ThemeShadows) {
    return StyleSheet.create({
        overlay: {
            flex: 1,
            backgroundColor: c.overlay,
            justifyContent: 'center',
            padding: theme.spacing.lg,
        },
        content: {
            backgroundColor: c.surface,
            borderRadius: theme.borderRadius.lg,
            padding: theme.spacing.xl,
        },
        title: {
            ...theme.typography.h3,
            fontSize: 20,
            fontWeight: 'bold',
            color: c.text,
            marginBottom: theme.spacing.lg,
        },
        inputLabel: {
            ...theme.typography.bodySmall,
            color: c.textSecondary,
            marginBottom: theme.spacing.xs,
        },
        input: {
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.md,
            ...theme.typography.body,
            marginBottom: theme.spacing.md,
            color: c.text,
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
            backgroundColor: c.background,
        },
        cancelText: {
            color: c.textSecondary,
            fontWeight: '600',
        },
        confirmBtn: {
            backgroundColor: c.primary,
        },
        confirmText: {
            color: c.onPrimary,
            fontWeight: '600',
        },
    });
}
