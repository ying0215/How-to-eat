// ============================================================
// 📁 menu.tsx — 功能清單頁面
// ============================================================
//
// 📖 從首頁左上角的 ☰ 按鈕跳轉至此頁面。
//    列出所有可用功能的入口，點擊後導航至對應頁面。
// ============================================================

import { View, Text, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { theme } from '../src/constants/theme';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useGoogleAuthStore, useGoogleAuth } from '../src/auth/useGoogleAuth';
import { useSyncMetaStore, type SyncStatus } from '../src/sync/useSyncOrchestrator';

// ============================================================
// 🔽 類型定義
// ============================================================

interface MenuItem {
    id: string;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    description: string;
    href: string;
}

// ============================================================
// 🔽 同步狀態 Badge
// ============================================================
function getSyncStatusDisplay(status: SyncStatus) {
    switch (status) {
        case 'idle': return { label: '☁️ 已就緒', color: theme.colors.textSecondary };
        case 'syncing': return { label: '☁️ 同步中…', color: theme.colors.primary };
        case 'success': return { label: '✅ 已同步', color: theme.colors.success };
        case 'error': return { label: '❌ 同步失敗', color: theme.colors.error };
        case 'offline': return { label: '☁️ 離線', color: theme.colors.textSecondary };
        default: return { label: '', color: theme.colors.textSecondary };
    }
}

// ============================================================
// 🔽 主元件
// ============================================================

export default function MenuScreen() {
    const isSignedIn = useGoogleAuthStore((s) => s.isSignedIn);
    const user = useGoogleAuthStore((s) => s.user);
    const authLoading = useGoogleAuthStore((s) => s.isLoading);
    const { signIn, signOut } = useGoogleAuth();
    const syncStatus = useSyncMetaStore((s) => s.syncStatus);

    const avatarInitial = user?.name
        ? user.name.charAt(0).toUpperCase()
        : '?';

    const handleSignOut = () => {
        if (Platform.OS === 'web') {
            // Web 上 Alert.alert 是 no-op，改用 window.confirm
            const confirmed = window.confirm(
                '登出 Google 帳號\n\n登出後雲端同步功能將停止。\n你的本地資料不會被刪除。',
            );
            if (confirmed) signOut();
        } else {
            Alert.alert(
                '登出 Google 帳號',
                '登出後雲端同步功能將停止。\n你的本地資料不會被刪除。',
                [
                    { text: '取消', style: 'cancel' },
                    { text: '登出', style: 'destructive', onPress: () => signOut() },
                ],
            );
        }
    };
    const menuItems: MenuItem[] = [
        {
            id: 'favorites',
            label: '最愛清單',
            icon: 'heart',
            iconColor: theme.colors.primary,
            description: '管理你收藏的餐廳',
            href: '/favorites',
        },
        {
            id: 'settings',
            label: '偏好設定',
            icon: 'settings-outline',
            iconColor: theme.colors.secondary,
            description: '交通方式、時間限制',
            href: '/settings',
        },
    ];

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 頂部標題列 */}
            <View style={styles.header}>
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
                <Text style={styles.headerTitle}>功能清單</Text>
                <View style={styles.backButton} />
            </View>

            {/* 分隔線 */}
            <View style={styles.divider} />

            {/* 帳號狀態卡片 */}
            <View style={styles.menuList}>
                {isSignedIn ? (
                    <View style={accountStyles.card}>
                        <View style={accountStyles.topRow}>
                            <View style={accountStyles.avatar}>
                                <Text style={accountStyles.avatarText}>{avatarInitial}</Text>
                            </View>
                            <View style={accountStyles.info}>
                                <Text style={accountStyles.name} numberOfLines={1}>{user?.name ?? 'Google User'}</Text>
                                <Text style={accountStyles.email} numberOfLines={1}>{user?.email ?? ''}</Text>
                            </View>
                            <View style={accountStyles.rightCol}>
                                <Text style={[accountStyles.syncLabel, { color: getSyncStatusDisplay(syncStatus).color }]}>
                                    {getSyncStatusDisplay(syncStatus).label}
                                </Text>
                            </View>
                        </View>
                        <Pressable
                            onPress={handleSignOut}
                            style={({ pressed }) => [
                                accountStyles.signOutBtn,
                                pressed && { opacity: theme.interaction.pressedOpacity },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="登出 Google 帳號"
                        >
                            <Ionicons name="log-out-outline" size={16} color={theme.colors.error} />
                            <Text style={accountStyles.signOutText}>登出</Text>
                        </Pressable>
                    </View>
                ) : (
                    <View style={promoStyles.card}>
                        <View style={promoStyles.headerRow}>
                            <Ionicons name="cloud-outline" size={22} color={theme.colors.primary} />
                            <Text style={promoStyles.headerTitle}>Google 雲端同步</Text>
                        </View>
                        <View>
                            <Text style={promoStyles.descText}>
                                連結你的 Google 帳號，將最愛餐廳清單同步到 Google 雲端硬碟。跨裝置存取，資料永不遺失。
                            </Text>
                            <View style={promoStyles.featureList}>
                                {[
                                    ['shield-checkmark-outline', '資料加密儲存在你的 Google Drive'],
                                    ['sync-outline', '自動跨裝置同步'],
                                    ['eye-off-outline', '僅存取 App 專用隱藏資料夾'],
                                ].map(([icon, text]) => (
                                    <View key={text} style={promoStyles.featureItem}>
                                        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={theme.colors.success} />
                                        <Text style={promoStyles.featureText}>{text}</Text>
                                    </View>
                                ))}
                            </View>
                            <Pressable
                                onPress={() => !authLoading && signIn()}
                                disabled={authLoading}
                                style={({ pressed }) => [
                                    promoStyles.ctaBtn,
                                    pressed && !authLoading && { opacity: theme.interaction.pressedOpacity },
                                    authLoading && { opacity: 0.6 },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={authLoading ? '登入中' : '連結 Google 帳號'}
                            >
                                {authLoading ? (
                                    <ActivityIndicator size="small" color={theme.colors.onPrimary} />
                                ) : (
                                    <Ionicons name="logo-google" size={20} color={theme.colors.onPrimary} />
                                )}
                                <Text style={promoStyles.ctaText}>
                                    {authLoading ? '登入中…' : '連結 Google 帳號'}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                )}

                {/* 選單項穆 */}
                <View style={{ marginTop: theme.spacing.sm }}>
                {menuItems.map((item) => (
                    <Link key={item.id} href={item.href as any} asChild>
                        <Pressable>
                            {({ pressed }) => (
                                <View style={[
                                    styles.menuItem,
                                    pressed && styles.menuItemPressed,
                                ]}>
                                    <View style={[
                                        styles.menuItemIconBox,
                                        { backgroundColor: item.iconColor + '18' },
                                    ]}>
                                        <Ionicons name={item.icon} size={22} color={item.iconColor} />
                                    </View>
                                    <View style={styles.menuItemContent}>
                                        <Text style={styles.menuItemLabel}>{item.label}</Text>
                                        <Text style={styles.menuItemDesc}>{item.description}</Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={22} color={theme.colors.border} />
                                </View>
                            )}
                        </Pressable>
                    </Link>
                ))}
                </View>
            </View>

            {/* 底部版本資訊 */}
            <View style={styles.footer}>
                <Text style={styles.footerText}>今天吃什麼 v1.0</Text>
            </View>
        </View>
    );
}

// ============================================================
// 🔽 樣式
// ============================================================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
        paddingTop: Platform.OS === 'web' ? 16 : 52,
    },

    // ── 標題列 ──
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: theme.spacing.md,
        paddingBottom: theme.spacing.md,
    },
    headerTitle: {
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

    // ── 分隔線 ──
    divider: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginHorizontal: theme.spacing.md,
        marginBottom: theme.spacing.sm + 4,
    },

    // ── 選單列表 ──
    menuList: {
        flex: 1,
        paddingHorizontal: theme.spacing.md,
        gap: theme.spacing.xs,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.borderRadius.md,
        gap: theme.spacing.md,
    },
    menuItemPressed: {
        backgroundColor: theme.colors.background,
    },
    menuItemIconBox: {
        width: 48,
        height: 48,
        borderRadius: theme.borderRadius.md,
        justifyContent: 'center',
        alignItems: 'center',
    },
    menuItemContent: {
        flex: 1,
    },
    menuItemLabel: {
        ...theme.typography.h3,
        color: theme.colors.text,
        marginBottom: theme.spacing.xs,
    },
    menuItemDesc: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
    },

    // ── 底部 ──
    footer: {
        paddingVertical: theme.spacing.lg,
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        marginHorizontal: theme.spacing.md,
    },
    footerText: {
        ...theme.typography.caption,
        color: theme.colors.textSecondary,
    },
});

// ── 帳號卡片樣式 ──
const accountStyles = StyleSheet.create({
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.xs,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
    },
    avatar: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: theme.colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        color: theme.colors.onPrimary,
        fontSize: 17,
        fontWeight: '700',
    },
    info: {
        flex: 1,
    },
    name: {
        ...theme.typography.body,
        fontWeight: '600',
        color: theme.colors.text,
    },
    email: {
        ...theme.typography.caption,
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 1,
    },
    rightCol: {
        alignItems: 'flex-end',
    },
    syncLabel: {
        ...theme.typography.caption,
        fontSize: 11,
        fontWeight: '600',
    },
    signOutBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        marginTop: theme.spacing.sm,
        paddingVertical: theme.spacing.sm,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
    },
    signOutText: {
        ...theme.typography.caption,
        fontSize: 13,
        color: theme.colors.error,
        fontWeight: '600',
    },
});

// ── 未登入：Google 雲端同步推廣卡樣式 ──
const promoStyles = StyleSheet.create({
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.sm,
        ...theme.shadows.sm,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.md,
    },
    headerTitle: {
        ...theme.typography.h3,
        color: theme.colors.text,
        marginBottom: 0,
    },
    descText: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        lineHeight: 22,
        marginBottom: theme.spacing.md,
    },
    featureList: {
        gap: theme.spacing.sm,
        marginBottom: theme.spacing.lg,
    },
    featureItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
    },
    featureText: {
        ...theme.typography.bodySmall,
        color: theme.colors.text,
    },
    ctaBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.sm,
        backgroundColor: '#4285F4',
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.xl,
        borderRadius: theme.borderRadius.lg,
    },
    ctaText: {
        color: theme.colors.onPrimary,
        ...theme.typography.label,
    },
});
