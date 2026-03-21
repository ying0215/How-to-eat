// ============================================================================
// ⚙️ Settings Screen
// ============================================================================
//
// 💡 設計決策：
//   使用自訂 ToggleSwitch 取代 React Native Switch，
//   確保跨平台（Web + iOS + Android）的行為一致性。
//   自訂 Header 取代 Stack 預設 Header，提供一致的視覺體驗。

import React, { useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Alert,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '../src/constants/theme';
import { useUserStore } from '../src/store/useUserStore';
import { useFavoriteStore } from '../src/store/useFavoriteStore';
import { useGoogleAuth } from '../src/auth/useGoogleAuth';
import {
    useSyncMetaStore,
    performSync,
    pullFromCloud as pullFromCloudFn,
    type SyncStatus,
} from '../src/sync/useSyncOrchestrator';
import { uploadFavorites } from '../src/sync/GoogleDriveAdapter';
import { upgradeToSyncable, type SyncableFavoriteState } from '../src/sync/mergeStrategy';
import { useNetworkStatus } from '../src/hooks/useNetworkStatus';

// ── 常數 ──
const MIN_TIME = 5;
const MAX_TIME = 60;
const STEP = 5;

// ---------------------------------------------------------------------------
// 🔘 自訂 Toggle Switch
// ---------------------------------------------------------------------------
interface ToggleSwitchProps {
    value: boolean;
    onValueChange: (v: boolean) => void;
    disabled?: boolean;
}
function ToggleSwitch({ value, onValueChange, disabled = false }: ToggleSwitchProps) {
    return (
        <Pressable
            onPress={() => !disabled && onValueChange(!value)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="switch"
            accessibilityState={{ checked: value, disabled }}
            style={({ pressed }) => [
                toggleStyles.track,
                value ? toggleStyles.trackOn : toggleStyles.trackOff,
                disabled && toggleStyles.trackDisabled,
                pressed && !disabled && { opacity: 0.8 },
            ]}
        >
            <View style={[toggleStyles.thumb, value ? toggleStyles.thumbOn : toggleStyles.thumbOff]} />
        </Pressable>
    );
}
const TOGGLE_W = 52;
const TOGGLE_H = 30;
const THUMB = 26;
const toggleStyles = StyleSheet.create({
    track: { width: TOGGLE_W, height: TOGGLE_H, borderRadius: TOGGLE_H / 2, justifyContent: 'center', paddingHorizontal: 2 },
    trackOn: { backgroundColor: theme.colors.primary },
    trackOff: { backgroundColor: theme.colors.border },
    trackDisabled: { opacity: 0.4 },
    thumb: {
        width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: theme.colors.surface,
        ...Platform.select({
            web: { boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
            default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 },
        }),
    },
    thumbOn: { alignSelf: 'flex-end' as const },
    thumbOff: { alignSelf: 'flex-start' as const },
});

// ---------------------------------------------------------------------------
// 🔄 同步狀態 Badge
// ---------------------------------------------------------------------------
function getSyncDisplay(status: SyncStatus) {
    switch (status) {
        case 'idle': return { label: '已就緒', color: theme.colors.textSecondary, icon: 'checkmark-circle-outline' as const };
        case 'syncing': return { label: '同步中…', color: theme.colors.primary, icon: 'sync-outline' as const };
        case 'success': return { label: '同步完成', color: theme.colors.success, icon: 'checkmark-circle' as const };
        case 'error': return { label: '同步失敗', color: theme.colors.error, icon: 'alert-circle-outline' as const };
        case 'offline': return { label: '離線中', color: theme.colors.textSecondary, icon: 'cloud-offline-outline' as const };
        default: return { label: '未知', color: theme.colors.textSecondary, icon: 'help-circle-outline' as const };
    }
}
function SyncBadge({ status }: { status: SyncStatus }) {
    const d = getSyncDisplay(status);
    return (
        <View style={syncStyles.badge}>
            {status === 'syncing' ? (
                <ActivityIndicator size="small" color={d.color} />
            ) : (
                <Ionicons name={d.icon} size={16} color={d.color} />
            )}
            <Text style={[syncStyles.badgeText, { color: d.color }]}>{d.label}</Text>
        </View>
    );
}

// ---------------------------------------------------------------------------
// 📱 Settings Screen — Main Component
// ---------------------------------------------------------------------------
export default function SettingsScreen() {
    const router = useRouter();
    const { transportMode, setTransportMode, maxTimeMins, setMaxTimeMins } = useUserStore();
    const favorites = useFavoriteStore((s) => s.favorites);
    const { isSignedIn, isLoading: authLoading, user, error: authError, isConfigured, signIn, signOut, getValidToken } = useGoogleAuth();
    const syncStatus = useSyncMetaStore((s) => s.syncStatus);
    const syncError = useSyncMetaStore((s) => s.syncError);
    const lastSyncedAt = useSyncMetaStore((s) => s.lastSyncedAt);
    const syncEnabled = useSyncMetaStore((s) => s.syncEnabled);
    const syncVersion = useSyncMetaStore((s) => s.syncVersion);
    const pendingSync = useSyncMetaStore((s) => s.pendingSync);
    const { isConnected } = useNetworkStatus();

    // 同步操作（不再實例化 useSyncOrchestrator，由 _layout.tsx 全域管理）
    // 手動同步和拉取雲端直接呼叫模組級函式

    const decrease = () => setMaxTimeMins(Math.max(MIN_TIME, maxTimeMins - STEP));
    const increase = () => setMaxTimeMins(Math.min(MAX_TIME, maxTimeMins + STEP));
    const progress = (maxTimeMins - MIN_TIME) / (MAX_TIME - MIN_TIME);

    const handleBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/');
    };

    const handleGoogleConnect = async () => {
        // 防止 OAuth 進行中重複觸發（避免多個 popup 產生 COOP 警告洗版）
        if (authLoading) return;

        if (isSignedIn) {
            if (Platform.OS === 'web') {
                // Web 上 Alert.alert 是 no-op，改用 window.confirm
                const confirmed = window.confirm(
                    '取消連結 Google\n\n取消連結後，雲端同步功能將停止。你的本地資料不會被刪除。',
                );
                if (confirmed) signOut();
            } else {
                Alert.alert('取消連結 Google', '取消連結後，雲端同步功能將停止。你的本地資料不會被刪除。', [
                    { text: '取消', style: 'cancel' },
                    { text: '取消連結', style: 'destructive', onPress: () => signOut() },
                ]);
            }
        } else {
            await signIn();
        }
    };

    const handleManualSync = useCallback(async () => {
        if (syncStatus === 'syncing') return;
        const success = await performSync(getValidToken);
        if (success) {
            // 3 秒後將狀態從 'success' 重置為 'idle'
            setTimeout(() => {
                useSyncMetaStore.getState()._setSyncIdle();
            }, 3000);
        }
    }, [syncStatus, getValidToken]);

    const handlePullFromCloud = useCallback(async () => {
        const doAction = async () => {
            const success = await pullFromCloudFn(getValidToken);
            if (success) {
                if (Platform.OS === 'web') window.alert('✅ 已從雲端拉取並覆蓋本地資料。');
                else Alert.alert('✅ 完成', '已從雲端拉取並覆蓋本地資料。');
            }
        };

        if (Platform.OS === 'web') {
            const confirmed = window.confirm('從雲端拉取資料\n\n此操作會用雲端的資料覆蓋本地清單。確定要繼續嗎？');
            if (confirmed) await doAction();
        } else {
            Alert.alert(
                '從雲端拉取資料',
                '此操作會用雲端的資料覆蓋本地清單。\n\n確定要繼續嗎？',
                [
                    { text: '取消', style: 'cancel' },
                    { text: '覆蓋本地資料', style: 'destructive', onPress: doAction },
                ],
            );
        }
    }, [getValidToken]);

    const handlePushToCloud = useCallback(async () => {
        const doAction = async () => {
            try {
                const token = await getValidToken();
                if (!token) {
                    if (Platform.OS === 'web') window.alert('錯誤：無法取得 Google 授權，請重新登入。');
                    else Alert.alert('錯誤', '無法取得 Google 授權，請重新登入。');
                    return;
                }
                const syncMeta = useSyncMetaStore.getState();
                const favStore = useFavoriteStore.getState();
                const localSyncables = upgradeToSyncable(favStore.favorites);
                const stateToUpload: SyncableFavoriteState = {
                    favorites: localSyncables,
                    queue: [...favStore.queue],
                    currentDailyId: favStore.currentDailyId,
                    lastUpdateDate: favStore.lastUpdateDate,
                    _syncVersion: syncMeta.syncVersion + 1,
                    _lastSyncedAt: new Date().toISOString(),
                    _deviceId: syncMeta.deviceId || 'manual-push',
                };
                await uploadFavorites(token, stateToUpload);
                syncMeta._setSyncSuccess(stateToUpload._syncVersion);
                if (Platform.OS === 'web') window.alert('✅ 本地資料已成功推送到雲端。');
                else Alert.alert('✅ 完成', '本地資料已成功推送到雲端。');
            } catch (err) {
                const msg = err instanceof Error ? err.message : '推送失敗';
                if (Platform.OS === 'web') window.alert(`錯誤：${msg}`);
                else Alert.alert('錯誤', msg);
            }
        };

        if (Platform.OS === 'web') {
            const confirmed = window.confirm('將本地資料推送到雲端\n\n此操作會用本地的資料覆蓋雲端檔案。確定要繼續嗎？');
            if (confirmed) await doAction();
        } else {
            Alert.alert(
                '將本地資料推送到雲端',
                '此操作會用本地的資料覆蓋雲端檔案。\n\n確定要繼續嗎？',
                [
                    { text: '取消', style: 'cancel' },
                    { text: '覆蓋雲端資料', style: 'destructive', onPress: doAction },
                ],
            );
        }
    }, [getValidToken]);

    const formatLastSync = (iso: string | null): string => {
        if (!iso) return '從未同步';
        try {
            const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
            if (diffMins < 1) return '剛剛';
            if (diffMins < 60) return `${diffMins} 分鐘前`;
            const h = Math.floor(diffMins / 60);
            if (h < 24) return `${h} 小時前`;
            return `${Math.floor(h / 24)} 天前`;
        } catch { return '未知'; }
    };

    // ── 渲染 ──
    return (
        <View style={styles.screenContainer}>
            {/* Header */}
            <View style={styles.customHeader}>
                <Pressable onPress={handleBack} hitSlop={12} style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}>
                    <Ionicons name="arrow-back-outline" size={20} color={theme.colors.primary} />
                    <Text style={styles.backText}>返回</Text>
                </Pressable>
                <Text style={styles.customHeaderTitle}>偏好設定</Text>
                <View style={styles.headerSpacer} />
            </View>
            <View style={styles.divider} />

            <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
                {/* Google 雲端同步 */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="cloud-outline" size={22} color={theme.colors.primary} />
                        <Text style={styles.sectionTitle}>Google 雲端同步</Text>
                    </View>
                    {!isConfigured ? (
                        <View style={syncStyles.notConfigured}>
                            <Ionicons name="information-circle-outline" size={20} color={theme.colors.textSecondary} />
                            <Text style={syncStyles.notConfiguredText}>
                                Google 雲端同步功能尚未設定。{'\n'}請在 .env 中配置 EXPO_PUBLIC_GOOGLE_CLIENT_ID。
                            </Text>
                        </View>
                    ) : !isSignedIn ? (
                        /* ── 未登入：推廣 CTA ── */
                        <View>
                            <View style={syncStyles.promoBox}>
                                <Ionicons name="cloud-done-outline" size={40} color={theme.colors.primary} style={{ marginBottom: theme.spacing.sm }} />
                                <Text style={syncStyles.promoTitle}>跨裝置同步你的餐廳清單</Text>
                                <Text style={syncStyles.promoDesc}>
                                    連結 Google 帳號後，你的最愛餐廳會自動同步到雲端，{'\n'}換手機也不會遺失資料。
                                </Text>
                                <View style={syncStyles.promoFeatures}>
                                    <View style={syncStyles.promoFeatureRow}>
                                        <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                                        <Text style={syncStyles.promoFeatureText}>自動備份，資料不遺失</Text>
                                    </View>
                                    <View style={syncStyles.promoFeatureRow}>
                                        <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                                        <Text style={syncStyles.promoFeatureText}>跨裝置同步，手機電腦都能用</Text>
                                    </View>
                                    <View style={syncStyles.promoFeatureRow}>
                                        <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                                        <Text style={syncStyles.promoFeatureText}>使用 Google Drive 安全儲存</Text>
                                    </View>
                                </View>
                            </View>
                            {authError ? (
                                <View style={syncStyles.errorBox}>
                                    <Ionicons name="warning-outline" size={16} color={theme.colors.error} />
                                    <Text style={syncStyles.errorText}>{authError}</Text>
                                </View>
                            ) : null}
                            <Pressable
                                onPress={handleGoogleConnect}
                                disabled={authLoading}
                                style={({ pressed }) => [
                                    syncStyles.googleConnectBtn,
                                    pressed && { opacity: 0.7 },
                                    authLoading && { opacity: 0.5 },
                                ]}
                            >
                                {authLoading ? (
                                    <ActivityIndicator size="small" color={theme.colors.onPrimary} />
                                ) : (
                                    <Ionicons name="logo-google" size={20} color={theme.colors.onPrimary} />
                                )}
                                <Text style={syncStyles.googleConnectText}>
                                    {authLoading ? '連結中…' : '連結 Google 帳號'}
                                </Text>
                            </Pressable>
                        </View>
                    ) : (
                        /* ── 已登入：完整同步管理面板 ── */
                        <View>
                            <View style={syncStyles.accountCard}>
                                <Ionicons name="person-circle" size={44} color={theme.colors.primary} />
                                <View style={syncStyles.accountInfo}>
                                    <Text style={syncStyles.accountName}>{user?.name ?? 'Google User'}</Text>
                                    <Text style={syncStyles.accountEmail}>{user?.email ?? ''}</Text>
                                </View>
                                <SyncBadge status={syncStatus} />
                            </View>
                            <View style={syncStyles.detailRow}>
                                <Text style={syncStyles.detailLabel}>最後同步</Text>
                                <Text style={syncStyles.detailValue}>{formatLastSync(lastSyncedAt)}</Text>
                            </View>
                            <View style={syncStyles.detailRow}>
                                <Text style={syncStyles.detailLabel}>本地餐廳數</Text>
                                <Text style={syncStyles.detailValue}>{favorites.length} 筆</Text>
                            </View>
                            <View style={syncStyles.detailRow}>
                                <Text style={syncStyles.detailLabel}>同步版本</Text>
                                <Text style={syncStyles.detailValue}>v{syncVersion}</Text>
                            </View>
                            <View style={syncStyles.detailRow}>
                                <Text style={syncStyles.detailLabel}>網路狀態</Text>
                                <View style={syncStyles.networkBadge}>
                                    <View style={[syncStyles.networkDot, isConnected ? syncStyles.networkDotOnline : syncStyles.networkDotOffline]} />
                                    <Text style={[syncStyles.detailValue, { color: isConnected ? theme.colors.success : theme.colors.error }]}>
                                        {isConnected ? '在線' : '離線'}
                                    </Text>
                                </View>
                            </View>
                            {pendingSync ? (
                                <View style={syncStyles.pendingBadge}>
                                    <Ionicons name="time-outline" size={14} color={theme.colors.primary} />
                                    <Text style={syncStyles.pendingText}>有未同步的變更</Text>
                                </View>
                            ) : null}
                            <View style={styles.row}>
                                <Text style={styles.label}>自動同步</Text>
                                <ToggleSwitch value={syncEnabled} onValueChange={(v) => useSyncMetaStore.getState()._setSyncEnabled(v)} />
                            </View>
                            {syncError ? (
                                <View style={syncStyles.errorBox}>
                                    <Ionicons name="warning-outline" size={16} color={theme.colors.error} />
                                    <Text style={syncStyles.errorText}>{syncError}</Text>
                                </View>
                            ) : null}

                            {/* 同步操作按鈕組 */}
                            <View style={syncStyles.actionGroup}>
                                <Pressable
                                    onPress={handleManualSync}
                                    disabled={syncStatus === 'syncing' || !isConnected}
                                    style={({ pressed }) => [
                                        syncStyles.actionBtn,
                                        syncStyles.actionBtnPrimary,
                                        pressed && { opacity: 0.7 },
                                        (syncStatus === 'syncing' || !isConnected) && { opacity: 0.4 },
                                    ]}
                                >
                                    {syncStatus === 'syncing' ? (
                                        <ActivityIndicator size="small" color={theme.colors.onPrimary} />
                                    ) : (
                                        <Ionicons name="sync-outline" size={18} color={theme.colors.onPrimary} />
                                    )}
                                    <Text style={syncStyles.actionBtnTextPrimary}>立即同步</Text>
                                </Pressable>
                            </View>

                            {/* 進階雲端操作 */}
                            <View style={syncStyles.advancedSection}>
                                <Text style={syncStyles.advancedTitle}>進階操作</Text>
                                <View style={syncStyles.advancedRow}>
                                    <Pressable
                                        onPress={handlePullFromCloud}
                                        disabled={syncStatus === 'syncing'}
                                        style={({ pressed }) => [
                                            syncStyles.actionBtn,
                                            syncStyles.actionBtnOutline,
                                            pressed && { opacity: 0.7 },
                                            syncStatus === 'syncing' && { opacity: 0.4 },
                                        ]}
                                    >
                                        <Ionicons name="cloud-download-outline" size={16} color={theme.colors.primary} />
                                        <Text style={syncStyles.actionBtnTextOutline}>拉取雲端</Text>
                                    </Pressable>
                                    <Pressable
                                        onPress={handlePushToCloud}
                                        disabled={syncStatus === 'syncing'}
                                        style={({ pressed }) => [
                                            syncStyles.actionBtn,
                                            syncStyles.actionBtnOutline,
                                            pressed && { opacity: 0.7 },
                                            syncStatus === 'syncing' && { opacity: 0.4 },
                                        ]}
                                    >
                                        <Ionicons name="cloud-upload-outline" size={16} color={theme.colors.primary} />
                                        <Text style={syncStyles.actionBtnTextOutline}>推送雲端</Text>
                                    </Pressable>
                                </View>
                            </View>

                            <Pressable onPress={handleGoogleConnect} style={({ pressed }) => [syncStyles.disconnectBtn, pressed && { opacity: 0.6 }]}>
                                <Ionicons name="log-out-outline" size={18} color={theme.colors.error} />
                                <Text style={syncStyles.disconnectText}>取消連結 Google</Text>
                            </Pressable>
                        </View>
                    )}
                </View>

                {/* 交通方式 — 選擇模式 */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>預設交通方式</Text>
                    <View style={transportPickerStyles.optionsContainer}>
                        {([
                            { key: 'walk' as const, icon: 'walk-outline' as const, label: '走路', sublabel: 'Walk' },
                            { key: 'drive' as const, icon: 'car-outline' as const, label: '機車/開車', sublabel: 'Drive' },
                            { key: 'transit' as const, icon: 'bus-outline' as const, label: '大眾運輸', sublabel: 'Transit' },
                        ]).map((opt) => {
                            const isActive = transportMode === opt.key;
                            return (
                                <Pressable
                                    key={opt.key}
                                    onPress={() => setTransportMode(opt.key)}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: isActive }}
                                    style={({ pressed }) => [
                                        transportPickerStyles.optionCard,
                                        isActive && transportPickerStyles.optionCardActive,
                                        pressed && !isActive && { opacity: 0.7 },
                                    ]}
                                >
                                    {/* 選中勾選指示器 */}
                                    <View style={[
                                        transportPickerStyles.radioIndicator,
                                        isActive && transportPickerStyles.radioIndicatorActive,
                                    ]}>
                                        {isActive && (
                                            <Ionicons name="checkmark" size={14} color={theme.colors.onPrimary} />
                                        )}
                                    </View>
                                    {/* 圖示 */}
                                    <View style={[
                                        transportPickerStyles.iconCircle,
                                        isActive && transportPickerStyles.iconCircleActive,
                                    ]}>
                                        <Ionicons
                                            name={opt.icon}
                                            size={24}
                                            color={isActive ? theme.colors.primary : theme.colors.textSecondary}
                                        />
                                    </View>
                                    {/* 文字 */}
                                    <Text style={[
                                        transportPickerStyles.optionLabel,
                                        isActive && transportPickerStyles.optionLabelActive,
                                    ]}>
                                        {opt.label}
                                    </Text>
                                    <Text style={[
                                        transportPickerStyles.optionSublabel,
                                        isActive && transportPickerStyles.optionSublabelActive,
                                    ]}>
                                        {opt.sublabel}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {/* 交通時間 */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>最高交通時間限制</Text>
                    <View style={styles.sliderRow}>
                        <Pressable
                            onPress={decrease}
                            disabled={maxTimeMins <= MIN_TIME}
                            hitSlop={8}
                            style={({ pressed }) => [styles.sliderBtn, maxTimeMins <= MIN_TIME && styles.sliderBtnDisabled, pressed && { opacity: 0.6 }]}
                        >
                            <Text style={styles.sliderBtnText}>−</Text>
                        </Pressable>
                        <View style={styles.sliderCenter}>
                            <Text style={styles.sliderValue}>{maxTimeMins} 分鐘</Text>
                            <View style={styles.progressTrack}>
                                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
                            </View>
                            <View style={styles.sliderLabels}>
                                <Text style={styles.sliderLabel}>{MIN_TIME} min</Text>
                                <Text style={styles.sliderLabel}>{MAX_TIME} min</Text>
                            </View>
                        </View>
                        <Pressable
                            onPress={increase}
                            disabled={maxTimeMins >= MAX_TIME}
                            hitSlop={8}
                            style={({ pressed }) => [styles.sliderBtn, maxTimeMins >= MAX_TIME && styles.sliderBtnDisabled, pressed && { opacity: 0.6 }]}
                        >
                            <Text style={styles.sliderBtnText}>+</Text>
                        </Pressable>
                    </View>
                </View>

                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
    );
}

// ---------------------------------------------------------------------------
// 🎨 Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
    screenContainer: { flex: 1, backgroundColor: theme.colors.background, paddingTop: Platform.OS === 'web' ? 16 : 52 },
    customHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md },
    customHeaderTitle: { ...theme.typography.h3, color: theme.colors.text },
    backButton: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 80 },
    backText: { ...theme.typography.body, color: theme.colors.primary, fontWeight: '500' },
    headerSpacer: { width: 80 },
    divider: { height: 1, backgroundColor: theme.colors.border, marginHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm + 4 },
    container: { flex: 1, backgroundColor: theme.colors.background },
    scrollContent: { padding: theme.spacing.lg },
    section: { backgroundColor: theme.colors.surface, borderRadius: theme.borderRadius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg, ...theme.shadows.sm },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
    sectionTitle: { ...theme.typography.h3, marginBottom: theme.spacing.md, color: theme.colors.text },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: theme.spacing.sm },
    label: { ...theme.typography.body, color: theme.colors.textSecondary },
    sliderRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    sliderBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' },
    sliderBtnDisabled: { backgroundColor: theme.colors.border },
    sliderBtnText: { ...theme.typography.h2, fontSize: 24, fontWeight: 'bold', color: theme.colors.onPrimary, lineHeight: 28 },
    sliderCenter: { flex: 1, alignItems: 'center' },
    sliderValue: { ...theme.typography.h2, color: theme.colors.text, marginBottom: theme.spacing.sm },
    progressTrack: { width: '100%', height: 8, borderRadius: 4, backgroundColor: theme.colors.border, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 4, backgroundColor: theme.colors.primary },
    sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 4 },
    sliderLabel: { ...theme.typography.caption, fontSize: 11, color: theme.colors.textSecondary },
});

const syncStyles = StyleSheet.create({
    notConfigured: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, backgroundColor: theme.colors.background, padding: theme.spacing.md, borderRadius: theme.borderRadius.sm },
    notConfiguredText: { flex: 1, ...theme.typography.caption, fontSize: 13, color: theme.colors.textSecondary, lineHeight: 20 },
    accountCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm, marginBottom: theme.spacing.md },
    accountInfo: { flex: 1 },
    accountName: { ...theme.typography.body, fontWeight: '600', color: theme.colors.text },
    accountEmail: { ...theme.typography.caption, fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: theme.spacing.sm, paddingVertical: 4, borderRadius: theme.borderRadius.full, backgroundColor: theme.colors.background },
    badgeText: { ...theme.typography.caption, fontSize: 11, fontWeight: '600' },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: theme.spacing.xs, marginBottom: theme.spacing.sm },
    detailLabel: { ...theme.typography.bodySmall, color: theme.colors.textSecondary },
    detailValue: { ...theme.typography.bodySmall, color: theme.colors.text, fontWeight: '500' },
    errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, backgroundColor: theme.colors.error + '10', padding: theme.spacing.md, borderRadius: theme.borderRadius.sm, marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm },
    errorText: { flex: 1, ...theme.typography.caption, fontSize: 13, color: theme.colors.error, lineHeight: 18 },
    disconnectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.error, paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.xl, borderRadius: theme.borderRadius.lg, marginTop: theme.spacing.md },
    disconnectText: { color: theme.colors.error, ...theme.typography.bodySmall, fontSize: 15, fontWeight: '600' },
    // 同步操作按鈕
    actionGroup: { marginTop: theme.spacing.md },
    actionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.sm + 2,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.borderRadius.md,
    },
    actionBtnPrimary: {
        backgroundColor: theme.colors.primary,
    },
    actionBtnTextPrimary: {
        color: theme.colors.onPrimary,
        ...theme.typography.bodySmall,
        fontWeight: '600',
    },
    actionBtnOutline: {
        flex: 1,
        borderWidth: 1,
        borderColor: theme.colors.primary,
        backgroundColor: 'transparent',
    },
    actionBtnTextOutline: {
        color: theme.colors.primary,
        ...theme.typography.caption,
        fontSize: 13,
        fontWeight: '600',
    },
    advancedSection: {
        marginTop: theme.spacing.md,
        paddingTop: theme.spacing.md,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
    },
    advancedTitle: {
        ...theme.typography.caption,
        fontSize: 11,
        color: theme.colors.textSecondary,
        textTransform: 'uppercase' as const,
        letterSpacing: 1,
        marginBottom: theme.spacing.sm,
    },
    advancedRow: {
        flexDirection: 'row',
        gap: theme.spacing.sm,
    },
    networkBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    networkDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    networkDotOnline: {
        backgroundColor: theme.colors.success,
    },
    networkDotOffline: {
        backgroundColor: theme.colors.error,
    },
    pendingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        backgroundColor: theme.colors.primary + '10',
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 4,
        borderRadius: theme.borderRadius.sm,
        marginBottom: theme.spacing.xs,
    },
    pendingText: {
        ...theme.typography.caption,
        fontSize: 12,
        color: theme.colors.primary,
        fontWeight: '500',
    },
    // ── 未登入推廣 CTA 樣式 ──
    promoBox: {
        alignItems: 'center',
        paddingVertical: theme.spacing.lg,
        paddingHorizontal: theme.spacing.md,
    },
    promoTitle: {
        ...theme.typography.h3,
        color: theme.colors.text,
        textAlign: 'center' as const,
        marginBottom: theme.spacing.sm,
    },
    promoDesc: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        textAlign: 'center' as const,
        lineHeight: 22,
        marginBottom: theme.spacing.md,
    },
    promoFeatures: {
        alignSelf: 'flex-start' as const,
        gap: theme.spacing.sm,
        width: '100%',
    },
    promoFeatureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
    },
    promoFeatureText: {
        ...theme.typography.bodySmall,
        color: theme.colors.text,
    },
    googleConnectBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.sm,
        backgroundColor: '#4285F4',
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.xl,
        borderRadius: theme.borderRadius.md,
        marginTop: theme.spacing.md,
    },
    googleConnectText: {
        color: theme.colors.onPrimary,
        ...theme.typography.body,
        fontWeight: '600',
    },
});

const transportPickerStyles = StyleSheet.create({
    optionsContainer: {
        flexDirection: 'row',
        gap: theme.spacing.sm,
    },
    optionCard: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.borderRadius.md,
        borderWidth: 2,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.background,
        position: 'relative' as const,
    },
    optionCardActive: {
        borderColor: theme.colors.primary,
        backgroundColor: theme.colors.primary + '0D', // 5% opacity
    },
    radioIndicator: {
        position: 'absolute' as const,
        top: 8,
        right: 8,
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    radioIndicatorActive: {
        borderColor: theme.colors.primary,
        backgroundColor: theme.colors.primary,
    },
    iconCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: theme.colors.border + '80',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: theme.spacing.sm,
        marginTop: theme.spacing.xs,
    },
    iconCircleActive: {
        backgroundColor: theme.colors.primary + '1A', // 10% opacity
    },
    optionLabel: {
        ...theme.typography.bodySmall,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        textAlign: 'center' as const,
    },
    optionLabelActive: {
        color: theme.colors.text,
    },
    optionSublabel: {
        ...theme.typography.caption,
        color: theme.colors.textSecondary,
        marginTop: 2,
        textAlign: 'center' as const,
    },
    optionSublabelActive: {
        color: theme.colors.primary,
        fontWeight: '500',
    },
});
