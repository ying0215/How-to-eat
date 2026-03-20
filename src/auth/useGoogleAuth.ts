// ============================================================================
// 📁 useGoogleAuth.ts — Google OAuth 2.0 認證 Hook
// ============================================================================
//
// 職責：管理 Google 帳號的登入/登出/token 刷新完整生命週期。
//
// 技術選型：
//   使用 expo-auth-session 做 web-based OAuth，原因：
//   1. 相容 Expo Go（不需要 development build）
//   2. 跨平台一致性（Web / iOS / Android 同一套程式碼）
//   3. 自動處理 PKCE (Proof Key for Code Exchange) 安全流程
//
// 安全措施：
//   - Access Token 存在記憶體（不持久化，1 小時過期）
//   - Refresh Token 存在 expo-secure-store（加密儲存）
//   - 登出時同時清除本地 token + Google 端授權
// ============================================================================

import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
    googleClientId,
    googleClientSecret,
    GOOGLE_DRIVE_SCOPES,
    GOOGLE_DISCOVERY_DOC_URL,
    isGoogleConfigured,
} from './googleConfig';

// ---------------------------------------------------------------------------
// 🌐 Web OAuth Popup 回調處理
// ---------------------------------------------------------------------------
// expo-auth-session 在 Web 上使用 popup 視窗進行 OAuth。
// maybeCompleteAuthSession() 會檢測當前頁面是否是 OAuth redirect 目標：
//   - 如果是（popup 被重導向到此頁面）：讀取 URL 中的授權碼，通知父視窗，關閉 popup
//   - 如果不是（正常載入主頁面）：什麼都不做
//
// ⚠️ 必須在模組頂層呼叫（不在 Hook 內），確保在 React 渲染之前就執行。
// ❌ 如果不呼叫：OAuth popup 無法將授權結果回傳給主視窗，
//    promptAsync() 永遠不會 resolve，isSignedIn 永遠是 false。
WebBrowser.maybeCompleteAuthSession();

// ---------------------------------------------------------------------------
// 🔒 SecureStore Keys — token 儲存鍵名
// ---------------------------------------------------------------------------

/** Refresh token 的 SecureStore 鍵名 */
const SECURE_KEY_REFRESH_TOKEN = 'google_refresh_token';

/** 使用者 email 的 SecureStore 鍵名（用於 UI 顯示） */
const SECURE_KEY_USER_EMAIL = 'google_user_email';

/** 使用者姓名的 SecureStore 鍵名 */
const SECURE_KEY_USER_NAME = 'google_user_name';

// ---------------------------------------------------------------------------
// 📦 Auth State Store — Zustand 管理認證全域狀態
// ---------------------------------------------------------------------------

/** Google 帳號使用者基本資訊 */
export interface GoogleUser {
    email: string;
    name: string;
}

/** 認證全域狀態 */
interface GoogleAuthState {
    /** 是否正在進行 OAuth 流程（登入中 / token 刷新中） */
    isLoading: boolean;
    /** 目前是否已登入（有有效的 access token） */
    isSignedIn: boolean;
    /** 目前的 access token（短期，約 1 小時過期） */
    accessToken: string | null;
    /** Access token 的過期時間（Unix ms） */
    tokenExpiresAt: number | null;
    /** 登入的 Google 使用者資訊 */
    user: GoogleUser | null;
    /** 最近一次錯誤訊息 */
    error: string | null;

    // Internal actions
    _setLoading: (v: boolean) => void;
    _setSignedIn: (token: string, expiresAt: number, user: GoogleUser) => void;
    _setSignedOut: () => void;
    _setError: (msg: string | null) => void;
    _updateToken: (token: string, expiresAt: number) => void;
}

export const useGoogleAuthStore = create<GoogleAuthState>((set) => ({
    isLoading: false,
    isSignedIn: false,
    accessToken: null,
    tokenExpiresAt: null,
    user: null,
    error: null,

    _setLoading: (v) => set({ isLoading: v }),
    _setSignedIn: (token, expiresAt, user) =>
        set({
            isSignedIn: true,
            accessToken: token,
            tokenExpiresAt: expiresAt,
            user,
            error: null,
            isLoading: false,
        }),
    _setSignedOut: () =>
        set({
            isSignedIn: false,
            accessToken: null,
            tokenExpiresAt: null,
            user: null,
            error: null,
            isLoading: false,
        }),
    _setError: (msg) => set({ error: msg, isLoading: false }),
    _updateToken: (token, expiresAt) =>
        set({ accessToken: token, tokenExpiresAt: expiresAt }),
}));

// ---------------------------------------------------------------------------
// 🔑 Module-level Refresh Token — 所有 useGoogleAuth 實例共享
// ---------------------------------------------------------------------------
// 為什麼不用 useRef？
//   useRef 是 per-hook-instance 的，settings.tsx 登入時設定的 ref
//   不會傳遞到 _layout.tsx 的實例。改用模組級變數後，
//   任何實例的 signIn() 設定的 refresh token，都能被其他實例的
//   getValidToken() 讀取到。
let _moduleRefreshToken: string | null = null;

// ---------------------------------------------------------------------------
// 🔧 Platform‐safe SecureStore helpers
// ---------------------------------------------------------------------------
// expo-secure-store 在 Web 上不支援，改用 sessionStorage fallback。
// sessionStorage 在關閉瀏覽器分頁時自動清除，安全性可接受。

async function secureSet(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
        try {
            sessionStorage.setItem(key, value);
        } catch {
            // Private browsing 可能禁用 sessionStorage
        }
    } else {
        await SecureStore.setItemAsync(key, value);
    }
}

async function secureGet(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
        try {
            return sessionStorage.getItem(key);
        } catch {
            return null;
        }
    }
    return SecureStore.getItemAsync(key);
}

async function secureDelete(key: string): Promise<void> {
    if (Platform.OS === 'web') {
        try {
            sessionStorage.removeItem(key);
        } catch {
            // no-op
        }
    } else {
        await SecureStore.deleteItemAsync(key);
    }
}

// ---------------------------------------------------------------------------
// 🧩 Token Exchange & Refresh 工具函式
// ---------------------------------------------------------------------------

/**
 * 使用 authorization code 換取 access token + refresh token。
 *
 * OAuth 2.0 Authorization Code Flow（含 PKCE）：
 *   1. 使用者在 Google 授權頁面同意後，我們拿到 authorization code
 *   2. 用這個 code 向 Google token endpoint 換取 access + refresh token
 *   3. access token 有效期約 1 小時，refresh token 可重複使用
 */
async function exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    redirectUri: string,
): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number;
}> {
    const tokenEndpoint = 'https://oauth2.googleapis.com/token';

    const params: Record<string, string> = {
        code,
        client_id: googleClientId,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
    };

    // Web Application 類型的 OAuth Client 需要 client_secret
    // 若未設定（如 native 平台使用 PKCE），則不帶入
    if (googleClientSecret) {
        params.client_secret = googleClientSecret;
    }

    const body = new URLSearchParams(params);

    const res = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Token exchange failed (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    return {
        accessToken: data.access_token as string,
        refreshToken: (data.refresh_token as string) ?? null,
        expiresIn: (data.expires_in as number) ?? 3600,
    };
}

/**
 * 使用 refresh token 取得新的 access token。
 *
 * 當 access token 過期時（約 1 小時後），我們用儲存的 refresh token
 * 向 Google 請求新的 access token，使用者不需要重新登入。
 *
 * @throws 如果 refresh token 也失效（使用者撤銷授權），需要重新登入
 */
async function refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
}> {
    const tokenEndpoint = 'https://oauth2.googleapis.com/token';

    const params: Record<string, string> = {
        refresh_token: refreshToken,
        client_id: googleClientId,
        grant_type: 'refresh_token',
    };

    // Web Application 類型的 OAuth Client 同樣需要 client_secret
    if (googleClientSecret) {
        params.client_secret = googleClientSecret;
    }

    const body = new URLSearchParams(params);

    const res = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Token refresh failed (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    return {
        accessToken: data.access_token as string,
        expiresIn: (data.expires_in as number) ?? 3600,
    };
}

/**
 * 透過 Google UserInfo API 取得使用者基本資訊。
 *
 * 即使我們沒有請求 `profile` scope，`drive.appdata` scope 仍可取得基本 email。
 * 但為了保險，我們用 UserInfo endpoint 嘗試抓取，失敗則 fallback。
 */
async function fetchUserInfo(accessToken: string): Promise<GoogleUser> {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
            const data = await res.json();
            return {
                email: (data.email as string) ?? 'unknown',
                name: (data.name as string) ?? (data.email as string) ?? 'Google User',
            };
        }
    } catch {
        // UserInfo 失敗不是致命的
    }
    return { email: 'unknown', name: 'Google User' };
}

// ---------------------------------------------------------------------------
// 🎣 useGoogleAuth — 主 Hook
// ---------------------------------------------------------------------------

/**
 * Google OAuth 2.0 認證 Hook。
 *
 * 提供 signIn()、signOut()、getValidToken() 三個核心操作。
 * 在元件 mount 時，自動嘗試用 SecureStore 中的 refresh token 恢復登入狀態。
 *
 * @example
 * ```tsx
 * function SettingsScreen() {
 *   const { isSignedIn, user, signIn, signOut } = useGoogleAuth();
 *   return isSignedIn
 *     ? <Text>已登入：{user?.email}</Text>
 *     : <Button title="連結 Google" onPress={signIn} />;
 * }
 * ```
 */
export function useGoogleAuth() {
    const store = useGoogleAuthStore();

    // ── Discovery Document ──
    // Google 的 OpenID 配置端點不支援 CORS（不返回 Access-Control-Allow-Origin），
    // 導致 useAutoDiscovery 在 Web 上永遠 fetch 失敗，觸發紅色 error overlay。
    // 修法：Web 上使用靜態 discovery object（Google 的 OAuth endpoints 基本不變），
    // 原生端保持用 useAutoDiscovery 自動獲取（原生不受 CORS 限制）。
    //
    // ⚠️ React Rules of Hooks：Hook 必須在每次 render 都呼叫（不能 if/else）。
    //    所以 useAutoDiscovery 始終傳入有效 URL，但 Web 上忽略其結果。
    const autoDiscovery = AuthSession.useAutoDiscovery(GOOGLE_DISCOVERY_DOC_URL);

    /** Web 上使用靜態 Google OAuth endpoint 定義（避免 CORS 問題） */
    const WEB_STATIC_DISCOVERY: AuthSession.DiscoveryDocument = {
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
        userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    };

    const discovery: AuthSession.DiscoveryDocument | null =
        Platform.OS === 'web' ? WEB_STATIC_DISCOVERY : autoDiscovery;

    // ── Redirect URI ──
    // expo-auth-session 會根據平台自動選擇適合的 redirect URI。
    // Web: 使用當前域名
    // Native: 使用 Expo proxy 或 custom scheme
    const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'mobile',
    });

    // ── Auth Request ──
    const [request, , promptAsync] = AuthSession.useAuthRequest(
        {
            clientId: googleClientId,
            scopes: [...GOOGLE_DRIVE_SCOPES],
            redirectUri,
            // 要求 offline access 以取得 refresh token
            extraParams: {
                access_type: 'offline',
                prompt: 'consent',
            },
            usePKCE: true,
        },
        discovery ?? null,
    );

    // ── 自動恢復登入狀態（Mount 時） ──
    useEffect(() => {
        if (!isGoogleConfigured()) return;

        let cancelled = false;

        (async () => {
            try {
                const savedRefreshToken = await secureGet(SECURE_KEY_REFRESH_TOKEN);
                if (!savedRefreshToken || cancelled) return;

                _moduleRefreshToken = savedRefreshToken;
                store._setLoading(true);

                const { accessToken, expiresIn } = await refreshAccessToken(savedRefreshToken);
                if (cancelled) return;

                const tokenExpiresAt = Date.now() + expiresIn * 1000;

                // 嘗試從 SecureStore 讀取快取的使用者資訊，避免多一次 network call
                const cachedEmail = await secureGet(SECURE_KEY_USER_EMAIL);
                const cachedName = await secureGet(SECURE_KEY_USER_NAME);
                let user: GoogleUser;

                if (cachedEmail && cachedName) {
                    user = { email: cachedEmail, name: cachedName };
                } else {
                    user = await fetchUserInfo(accessToken);
                    await secureSet(SECURE_KEY_USER_EMAIL, user.email);
                    await secureSet(SECURE_KEY_USER_NAME, user.name);
                }

                if (!cancelled) {
                    store._setSignedIn(accessToken, tokenExpiresAt, user);
                }
            } catch (err) {
                if (!cancelled) {
                    // Refresh token 可能已失效，清理本地狀態
                    await secureDelete(SECURE_KEY_REFRESH_TOKEN);
                    await secureDelete(SECURE_KEY_USER_EMAIL);
                    await secureDelete(SECURE_KEY_USER_NAME);
                    _moduleRefreshToken = null;
                    store._setSignedOut();
                }
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── signIn：啟動 OAuth 授權流程 ──
    const signIn = useCallback(async () => {
        // ── 防止重入：避免多次點擊產生多個 OAuth popup ──
        // expo-web-browser 的 openAuthSessionAsync 使用 setInterval 輪詢 popup.closed，
        // 當 Google 設定 Cross-Origin-Opener-Policy 時，每次輪詢都會觸發 COOP 警告。
        // 多個 popup session 同時運行 = 多重 setInterval = 海量 COOP 警告。
        if (store.isLoading) {
            console.info('[useGoogleAuth] OAuth 流程進行中，忽略重複請求');
            return;
        }

        // ── Web 端：關閉殘留的 OAuth popup 視窗 ──
        // 如果上次的 popup 沒有被正確關閉（使用者直接關瀏覽器分頁等情況），
        // dismissAuthSession 會清除 listener、interval、localStorage 殘留。
        if (Platform.OS === 'web') {
            WebBrowser.dismissAuthSession();
        }

        if (!isGoogleConfigured()) {
            store._setError('Google Client ID 尚未設定。請在 .env 中設置 EXPO_PUBLIC_GOOGLE_CLIENT_ID。');
            return;
        }
        if (!request || !discovery) {
            store._setError('OAuth 尚未準備就緒，請稍候再試。');
            return;
        }

        store._setLoading(true);
        store._setError(null);

        try {
            const result = await promptAsync();

            if (result.type !== 'success' || !result.params?.code) {
                if (result.type === 'cancel' || result.type === 'dismiss') {
                    store._setLoading(false);
                    return; // 使用者取消，不視為錯誤
                }
                throw new Error(`OAuth 失敗：${result.type}`);
            }

            // 用 authorization code 換取 tokens
            const { accessToken, refreshToken, expiresIn } = await exchangeCodeForTokens(
                result.params.code,
                request.codeVerifier!,
                redirectUri,
            );

            const tokenExpiresAt = Date.now() + expiresIn * 1000;

            // 保存 refresh token 到安全儲存
            if (refreshToken) {
                await secureSet(SECURE_KEY_REFRESH_TOKEN, refreshToken);
                _moduleRefreshToken = refreshToken;
            }

            // 取得使用者資訊
            const user = await fetchUserInfo(accessToken);
            await secureSet(SECURE_KEY_USER_EMAIL, user.email);
            await secureSet(SECURE_KEY_USER_NAME, user.name);

            store._setSignedIn(accessToken, tokenExpiresAt, user);
        } catch (err) {
            const message = err instanceof Error ? err.message : '登入時發生未知錯誤';
            store._setError(message);
        }
    }, [request, discovery, promptAsync, redirectUri, store]);

    // ── signOut：登出並清除所有 token ──
    const signOut = useCallback(async () => {
        store._setLoading(true);

        try {
            // 嘗試撤銷 Google 端的授權（best-effort）
            const currentToken = store.accessToken;
            if (currentToken) {
                try {
                    await fetch(`https://oauth2.googleapis.com/revoke?token=${currentToken}`, {
                        method: 'POST',
                    });
                } catch {
                    // 撤銷失敗不阻塞登出流程
                }
            }

            // 清除本地所有 token 和使用者資訊
            await secureDelete(SECURE_KEY_REFRESH_TOKEN);
            await secureDelete(SECURE_KEY_USER_EMAIL);
            await secureDelete(SECURE_KEY_USER_NAME);
            _moduleRefreshToken = null;

            store._setSignedOut();
        } catch {
            // 即使清除過程中有錯誤，仍然標記為已登出
            store._setSignedOut();
        }
    }, [store]);

    // ── getValidToken：取得有效的 access token（自動刷新） ──
    const getValidToken = useCallback(async (): Promise<string | null> => {
        const state = useGoogleAuthStore.getState();

        // 如果 token 還有至少 5 分鐘有效期，直接回傳
        if (
            state.accessToken &&
            state.tokenExpiresAt &&
            state.tokenExpiresAt > Date.now() + 5 * 60 * 1000
        ) {
            return state.accessToken;
        }

        // 需要刷新
        const rt = _moduleRefreshToken;
        if (!rt) return null;

        try {
            const { accessToken, expiresIn } = await refreshAccessToken(rt);
            const tokenExpiresAt = Date.now() + expiresIn * 1000;
            useGoogleAuthStore.getState()._updateToken(accessToken, tokenExpiresAt);
            return accessToken;
        } catch {
            // Refresh 失敗 → 登出
            await secureDelete(SECURE_KEY_REFRESH_TOKEN);
            _moduleRefreshToken = null;
            useGoogleAuthStore.getState()._setSignedOut();
            return null;
        }
    }, []);

    return {
        /** 是否正在進行 OAuth 流程 */
        isLoading: store.isLoading,
        /** 是否已登入 Google */
        isSignedIn: store.isSignedIn,
        /** 登入的使用者資訊 */
        user: store.user,
        /** 錯誤訊息 */
        error: store.error,
        /** Google 設定是否已完成 */
        isConfigured: isGoogleConfigured(),
        /** 啟動 Google 登入流程 */
        signIn,
        /** 登出 Google */
        signOut,
        /** 取得有效的 access token（自動刷新已過期的 token） */
        getValidToken,
    };
}
