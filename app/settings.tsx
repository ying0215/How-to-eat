// ============================================================================
// ⚙️ Settings Screen
// ============================================================================
//
// 💡 設計決策：
//   使用自訂 ToggleSwitch 取代 React Native Switch，
//   確保跨平台（Web + iOS + Android）的行為一致性。
//   自訂 Header 取代 Stack 預設 Header，提供一致的視覺體驗。
//   所有樣式透過 useThemedStyles 動態產生，支援 Light/Dark 主題切換。

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
import { PageHeader } from '../src/components/common/PageHeader';
import { theme } from '../src/constants/theme';
import type { ThemeColors, ThemeShadows, ThemeMode } from '../src/constants/theme';
import { useThemeColors, useThemeShadows, useThemedStyles } from '../src/contexts/ThemeContext';
import { useUserStore } from '../src/store/useUserStore';
import { useFavoriteStore } from '../src/store/useFavoriteStore';
import { useGoogleAuth } from '../src/auth/useGoogleAuth';
import {
    useSyncMetaStore,
    performSync,
    type SyncStatus,
} from '../src/sync/useSyncOrchestrator';
import { useNetworkStatus } from '../src/hooks/useNetworkStatus';
import {
    buildExportData,
    buildExportFilename,
    parseAndValidateImport,
    applyImportToStore,
    ImportValidationError,
} from '../src/services/favoriteExportImport';
import { downloadFavoritesFile, pickAndReadFavoritesFile } from '../src/services/favoriteFileHandler';

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
    const colors = useThemeColors();
    const toggleSt = useThemedStyles((c) => StyleSheet.create({
        track: { width: 52, height: 30, borderRadius: 15, justifyContent: 'center' as const, paddingHorizontal: 2 },
        trackOn: { backgroundColor: c.primary },
        trackOff: { backgroundColor: c.border },
        trackDisabled: { opacity: 0.4 },
        thumb: {
            width: 26, height: 26, borderRadius: 13, backgroundColor: c.surface,
            ...Platform.select({
                web: { boxShadow: '0 1px 3px rgba(0,0,0,0.2)' } as any,
                default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 },
            }),
        },
        thumbOn: { alignSelf: 'flex-end' as const },
        thumbOff: { alignSelf: 'flex-start' as const },
    }));

    return (
        <Pressable
            onPress={() => !disabled && onValueChange(!value)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="switch"
            accessibilityState={{ checked: value, disabled }}
            style={({ pressed }) => [
                toggleSt.track,
                value ? toggleSt.trackOn : toggleSt.trackOff,
                disabled && toggleSt.trackDisabled,
                pressed && !disabled && { opacity: 0.8 },
            ]}
        >
            <View style={[toggleSt.thumb, value ? toggleSt.thumbOn : toggleSt.thumbOff]} />
        </Pressable>
    );
}

// ---------------------------------------------------------------------------
// 🔄 同步狀態 Badge
// ---------------------------------------------------------------------------
function SyncBadge({ status }: { status: SyncStatus }) {
    const colors = useThemeColors();
    const d = getSyncDisplay(status, colors);
    const syncBadgeSt = useThemedStyles((c) => StyleSheet.create({
        badge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.xs, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs, borderRadius: theme.borderRadius.full, backgroundColor: c.background },
        badgeText: { ...theme.typography.caption, fontSize: 11, fontWeight: '600' as const },
    }));
    return (
        <View style={syncBadgeSt.badge}>
            {status === 'syncing' ? (
                <ActivityIndicator size="small" color={d.color} />
            ) : (
                <Ionicons name={d.icon} size={16} color={d.color} />
            )}
            <Text style={[syncBadgeSt.badgeText, { color: d.color }]}>{d.label}</Text>
        </View>
    );
}

function getSyncDisplay(status: SyncStatus, colors: ThemeColors) {
    switch (status) {
        case 'idle': return { label: '已就緒', color: colors.textSecondary, icon: 'checkmark-circle-outline' as const };
        case 'syncing': return { label: '同步中…', color: colors.primary, icon: 'sync-outline' as const };
        case 'success': return { label: '同步完成', color: colors.success, icon: 'checkmark-circle' as const };
        case 'error': return { label: '同步失敗', color: colors.error, icon: 'alert-circle-outline' as const };
        case 'offline': return { label: '離線中', color: colors.textSecondary, icon: 'cloud-offline-outline' as const };
        default: return { label: '未知', color: colors.textSecondary, icon: 'help-circle-outline' as const };
    }
}

// ---------------------------------------------------------------------------
// 📱 Settings Screen — Main Component
// ---------------------------------------------------------------------------
export default function SettingsScreen() {
    const router = useRouter();
    const colors = useThemeColors();
    const shadows = useThemeShadows();
    const { transportMode, setTransportMode, maxTimeMins, setMaxTimeMins, themeMode, setThemeMode } = useUserStore();
    const favorites = useFavoriteStore((s) => s.favorites);
    const { isSignedIn, isLoading: authLoading, user, error: authError, isConfigured, signIn, signOut, getValidToken } = useGoogleAuth();
    const syncStatus = useSyncMetaStore((s) => s.syncStatus);
    const syncError = useSyncMetaStore((s) => s.syncError);
    const lastSyncedAt = useSyncMetaStore((s) => s.lastSyncedAt);
    const syncEnabled = useSyncMetaStore((s) => s.syncEnabled);
    const syncVersion = useSyncMetaStore((s) => s.syncVersion);
    const pendingSync = useSyncMetaStore((s) => s.pendingSync);
    const { isConnected } = useNetworkStatus();

    // 動態樣式
    const styles = useThemedStyles((c, s) => createMainStyles(c, s));
    const syncSt = useThemedStyles((c) => createSyncStyles(c));
    const transportSt = useThemedStyles((c) => createTransportStyles(c));
    const themeSt = useThemedStyles((c) => createThemePickerStyles(c));

    const decrease = () => setMaxTimeMins(Math.max(MIN_TIME, maxTimeMins - STEP));
    const increase = () => setMaxTimeMins(Math.min(MAX_TIME, maxTimeMins + STEP));
    const progress = (maxTimeMins - MIN_TIME) / (MAX_TIME - MIN_TIME);

    const handleBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/');
    };

    const handleGoogleConnect = async () => {
        if (authLoading) return;
        if (isSignedIn) {
            if (Platform.OS === 'web') {
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
            setTimeout(() => {
                useSyncMetaStore.getState()._setSyncIdle();
            }, 3000);
        }
    }, [syncStatus, getValidToken]);

    // ── 匯出餐廳 ──
    const handleExport = useCallback(async () => {
        try {
            const json = buildExportData();
            const filename = buildExportFilename();
            await downloadFavoritesFile(json, filename);
            if (Platform.OS === 'web') {
                window.alert(`✅ 已匯出 ${favorites.length} 間餐廳。`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : '匯出失敗';
            if (Platform.OS === 'web') window.alert(`錯誤：${msg}`);
            else Alert.alert('錯誤', msg);
        }
    }, [favorites.length]);

    // ── 匯入餐廳 ──
    const handleImport = useCallback(async () => {
        try {
            const content = await pickAndReadFavoritesFile();
            if (content === null) return;

            const data = parseAndValidateImport(content);
            const summaryText = `即將匯入 ${data.groups.length} 個群組、${data.favorites.length} 間餐廳。\n\n此操作會覆蓋現有的最愛清單，確定要繼續嗎？`;

            const doImport = () => {
                applyImportToStore(data);
                if (Platform.OS === 'web') {
                    window.alert(`✅ 已成功匯入 ${data.favorites.length} 間餐廳。`);
                } else {
                    Alert.alert('✅ 完成', `已成功匯入 ${data.favorites.length} 間餐廳。`);
                }
            };

            if (Platform.OS === 'web') {
                const confirmed = window.confirm(summaryText);
                if (confirmed) doImport();
            } else {
                Alert.alert(
                    '匯入餐廳',
                    summaryText,
                    [
                        { text: '取消', style: 'cancel' },
                        { text: '覆蓋並匯入', style: 'destructive', onPress: doImport },
                    ],
                );
            }
        } catch (err) {
            const msg = err instanceof ImportValidationError
                ? err.message
                : (err instanceof Error ? err.message : '匯入失敗');
            if (Platform.OS === 'web') window.alert(`匯入失敗：${msg}`);
            else Alert.alert('匯入失敗', msg);
        }
    }, []);

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
            <PageHeader title="偏好設定" onBack={handleBack} titleVariant="h3" />

            <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
                {/* Google 雲端同步 */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="cloud-outline" size={22} color={colors.primary} />
                        <Text style={styles.sectionTitle}>Google 雲端同步</Text>
                    </View>
                    {!isConfigured ? (
                        <View style={syncSt.notConfigured}>
                            <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
                            <Text style={syncSt.notConfiguredText}>
                                Google 雲端同步功能尚未設定。{'\n'}請在 .env 中配置 EXPO_PUBLIC_GOOGLE_CLIENT_ID。
                            </Text>
                        </View>
                    ) : !isSignedIn ? (
                        /* ── 未登入：推廣 CTA ── */
                        <View>
                            <View style={syncSt.promoBox}>
                                <Ionicons name="cloud-done-outline" size={40} color={colors.primary} style={{ marginBottom: theme.spacing.sm }} />
                                <Text style={syncSt.promoTitle}>跨裝置同步你的餐廳清單</Text>
                                <Text style={syncSt.promoDesc}>
                                    連結 Google 帳號後，你的最愛餐廳會自動同步到雲端，{'\n'}換手機也不會遺失資料。
                                </Text>
                                <View style={syncSt.promoFeatures}>
                                    <View style={syncSt.promoFeatureRow}>
                                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                                        <Text style={syncSt.promoFeatureText}>自動備份，資料不遺失</Text>
                                    </View>
                                    <View style={syncSt.promoFeatureRow}>
                                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                                        <Text style={syncSt.promoFeatureText}>跨裝置同步，手機電腦都能用</Text>
                                    </View>
                                    <View style={syncSt.promoFeatureRow}>
                                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                                        <Text style={syncSt.promoFeatureText}>使用 Google Drive 安全儲存</Text>
                                    </View>
                                </View>
                            </View>
                            {authError ? (
                                <View style={syncSt.errorBox}>
                                    <Ionicons name="warning-outline" size={16} color={colors.error} />
                                    <Text style={syncSt.errorText}>{authError}</Text>
                                </View>
                            ) : null}
                            <Pressable
                                onPress={handleGoogleConnect}
                                disabled={authLoading}
                                style={({ pressed }) => [
                                    syncSt.googleConnectBtn,
                                    pressed && { opacity: 0.7 },
                                    authLoading && { opacity: 0.5 },
                                ]}
                            >
                                {authLoading ? (
                                    <ActivityIndicator size="small" color={colors.onPrimary} />
                                ) : (
                                    <Ionicons name="logo-google" size={20} color={colors.onPrimary} />
                                )}
                                <Text style={syncSt.googleConnectText}>
                                    {authLoading ? '連結中…' : '連結 Google 帳號'}
                                </Text>
                            </Pressable>
                        </View>
                    ) : (
                        /* ── 已登入：完整同步管理面板 ── */
                        <View>
                            <View style={syncSt.accountCard}>
                                <Ionicons name="person-circle" size={44} color={colors.primary} />
                                <View style={syncSt.accountInfo}>
                                    <Text style={syncSt.accountName}>{user?.name ?? 'Google User'}</Text>
                                    <Text style={syncSt.accountEmail}>{user?.email ?? ''}</Text>
                                </View>
                                <SyncBadge status={syncStatus} />
                            </View>
                            <View style={syncSt.detailRow}>
                                <Text style={syncSt.detailLabel}>最後同步</Text>
                                <Text style={syncSt.detailValue}>{formatLastSync(lastSyncedAt)}</Text>
                            </View>
                            <View style={syncSt.detailRow}>
                                <Text style={syncSt.detailLabel}>本地餐廳數</Text>
                                <Text style={syncSt.detailValue}>{favorites.length} 筆</Text>
                            </View>
                            <View style={syncSt.detailRow}>
                                <Text style={syncSt.detailLabel}>同步版本</Text>
                                <Text style={syncSt.detailValue}>v{syncVersion}</Text>
                            </View>
                            <View style={syncSt.detailRow}>
                                <Text style={syncSt.detailLabel}>網路狀態</Text>
                                <View style={syncSt.networkBadge}>
                                    <View style={[syncSt.networkDot, isConnected ? syncSt.networkDotOnline : syncSt.networkDotOffline]} />
                                    <Text style={[syncSt.detailValue, { color: isConnected ? colors.success : colors.error }]}>
                                        {isConnected ? '在線' : '離線'}
                                    </Text>
                                </View>
                            </View>
                            {pendingSync ? (
                                <View style={syncSt.pendingBadge}>
                                    <Ionicons name="time-outline" size={14} color={colors.primary} />
                                    <Text style={syncSt.pendingText}>有未同步的變更</Text>
                                </View>
                            ) : null}
                            <View style={styles.row}>
                                <Text style={styles.label}>自動同步</Text>
                                <ToggleSwitch value={syncEnabled} onValueChange={(v) => useSyncMetaStore.getState()._setSyncEnabled(v)} />
                            </View>
                            {syncError ? (
                                <View style={syncSt.errorBox}>
                                    <Ionicons name="warning-outline" size={16} color={colors.error} />
                                    <Text style={syncSt.errorText}>{syncError}</Text>
                                </View>
                            ) : null}

                            {/* 同步操作按鈕組 */}
                            <View style={syncSt.actionGroup}>
                                <Pressable
                                    onPress={handleManualSync}
                                    disabled={syncStatus === 'syncing' || !isConnected}
                                    style={({ pressed }) => [
                                        syncSt.actionBtn,
                                        syncSt.actionBtnPrimary,
                                        pressed && { opacity: 0.7 },
                                        (syncStatus === 'syncing' || !isConnected) && { opacity: 0.4 },
                                    ]}
                                >
                                    {syncStatus === 'syncing' ? (
                                        <ActivityIndicator size="small" color={colors.onPrimary} />
                                    ) : (
                                        <Ionicons name="sync-outline" size={18} color={colors.onPrimary} />
                                    )}
                                    <Text style={syncSt.actionBtnTextPrimary}>立即同步</Text>
                                </Pressable>
                            </View>

                            <Pressable onPress={handleGoogleConnect} style={({ pressed }) => [syncSt.disconnectBtn, pressed && { opacity: 0.6 }]}>
                                <Ionicons name="log-out-outline" size={18} color={colors.error} />
                                <Text style={syncSt.disconnectText}>取消連結 Google</Text>
                            </Pressable>
                        </View>
                    )}
                </View>

                {/* 資料管理（匯出/匯入） — 不需登入 Google */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="document-outline" size={22} color={colors.primary} />
                        <Text style={styles.sectionTitle}>資料管理</Text>
                    </View>
                    <Text style={syncSt.exportImportDesc}>
                        {`將餐廳清單匯出為 JSON 檔案備份，或從檔案匯入還原。共 ${favorites.length} 間餐廳。`}
                    </Text>
                    <View style={syncSt.advancedRow}>
                        <Pressable
                            onPress={handleExport}
                            style={({ pressed }) => [
                                syncSt.actionBtn,
                                syncSt.actionBtnOutline,
                                pressed && { opacity: 0.7 },
                            ]}
                        >
                            <Ionicons name="share-outline" size={16} color={colors.primary} />
                            <Text style={syncSt.actionBtnTextOutline}>匯出餐廳</Text>
                        </Pressable>
                        <Pressable
                            onPress={handleImport}
                            style={({ pressed }) => [
                                syncSt.actionBtn,
                                syncSt.actionBtnOutline,
                                pressed && { opacity: 0.7 },
                            ]}
                        >
                            <Ionicons name="download-outline" size={16} color={colors.primary} />
                            <Text style={syncSt.actionBtnTextOutline}>匯入餐廳</Text>
                        </Pressable>
                    </View>
                </View>

                {/* 🎨 外觀主題 */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="color-palette-outline" size={22} color={colors.primary} />
                        <Text style={styles.sectionTitle}>外觀主題</Text>
                    </View>
                    <View style={themeSt.optionsContainer}>
                        {([
                            { key: 'light' as ThemeMode, icon: 'sunny-outline' as const, label: '淺色', sublabel: 'Light' },
                            { key: 'dark' as ThemeMode, icon: 'moon-outline' as const, label: '深色', sublabel: 'Dark' },
                            { key: 'system' as ThemeMode, icon: 'phone-portrait-outline' as const, label: '系統', sublabel: 'System' },
                        ]).map((opt) => {
                            const isActive = themeMode === opt.key;
                            return (
                                <Pressable
                                    key={opt.key}
                                    onPress={() => setThemeMode(opt.key)}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: isActive }}
                                    style={({ pressed }) => [
                                        themeSt.optionCard,
                                        isActive && themeSt.optionCardActive,
                                        pressed && !isActive && { opacity: 0.7 },
                                    ]}
                                >
                                    <View style={[
                                        themeSt.radioIndicator,
                                        isActive && themeSt.radioIndicatorActive,
                                    ]}>
                                        {isActive && (
                                            <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
                                        )}
                                    </View>
                                    <View style={[
                                        themeSt.iconCircle,
                                        isActive && themeSt.iconCircleActive,
                                    ]}>
                                        <Ionicons
                                            name={opt.icon}
                                            size={24}
                                            color={isActive ? colors.primary : colors.textSecondary}
                                        />
                                    </View>
                                    <Text style={[
                                        themeSt.optionLabel,
                                        isActive && themeSt.optionLabelActive,
                                    ]}>
                                        {opt.label}
                                    </Text>
                                    <Text style={[
                                        themeSt.optionSublabel,
                                        isActive && themeSt.optionSublabelActive,
                                    ]}>
                                        {opt.sublabel}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    <Text style={themeSt.themeHint}>
                        {themeMode === 'dark' ? '🌙 使用黑金卡背配色' : themeMode === 'system' ? '📱 自動跟隨裝置設定' : '☀️ 使用明亮暖色配色'}
                    </Text>
                </View>

                {/* 預設交通方式 */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>預設交通方式</Text>
                    <View style={transportSt.optionsContainer}>
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
                                        transportSt.optionCard,
                                        isActive && transportSt.optionCardActive,
                                        pressed && !isActive && { opacity: 0.7 },
                                    ]}
                                >
                                    <View style={[
                                        transportSt.radioIndicator,
                                        isActive && transportSt.radioIndicatorActive,
                                    ]}>
                                        {isActive && (
                                            <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
                                        )}
                                    </View>
                                    <View style={[
                                        transportSt.iconCircle,
                                        isActive && transportSt.iconCircleActive,
                                    ]}>
                                        <Ionicons
                                            name={opt.icon}
                                            size={24}
                                            color={isActive ? colors.primary : colors.textSecondary}
                                        />
                                    </View>
                                    <Text style={[
                                        transportSt.optionLabel,
                                        isActive && transportSt.optionLabelActive,
                                    ]}>
                                        {opt.label}
                                    </Text>
                                    <Text style={[
                                        transportSt.optionSublabel,
                                        isActive && transportSt.optionSublabelActive,
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
// 🎨 Style Factories
// ---------------------------------------------------------------------------
function createMainStyles(c: ThemeColors, s: ThemeShadows) {
    return StyleSheet.create({
        screenContainer: { flex: 1, backgroundColor: c.background, paddingTop: Platform.OS === 'web' ? 16 : 52 },
        container: { flex: 1, backgroundColor: c.background },
        scrollContent: { padding: theme.spacing.lg },
        section: { backgroundColor: c.surface, borderRadius: theme.borderRadius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg, ...s.sm },
        sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
        sectionTitle: { ...theme.typography.h3, marginBottom: theme.spacing.md, color: c.text },
        row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: theme.spacing.sm },
        label: { ...theme.typography.body, color: c.textSecondary },
        sliderRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
        sliderBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center' },
        sliderBtnDisabled: { backgroundColor: c.border },
        sliderBtnText: { ...theme.typography.h2, fontSize: 24, fontWeight: 'bold', color: c.onPrimary, lineHeight: 28 },
        sliderCenter: { flex: 1, alignItems: 'center' },
        sliderValue: { ...theme.typography.h2, color: c.text, marginBottom: theme.spacing.sm },
        progressTrack: { width: '100%', height: 8, borderRadius: 4, backgroundColor: c.border, overflow: 'hidden' },
        progressFill: { height: '100%', borderRadius: 4, backgroundColor: c.primary },
        sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: theme.spacing.xs },
        sliderLabel: { ...theme.typography.caption, fontSize: 11, color: c.textSecondary },
    });
}

function createSyncStyles(c: ThemeColors) {
    return StyleSheet.create({
        notConfigured: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, backgroundColor: c.background, padding: theme.spacing.md, borderRadius: theme.borderRadius.sm },
        notConfiguredText: { flex: 1, ...theme.typography.caption, fontSize: 13, color: c.textSecondary, lineHeight: 20 },
        accountCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm, marginBottom: theme.spacing.md },
        accountInfo: { flex: 1 },
        accountName: { ...theme.typography.body, fontWeight: '600', color: c.text },
        accountEmail: { ...theme.typography.caption, fontSize: 13, color: c.textSecondary, marginTop: 2 },
        detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: theme.spacing.xs, marginBottom: theme.spacing.sm },
        detailLabel: { ...theme.typography.bodySmall, color: c.textSecondary },
        detailValue: { ...theme.typography.bodySmall, color: c.text, fontWeight: '500' },
        errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, backgroundColor: c.error + '10', padding: theme.spacing.md, borderRadius: theme.borderRadius.sm, marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm },
        errorText: { flex: 1, ...theme.typography.caption, fontSize: 13, color: c.error, lineHeight: 18 },
        disconnectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderWidth: 1, borderColor: c.error, paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.xl, borderRadius: theme.borderRadius.lg, marginTop: theme.spacing.md },
        disconnectText: { color: c.error, ...theme.typography.bodySmall, fontSize: 15, fontWeight: '600' },
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
        actionBtnPrimary: { backgroundColor: c.primary },
        actionBtnTextPrimary: { color: c.onPrimary, ...theme.typography.bodySmall, fontWeight: '600' },
        actionBtnOutline: { flex: 1, borderWidth: 1, borderColor: c.primary, backgroundColor: 'transparent' },
        actionBtnTextOutline: { color: c.primary, ...theme.typography.caption, fontSize: 13, fontWeight: '600' },
        advancedRow: { flexDirection: 'row', gap: theme.spacing.sm },
        exportImportDesc: { ...theme.typography.bodySmall, color: c.textSecondary, lineHeight: 20, marginBottom: theme.spacing.md },
        networkBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        networkDot: { width: 8, height: 8, borderRadius: 4 },
        networkDotOnline: { backgroundColor: c.success },
        networkDotOffline: { backgroundColor: c.error },
        pendingBadge: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, backgroundColor: c.primary + '10', paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs, borderRadius: theme.borderRadius.sm, marginBottom: theme.spacing.xs },
        pendingText: { ...theme.typography.caption, fontSize: 12, color: c.primary, fontWeight: '500' },
        promoBox: { alignItems: 'center', paddingVertical: theme.spacing.lg, paddingHorizontal: theme.spacing.md },
        promoTitle: { ...theme.typography.h3, color: c.text, textAlign: 'center', marginBottom: theme.spacing.sm },
        promoDesc: { ...theme.typography.bodySmall, color: c.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: theme.spacing.md },
        promoFeatures: { alignSelf: 'flex-start', gap: theme.spacing.sm, width: '100%' },
        promoFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
        promoFeatureText: { ...theme.typography.bodySmall, color: c.text },
        googleConnectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, backgroundColor: c.primary, paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.xl, borderRadius: theme.borderRadius.md, marginTop: theme.spacing.md },
        googleConnectText: { color: c.onPrimary, ...theme.typography.body, fontWeight: '600' },
    });
}

/**
 * 共用 Radio Group 樣式工廠 — Transport Mode 與 Theme Picker 共享
 * 抽出相同的 radio card 視覺結構（optionsContainer, optionCard, radioIndicator,
 * iconCircle, optionLabel, optionSublabel），避免 ~30 行重複程式碼。
 */
function createRadioGroupStyles(c: ThemeColors) {
    return {
        optionsContainer: { flexDirection: 'row' as const, gap: theme.spacing.sm },
        optionCard: { flex: 1, alignItems: 'center' as const, paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.sm, borderRadius: theme.borderRadius.md, borderWidth: 2, borderColor: c.border, backgroundColor: c.background, position: 'relative' as const },
        optionCardActive: { borderColor: c.primary, backgroundColor: c.primary + '0D' },
        radioIndicator: { position: 'absolute' as const, top: 8, right: 8, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.border, backgroundColor: c.surface, justifyContent: 'center' as const, alignItems: 'center' as const },
        radioIndicatorActive: { borderColor: c.primary, backgroundColor: c.primary },
        iconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.border + '80', justifyContent: 'center' as const, alignItems: 'center' as const, marginBottom: theme.spacing.sm, marginTop: theme.spacing.xs },
        iconCircleActive: { backgroundColor: c.primary + '1A' },
        optionLabel: { ...theme.typography.bodySmall, fontWeight: '600' as const, color: c.textSecondary, textAlign: 'center' as const },
        optionLabelActive: { color: c.text },
        optionSublabel: { ...theme.typography.caption, color: c.textSecondary, marginTop: 2, textAlign: 'center' as const },
        optionSublabelActive: { color: c.primary, fontWeight: '500' as const },
    };
}

function createTransportStyles(c: ThemeColors) {
    return StyleSheet.create({
        ...createRadioGroupStyles(c),
    });
}

function createThemePickerStyles(c: ThemeColors) {
    return StyleSheet.create({
        ...createRadioGroupStyles(c),
        themeHint: { ...theme.typography.caption, color: c.textSecondary, textAlign: 'center', marginTop: theme.spacing.md },
    });
}
