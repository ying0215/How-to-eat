// ============================================================
// 📁 index.tsx — 應用程式首頁（Entry Screen）
// ============================================================

import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Link } from 'expo-router';
import { theme } from '../src/constants/theme';
import type { ThemeColors, ThemeShadows } from '../src/constants/theme';
import { useThemeColors, useThemedStyles, useResolvedThemeMode } from '../src/contexts/ThemeContext';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useGoogleAuthStore } from '../src/auth/useGoogleAuth';

export default function EntryScreen() {
    const isSignedIn = useGoogleAuthStore((s) => s.isSignedIn);
    const user = useGoogleAuthStore((s) => s.user);
    const colors = useThemeColors();
    const resolvedMode = useResolvedThemeMode();
    const styles = useThemedStyles((c, s) => createStyles(c, s));

    const avatarInitial = user?.name
        ? user.name.charAt(0).toUpperCase()
        : '?';

    return (
        <View style={styles.container}>
            <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />

            {/* 🍔 左上角功能清單按鈕 */}
            <Link href="/menu" asChild>
                <Pressable
                    style={styles.menuButton}
                    accessibilityLabel="功能清單"
                    accessibilityRole="link"
                >
                    {({ pressed }) => (
                        <View style={[styles.menuButtonInner, pressed && styles.menuButtonPressed]}>
                            <Ionicons name="menu-outline" size={22} color={colors.text} />
                        </View>
                    )}
                </Pressable>
            </Link>

            {/* 👤 右上角帳號狀態 Avatar */}
            <Link href="/settings" asChild>
                <Pressable
                    style={styles.avatarButton}
                    accessibilityLabel={isSignedIn ? `已登入：${user?.name ?? 'Google User'}` : '未登入，點擊連結 Google 帳號'}
                    accessibilityRole="link"
                >
                    {({ pressed }) => (
                        isSignedIn ? (
                            <View style={[styles.avatarCircle, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                <Text style={styles.avatarText}>{avatarInitial}</Text>
                            </View>
                        ) : (
                            <View style={[styles.avatarCircleEmpty, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                <Ionicons name="person-outline" size={20} color={colors.textSecondary} />
                            </View>
                        )
                    )}
                </Pressable>
            </Link>

            {/* 📄 主內容區域 */}
            <View style={styles.content}>
                <Text style={styles.title}>今天吃什麼</Text>
                <Text style={styles.subtitle}>解決你每天最大的煩惱</Text>

                <View style={styles.buttonContainer}>
                    <Link href="/(tabs)/random" asChild>
                        <Pressable style={styles.pressableReset} accessibilityRole="button" accessibilityLabel="隨機抽取，想吃什麼就抽什麼">
                            {({ pressed }) => (
                                <View style={[styles.button, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                    <View style={styles.buttonRow}>
                                        <Ionicons name="calendar-outline" size={28} color={colors.accent1} />
                                        <Text style={styles.buttonTitle}>隨機抽取</Text>
                                    </View>
                                    <Text style={styles.buttonDesc}>想吃什麼，就抽什麼</Text>
                                </View>
                            )}
                        </Pressable>
                    </Link>

                    <Link href="/(tabs)/nearest" asChild>
                        <Pressable style={styles.pressableReset} accessibilityRole="button" accessibilityLabel="找最近的，根據現在位子推薦附近美食">
                            {({ pressed }) => (
                                <View style={[styles.button, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                    <View style={styles.buttonRow}>
                                        <Ionicons name="location-outline" size={28} color={colors.accent2} />
                                        <Text style={styles.buttonTitle}>找最近的</Text>
                                    </View>
                                    <Text style={styles.buttonDesc}>根據現在位子直接推薦附近美食</Text>
                                </View>
                            )}
                        </Pressable>
                    </Link>
                </View>
            </View>
        </View>
    );
}

function createStyles(c: ThemeColors, s: ThemeShadows) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: c.background },
        menuButton: { position: 'absolute', top: Platform.OS === 'web' ? 16 : 52, left: 16, zIndex: 50 },
        menuButtonInner: { width: 46, height: 46, borderRadius: 14, backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center', ...s.md, borderWidth: 1.5, borderColor: c.border },
        menuButtonPressed: { opacity: theme.interaction.pressedOpacity, backgroundColor: c.background },
        avatarButton: { position: 'absolute', top: Platform.OS === 'web' ? 16 : 52, right: 16, zIndex: 50 },
        avatarCircle: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center', ...s.md },
        avatarText: { color: c.onPrimary, fontSize: 18, fontWeight: '700' },
        avatarCircleEmpty: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: c.border, ...s.sm },
        content: { flex: 1, padding: theme.spacing.xl, justifyContent: 'center', alignItems: 'center' },
        title: { ...theme.typography.h1, color: c.text, marginBottom: theme.spacing.sm, textAlign: 'center' },
        subtitle: { ...theme.typography.body, color: c.primary, marginBottom: theme.spacing.xxl, textAlign: 'center' },
        buttonContainer: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: theme.spacing.lg },
        pressableReset: { width: '100%' },
        button: { padding: theme.spacing.xl, borderRadius: theme.borderRadius.lg, backgroundColor: c.surface, borderWidth: 2, borderColor: c.text, ...s.md },
        buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: theme.spacing.xs },
        buttonTitle: { ...theme.typography.buttonTitle, color: c.text },
        buttonDesc: { ...theme.typography.bodySmall, color: c.textSecondary, marginLeft: 38 },
    });
}
