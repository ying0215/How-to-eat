// ============================================================
// 📁 index.tsx — 應用程式首頁（Entry Screen）
// ============================================================
//
// 📖 使用者打開 App 後看到的第一個畫面。
//    職責：顯示兩個入口按鈕 + 左上角功能清單按鈕。
//
// ⚠️ 設計決策：
// 漢堡選單按鈕使用 Link 跳轉至 /menu 頁面（而非側邊面板）。
// 原因：Expo Web 的 Pressable/TouchableOpacity 的 onPress 事件
//        會被 Expo Dev Tools 的全螢幕 overlay 攔截，
//        但 Link（渲染為原生 <a> 標籤）不受此影響。
// ============================================================

import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Link } from 'expo-router';
import { theme } from '../src/constants/theme';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useGoogleAuthStore } from '../src/auth/useGoogleAuth';

// ============================================================
// 🔽 主元件
// ============================================================

export default function EntryScreen() {
    const isSignedIn = useGoogleAuthStore((s) => s.isSignedIn);
    const user = useGoogleAuthStore((s) => s.user);

    /** 取得使用者名稱的第一個字元（支援中文/英文） */
    const avatarInitial = user?.name
        ? user.name.charAt(0).toUpperCase()
        : '?';

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* ════════════════════════════════════════════
                🍔 左上角功能清單按鈕（Link 跳轉至 /menu）
                ════════════════════════════════════════════ */}
            <Link href="/menu" asChild>
                <Pressable
                    style={styles.menuButton}
                    accessibilityLabel="功能清單"
                    accessibilityRole="link"
                >
                    {({ pressed }) => (
                        <View style={[styles.menuButtonInner, pressed && styles.menuButtonPressed]}>
                            <Ionicons name="menu-outline" size={22} color={theme.colors.text} />
                        </View>
                    )}
                </Pressable>
            </Link>

            {/* ════════════════════════════════════════════
                👤 右上角帳號狀態 Avatar
                ════════════════════════════════════════════ */}
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
                                <Ionicons name="person-outline" size={20} color={theme.colors.textSecondary} />
                            </View>
                        )
                    )}
                </Pressable>
            </Link>

            {/* ════════════════════════════════════════════
                📄 主內容區域
                ════════════════════════════════════════════ */}
            <View style={styles.content}>
                <Text style={styles.title}>今天吃什麼</Text>
                <Text style={styles.subtitle}>解決你每天最大的煩惱</Text>

                <View style={styles.buttonContainer}>
                    {/* 🧭 導航按鈕 1：隨機抽取 */}
                    <Link href="/(tabs)/random" asChild>
                        <Pressable style={styles.pressableReset} accessibilityRole="button" accessibilityLabel="隨機抽取，想吃什麼就抽什麼">
                            {({ pressed }) => (
                                <View style={[styles.button, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                    <View style={styles.buttonRow}>
                                        <Ionicons name="calendar-outline" size={28} color={theme.colors.accent1} />
                                        <Text style={styles.buttonTitle}>隨機抽取</Text>
                                    </View>
                                    <Text style={styles.buttonDesc}>想吃什麼，就抽什麼</Text>
                                </View>
                            )}
                        </Pressable>
                    </Link>

                    {/* 🧭 導航按鈕 2：找最近的 */}
                    <Link href="/(tabs)/nearest" asChild>
                        <Pressable style={styles.pressableReset} accessibilityRole="button" accessibilityLabel="找最近的，根據現在位子推薦附近美食">
                            {({ pressed }) => (
                                <View style={[styles.button, pressed && { opacity: theme.interaction.pressedOpacity }]}>
                                    <View style={styles.buttonRow}>
                                        <Ionicons name="location-outline" size={28} color={theme.colors.accent2} />
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

// ============================================================
// 🔽 樣式
// ============================================================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },

    // ── 漢堡選單按鈕 ──
    menuButton: {
        position: 'absolute',
        top: Platform.OS === 'web' ? 16 : 52,
        left: 16,
        zIndex: 50,
    },
    menuButtonInner: {
        width: 46,
        height: 46,
        borderRadius: 14,
        backgroundColor: theme.colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        ...theme.shadows.md,
        borderWidth: 1.5,
        borderColor: theme.colors.border,
    },
    menuButtonPressed: {
        opacity: theme.interaction.pressedOpacity,
        backgroundColor: theme.colors.background,
    },

    // ── 右上角 Avatar ──
    avatarButton: {
        position: 'absolute',
        top: Platform.OS === 'web' ? 16 : 52,
        right: 16,
        zIndex: 50,
    },
    avatarCircle: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: theme.colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        ...theme.shadows.md,
    },
    avatarText: {
        color: theme.colors.onPrimary,
        fontSize: 18,
        fontWeight: '700',
    },
    avatarCircleEmpty: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: theme.colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: theme.colors.border,
        ...theme.shadows.sm,
    },

    // ── 主內容 ──
    content: {
        flex: 1,
        padding: theme.spacing.xl,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        ...theme.typography.h1,
        color: theme.colors.text,
        marginBottom: theme.spacing.sm,
        textAlign: 'center',
    },
    subtitle: {
        ...theme.typography.body,
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.xxl,
        textAlign: 'center',
    },

    // ── 按鈕群組 ──
    buttonContainer: {
        width: '100%',
        maxWidth: 480,
        alignSelf: 'center',
        gap: theme.spacing.lg,
    },
    pressableReset: {
        width: '100%',
    },
    button: {
        padding: theme.spacing.xl,
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.surface,
        borderWidth: 2,
        borderColor: theme.colors.text,
        ...theme.shadows.md,
    },
    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: theme.spacing.xs,
    },
    buttonTitle: {
        ...theme.typography.buttonTitle,
        color: theme.colors.text,
    },
    buttonDesc: {
        ...theme.typography.bodySmall,
        color: theme.colors.textSecondary,
        marginLeft: 38,
    },
});
