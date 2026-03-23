// ============================================================
// 📁 menu.tsx — 功能清單頁面
// ============================================================

import { View, Text, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
import { Link } from 'expo-router';
import { Pressable } from 'react-native';
import { theme } from '../src/constants/theme';
import type { ThemeColors, ThemeShadows } from '../src/constants/theme';
import { useThemeColors, useThemeShadows, useThemedStyles, useResolvedThemeMode } from '../src/contexts/ThemeContext';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useGoogleAuthStore, useGoogleAuth } from '../src/auth/useGoogleAuth';
import { useSyncMetaStore, type SyncStatus } from '../src/sync/useSyncOrchestrator';

interface MenuItem {
    id: string;
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    iconColor: string;
    description: string;
    href: string;
}

function getSyncStatusDisplay(status: SyncStatus, colors: { textSecondary: string; primary: string; success: string; error: string }) {
    switch (status) {
        case 'idle': return { label: '☁️ 已就緒', color: colors.textSecondary };
        case 'syncing': return { label: '☁️ 同步中…', color: colors.primary };
        case 'success': return { label: '✅ 已同步', color: colors.success };
        case 'error': return { label: '❌ 同步失敗', color: colors.error };
        case 'offline': return { label: '☁️ 離線', color: colors.textSecondary };
        default: return { label: '', color: colors.textSecondary };
    }
}

export default function MenuScreen() {
    const isSignedIn = useGoogleAuthStore((s) => s.isSignedIn);
    const user = useGoogleAuthStore((s) => s.user);
    const authLoading = useGoogleAuthStore((s) => s.isLoading);
    const { signIn, signOut } = useGoogleAuth();
    const syncStatus = useSyncMetaStore((s) => s.syncStatus);
    const colors = useThemeColors();
    const resolvedMode = useResolvedThemeMode();
    const styles = useThemedStyles((c, s) => createMenuStyles(c, s));
    const accountSt = useThemedStyles((c) => createAccountStyles(c));
    const promoSt = useThemedStyles((c, s) => createPromoStyles(c, s));

    const avatarInitial = user?.name
        ? user.name.charAt(0).toUpperCase()
        : '?';

    const handleSignOut = () => {
        if (Platform.OS === 'web') {
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
            iconColor: colors.primary,
            description: '管理你收藏的餐廳',
            href: '/favorites',
        },
        {
            id: 'settings',
            label: '偏好設定',
            icon: 'settings-outline',
            iconColor: colors.secondary,
            description: '交通方式、時間限制、外觀主題',
            href: '/settings',
        },
    ];

    return (
        <View style={styles.container}>
            <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />

            <View style={styles.header}>
                <Link href="/" asChild>
                    <Pressable style={styles.backButton}>
                        {({ pressed }) => (
                            <View style={[styles.backButtonInner, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                <Ionicons name="arrow-back-outline" size={20} color={colors.primary} />
                                <Text style={styles.backText}>返回</Text>
                            </View>
                        )}
                    </Pressable>
                </Link>
                <Text style={styles.headerTitle}>功能清單</Text>
                <View style={styles.backButton} />
            </View>

            <View style={styles.divider} />

            <View style={styles.menuList}>
                {isSignedIn ? (
                    <View style={accountSt.card}>
                        <View style={accountSt.topRow}>
                            <View style={accountSt.avatar}>
                                <Text style={accountSt.avatarText}>{avatarInitial}</Text>
                            </View>
                            <View style={accountSt.info}>
                                <Text style={accountSt.name} numberOfLines={1}>{user?.name ?? 'Google User'}</Text>
                                <Text style={accountSt.email} numberOfLines={1}>{user?.email ?? ''}</Text>
                            </View>
                            <View style={accountSt.rightCol}>
                                <Text style={[accountSt.syncLabel, { color: getSyncStatusDisplay(syncStatus, colors).color }]}>
                                    {getSyncStatusDisplay(syncStatus, colors).label}
                                </Text>
                            </View>
                        </View>
                        <Pressable
                            onPress={handleSignOut}
                            style={({ pressed }) => [
                                accountSt.signOutBtn,
                                pressed && { opacity: theme.interaction.pressedOpacity },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="登出 Google 帳號"
                        >
                            <Ionicons name="log-out-outline" size={16} color={colors.error} />
                            <Text style={accountSt.signOutText}>登出</Text>
                        </Pressable>
                    </View>
                ) : (
                    <View style={promoSt.card}>
                        <View style={promoSt.headerRow}>
                            <Ionicons name="cloud-outline" size={22} color={colors.primary} />
                            <Text style={promoSt.headerTitle}>Google 雲端同步</Text>
                        </View>
                        <View>
                            <Text style={promoSt.descText}>
                                連結你的 Google 帳號，將最愛餐廳清單同步到 Google 雲端硬碟。跨裝置存取，資料永不遺失。
                            </Text>
                            <View style={promoSt.featureList}>
                                {[
                                    ['shield-checkmark-outline', '資料加密儲存在你的 Google Drive'],
                                    ['sync-outline', '自動跨裝置同步'],
                                    ['eye-off-outline', '僅存取 App 專用隱藏資料夾'],
                                ].map(([icon, text]) => (
                                    <View key={text} style={promoSt.featureItem}>
                                        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={colors.success} />
                                        <Text style={promoSt.featureText}>{text}</Text>
                                    </View>
                                ))}
                            </View>
                            <Pressable
                                onPress={() => !authLoading && signIn()}
                                disabled={authLoading}
                                style={({ pressed }) => [
                                    promoSt.ctaBtn,
                                    pressed && !authLoading && { opacity: theme.interaction.pressedOpacity },
                                    authLoading && { opacity: 0.6 },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={authLoading ? '登入中' : '連結 Google 帳號'}
                            >
                                {authLoading ? (
                                    <ActivityIndicator size="small" color={colors.onPrimary} />
                                ) : (
                                    <Ionicons name="logo-google" size={20} color={colors.onPrimary} />
                                )}
                                <Text style={promoSt.ctaText}>
                                    {authLoading ? '登入中…' : '連結 Google 帳號'}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                )}

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
                                    <Ionicons name="chevron-forward" size={22} color={colors.border} />
                                </View>
                            )}
                        </Pressable>
                    </Link>
                ))}
                </View>
            </View>

            <View style={styles.footer}>
                <Text style={styles.footerText}>今天吃什麼 v1.0</Text>
            </View>
        </View>
    );
}

function createMenuStyles(c: ThemeColors, s: ThemeShadows) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: c.background, paddingTop: Platform.OS === 'web' ? 16 : 52 },
        header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md },
        headerTitle: { ...theme.typography.h2, color: c.text },
        backButton: { width: 80 },
        backButtonInner: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
        backText: { ...theme.typography.body, color: c.primary, fontWeight: '500' },
        divider: { height: 1, backgroundColor: c.border, marginHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm + 4 },
        menuList: { flex: 1, paddingHorizontal: theme.spacing.md, gap: theme.spacing.xs },
        menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.md, borderRadius: theme.borderRadius.md, gap: theme.spacing.md },
        menuItemPressed: { backgroundColor: c.surface },
        menuItemIconBox: { width: 48, height: 48, borderRadius: theme.borderRadius.md, justifyContent: 'center', alignItems: 'center' },
        menuItemContent: { flex: 1 },
        menuItemLabel: { ...theme.typography.h3, color: c.text, marginBottom: theme.spacing.xs },
        menuItemDesc: { ...theme.typography.bodySmall, color: c.textSecondary },
        footer: { paddingVertical: theme.spacing.lg, alignItems: 'center', borderTopWidth: 1, borderTopColor: c.border, marginHorizontal: theme.spacing.md },
        footerText: { ...theme.typography.caption, color: c.textSecondary },
    });
}

function createAccountStyles(c: ThemeColors) {
    return StyleSheet.create({
        card: { backgroundColor: c.surface, borderRadius: theme.borderRadius.md, padding: theme.spacing.md, marginBottom: theme.spacing.xs, borderWidth: 1, borderColor: c.border },
        topRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
        avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center' },
        avatarText: { color: c.onPrimary, fontSize: 17, fontWeight: '700' },
        info: { flex: 1 },
        name: { ...theme.typography.body, fontWeight: '600', color: c.text },
        email: { ...theme.typography.caption, fontSize: 12, color: c.textSecondary, marginTop: 1 },
        rightCol: { alignItems: 'flex-end' },
        syncLabel: { ...theme.typography.caption, fontSize: 11, fontWeight: '600' },
        signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs, marginTop: theme.spacing.sm, paddingVertical: theme.spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
        signOutText: { ...theme.typography.caption, fontSize: 13, color: c.error, fontWeight: '600' },
    });
}

function createPromoStyles(c: ThemeColors, s: ThemeShadows) {
    return StyleSheet.create({
        card: { backgroundColor: c.surface, borderRadius: theme.borderRadius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.sm, ...s.sm },
        headerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.md },
        headerTitle: { ...theme.typography.h3, color: c.text, marginBottom: 0 },
        descText: { ...theme.typography.bodySmall, color: c.textSecondary, lineHeight: 22, marginBottom: theme.spacing.md },
        featureList: { gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
        featureItem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
        featureText: { ...theme.typography.bodySmall, color: c.text },
        ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, backgroundColor: c.primary, paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.xl, borderRadius: theme.borderRadius.lg },
        ctaText: { color: c.onPrimary, ...theme.typography.label },
    });
}
