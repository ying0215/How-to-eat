// ============================================================================
// 📁 useGoogleAuth.ts — Google OAuth 2.0 認證 Hook
// ============================================================================
//
// 職責：管理 Google 帳號的登入/登出/token 刷新完整生命週期。
//
// 技術選型：
//   - Native: 使用 expo-auth-session 做 OAuth（自動 PKCE、跨平台一致）
//   - Web: 自訂 OAuth 流程 + BroadcastChannel（繞過 COOP 限制）
//
// Web COOP 問題：
//   Google 的 accounts.google.com 設定了 Cross-Origin-Opener-Policy: same-origin，
//   導致 expo-web-browser 的 popup 機制無法使用 window.opener.postMessage()。
//   解法：popup 回調後透過 BroadcastChannel 傳送授權碼給主視窗。
//
// 安全措施：
//   - Access Token 存在記憶體（不持久化，1 小時過期）
//   - Refresh Token 存在 expo-secure-store（加密儲存）
//   - 登出時同時清除本地 token + Google 端授權
//   - Web 使用 PKCE 保護 Authorization Code 交換
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
import {
    handleOAuthCallback,
    OAUTH_BROADCAST_CHANNEL_NAME,
    type OAuthCallbackMessage,
} from './oauthCallbackHandler';

// ---------------------------------------------------------------------------
// 🌐 Web OAuth Popup 回調處理（雙軌策略）
// ---------------------------------------------------------------------------
// Native: 使用 expo-web-browser 的 maybeCompleteAuthSession()（原始機制）
// Web: 使用自訂的 handleOAuthCallback()（BroadcastChannel 方案，繞過 COOP）
//
// ⚠️ 必須在模組頂層呼叫（不在 Hook 內），確保在 React 渲染之前就執行。
if (Platform.OS === 'web') {
    // Web: 檢查是否為 OAuth popup 回調頁面
    // 如果是 → 透過 BroadcastChannel 傳送授權碼給主視窗
    // 如果不是 → 什麼都不做
    const result = handleOAuthCallback();
    if (result.type === 'success') {
        console.info('[useGoogleAuth] Web OAuth 回調已處理:', result.message);
    }
} else {
    // Native: 使用原始的 expo-web-browser 機制
    WebBrowser.maybeCompleteAuthSession();
}

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
// 🌐 Web 專用：PKCE 工具函式
// ---------------------------------------------------------------------------
// Web 端自訂 OAuth 流程需要手動產生 PKCE code_verifier 和 code_challenge。
// Native 端由 expo-auth-session 自動處理。

/**
 * 產生隨機的 code_verifier（43~128 字元的 URL-safe 字串）。
 * 使用 Web Crypto API 確保密碼學安全性。
 */
function generateCodeVerifier(length = 64): string {
    const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => CHARSET[byte % CHARSET.length]).join('');
}

/**
 * 使用 SHA-256 計算 code_challenge（Base64URL 編碼）。
 *
 * OAuth 2.0 PKCE 規範：
 *   code_challenge = BASE64URL(SHA256(code_verifier))
 */
async function generateCodeChallenge(codeVerifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    // Base64URL 編碼（不含 padding）
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
    return base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * 產生隨機的 OAuth state 參數（CSRF 防護）。
 */
function generateOAuthState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// 🌐 Web 專用：自訂 OAuth 登入流程
// ---------------------------------------------------------------------------

/** Web OAuth popup 超時時間（毫秒） */
const WEB_OAUTH_TIMEOUT_MS = 2 * 60 * 1000; // 2 分鐘

/** Web OAuth popup 視窗大小 */
const WEB_POPUP_WIDTH = 500;
const WEB_POPUP_HEIGHT = 650;

/**
 * Web 端自訂 OAuth 登入流程。
 *
 * 使用 BroadcastChannel API 取代 expo-web-browser 的 popup 機制，
 * 繞過 Google 的 Cross-Origin-Opener-Policy (COOP) 限制。
 *
 * 流程：
 * 1. 產生 PKCE code_verifier + code_challenge
 * 2. 構建 Google OAuth URL
 * 3. 開啟 popup 視窗
 * 4. 監聽 BroadcastChannel 等待 popup 回傳 authorization code
 * 5. 用 code + code_verifier 換取 access + refresh token
 * 6. 取得使用者資訊，更新 store
 *
 * @param store - GoogleAuthState Zustand store
 * @param redirectUri - OAuth redirect URI（popup 回調後會導向此 URL）
 */
async function signInWeb(
    store: GoogleAuthState,
    redirectUri: string,
): Promise<void> {
    // 1. 產生 PKCE 參數
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateOAuthState();

    console.info('[signInWeb] PKCE 參數已產生');
    console.info('[signInWeb] Redirect URI:', redirectUri);

    // 2. 構建 Google OAuth URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', googleClientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_DRIVE_SCOPES.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    // 3. 開啟 popup 視窗
    const top = Math.max(0, (window.screen.height - WEB_POPUP_HEIGHT) * 0.5);
    const left = Math.max(0, (window.screen.width - WEB_POPUP_WIDTH) * 0.5);
    const features = `width=${WEB_POPUP_WIDTH},height=${WEB_POPUP_HEIGHT},top=${top},left=${left},toolbar=no,menubar=no,resizable=yes,scrollbars=yes`;

    const popup = window.open(authUrl.toString(), '_blank', features);
    if (!popup) {
        throw new Error('瀏覽器封鎖了彈出視窗。請允許此網站的彈出視窗後再試。');
    }

    try {
        popup.focus();
    } catch {
        // focus 失敗不影響功能
    }

    console.info('[signInWeb] OAuth popup 已開啟，等待 BroadcastChannel 回傳...');

    // 4. 監聽 BroadcastChannel 等待 popup 回傳 authorization code
    const code = await new Promise<string>((resolve, reject) => {
        const channel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL_NAME);
        let settled = false;

        // 超時處理
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                channel.close();
                // 嘗試關閉 popup
                try { popup.close(); } catch { /* COOP 可能阻止 */ }
                reject(new Error('OAuth 登入逾時（2 分鐘）。請重試。'));
            }
        }, WEB_OAUTH_TIMEOUT_MS);

        // 定期檢查 popup 是否被使用者手動關閉
        const pollInterval = setInterval(() => {
            try {
                if (popup.closed && !settled) {
                    settled = true;
                    clearTimeout(timeout);
                    clearInterval(pollInterval);
                    channel.close();
                    reject(new Error('使用者關閉了登入視窗。'));
                }
            } catch {
                // COOP 可能阻止讀取 popup.closed，忽略錯誤
                // 此時只能依賴 BroadcastChannel 的回傳或超時
            }
        }, 2000);

        // 監聯 BroadcastChannel 訊息
        channel.onmessage = (event: MessageEvent) => {
            if (settled) return;

            const data = event.data;

            // 檢查是否為 OAuth 錯誤回應
            if (data?.source === 'expo-oauth-popup' && data?.error) {
                settled = true;
                clearTimeout(timeout);
                clearInterval(pollInterval);
                channel.close();
                try { popup.close(); } catch { /* ignore */ }
                reject(new Error(`OAuth 錯誤：${data.error} — ${data.errorDescription || ''}`));
                return;
            }

            // 檢查是否為正確的 OAuth 回應
            if (data?.source === 'expo-oauth-popup' && data?.code) {
                const msg = data as OAuthCallbackMessage;
                // 驗證 state 參數（CSRF 防護）
                if (msg.state !== state) {
                    console.warn('[signInWeb] State 不匹配，忽略此訊息', {
                        expected: state,
                        received: msg.state,
                    });
                    return;
                }

                settled = true;
                clearTimeout(timeout);
                clearInterval(pollInterval);
                channel.close();
                try { popup.close(); } catch { /* COOP 可能阻止 */ }
                console.info('[signInWeb] ✅ 收到授權碼');
                resolve(msg.code);
            }
        };
    });

    // 5. 用 authorization code 換取 tokens
    console.info('[signInWeb] 正在交換 token...');
    const { accessToken, refreshToken, expiresIn } = await exchangeCodeForTokens(
        code,
        codeVerifier,
        redirectUri,
    );

    const tokenExpiresAt = Date.now() + expiresIn * 1000;

    // 6. 保存 refresh token
    if (refreshToken) {
        await secureSet(SECURE_KEY_REFRESH_TOKEN, refreshToken);
        _moduleRefreshToken = refreshToken;
        console.info('[signInWeb] ✅ Refresh token 已保存');
    } else {
        console.warn('[signInWeb] ⚠️ 未收到 refresh token');
    }

    // 7. 取得使用者資訊
    const user = await fetchUserInfo(accessToken);
    await secureSet(SECURE_KEY_USER_EMAIL, user.email);
    await secureSet(SECURE_KEY_USER_NAME, user.name);

    // 8. 更新 store
    store._setSignedIn(accessToken, tokenExpiresAt, user);
    console.info('[signInWeb] ✅ 登入成功:', user.email);
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
    // Web: 使用當前域名（需特別處理 GitHub Pages 子路徑）
    // Native: 使用 Expo proxy 或 custom scheme
    //
    // ⚠️ GitHub Pages 部署修正：
    //   AuthSession.makeRedirectUri() 在 GitHub Pages 上只會產生
    //   https://ying0215.github.io（根路徑），但 App 實際部署在
    //   /How-to-eat/ 子路徑下。Google OAuth 回調後會導向根路徑，
    //   造成 404 頁面。
    //   修正方式：在 Web 上使用 window.location.origin + baseUrl 作為 redirect URI。
    const redirectUri = Platform.OS === 'web'
        ? (() => {
            // 使用當前頁面的 origin 作為 redirect URI 的基底
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
            const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

            // Localhost 環境：不需要子路徑，直接使用 origin + /
            // 部署環境（GitHub Pages / Vercel 等）：需要保留第一層路徑（如 /How-to-eat/）
            const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
            let basePath: string;
            if (isLocalhost) {
                basePath = ''; // localhost → http://localhost:8081/
            } else {
                // 取得部署子路徑（例如 /How-to-eat），忽略 Expo router 的頁面路徑
                basePath = pathname.split('/').slice(0, 2).join('/'); // → /How-to-eat
                if (basePath === '/') basePath = '';
            }

            const uri = origin + basePath + '/';
            console.info('[useGoogleAuth] Web redirectUri:', uri);
            return uri;
        })()
        : AuthSession.makeRedirectUri({
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
        if (store.isLoading) {
            console.info('[useGoogleAuth] OAuth 流程進行中，忽略重複請求');
            return;
        }

        if (!isGoogleConfigured()) {
            store._setError('Google Client ID 尚未設定。請在 .env 中設置 EXPO_PUBLIC_GOOGLE_CLIENT_ID。');
            return;
        }

        store._setLoading(true);
        store._setError(null);

        try {
            if (Platform.OS === 'web') {
                // ═══════════════════════════════════════════════════════
                // 🌐 Web：自訂 OAuth 流程（BroadcastChannel 方案）
                // ═══════════════════════════════════════════════════════
                // 繞過 expo-web-browser 的 popup 機制，因為 Google 的 COOP
                // 會阻止 popup 與主視窗的 window.opener 通訊。
                // 改用 BroadcastChannel API，不依賴 window.opener。
                await signInWeb(store, redirectUri);
            } else {
                // ═══════════════════════════════════════════════════════
                // 📱 Native：使用 expo-auth-session（原始機制）
                // ═══════════════════════════════════════════════════════
                if (!request || !discovery) {
                    store._setError('OAuth 尚未準備就緒，請稍候再試。');
                    return;
                }

                const result = await promptAsync();

                if (result.type !== 'success' || !result.params?.code) {
                    if (result.type === 'cancel' || result.type === 'dismiss') {
                        store._setLoading(false);
                        return;
                    }
                    throw new Error(`OAuth 失敗：${result.type}`);
                }

                const { accessToken, refreshToken, expiresIn } = await exchangeCodeForTokens(
                    result.params.code,
                    request.codeVerifier!,
                    redirectUri,
                );

                const tokenExpiresAt = Date.now() + expiresIn * 1000;

                if (refreshToken) {
                    await secureSet(SECURE_KEY_REFRESH_TOKEN, refreshToken);
                    _moduleRefreshToken = refreshToken;
                }

                const user = await fetchUserInfo(accessToken);
                await secureSet(SECURE_KEY_USER_EMAIL, user.email);
                await secureSet(SECURE_KEY_USER_NAME, user.name);

                store._setSignedIn(accessToken, tokenExpiresAt, user);
            }
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
    const getValidToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
        const state = useGoogleAuthStore.getState();

        // 如果 token 還有至少 5 分鐘有效期且非強制刷新，直接回傳
        if (
            !forceRefresh &&
            state.accessToken &&
            state.tokenExpiresAt &&
            state.tokenExpiresAt > Date.now() + 5 * 60 * 1000
        ) {
            const remainingMin = Math.round((state.tokenExpiresAt - Date.now()) / 60000);
            console.info(`[getValidToken] ✅ Token 有效（剩餘 ${remainingMin} 分鐘），直接使用`);
            return state.accessToken;
        }

        // 需要刷新
        const rt = _moduleRefreshToken;
        if (!rt) {
            console.warn('[getValidToken] ⚠️ 無 refresh token，無法刷新');
            return null;
        }

        const remainingMs = state.tokenExpiresAt ? state.tokenExpiresAt - Date.now() : -Infinity;
        if (forceRefresh) {
            console.info('[getValidToken] 🔄 強制使用 refresh token 刷新...');
        } else {
            console.info(
                `[getValidToken] 🔄 Token ${remainingMs <= 0 ? '已過期' : `即滿期（剩餘 ${Math.round(remainingMs / 1000)}s）`}，正在用 refresh token 刷新...`,
            );
        }

        try {
            const { accessToken, expiresIn } = await refreshAccessToken(rt);
            const tokenExpiresAt = Date.now() + expiresIn * 1000;
            useGoogleAuthStore.getState()._updateToken(accessToken, tokenExpiresAt);
            console.info(`[getValidToken] ✅ Token 刷新成功，新 token 有效期 ${expiresIn} 秒`);
            return accessToken;
        } catch (refreshErr) {
            // Refresh 失敗 → 登出
            console.error('[getValidToken] ❌ Refresh token 失效，強制登出:', refreshErr);
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

// ---------------------------------------------------------------------------
// 🛡️ Global Auth Interceptor 綁定
// ---------------------------------------------------------------------------
import { setAuthRefreshHandler } from './authInterceptor';

/**
 * 非 Hook 版本，供全域攔截器呼叫強制刷新 Token。
 * 網路層 (fetchWithResilience) 收到 401 時會觸發。
 */
export async function forceRefreshTokenStandalone(): Promise<string | null> {
    const rt = _moduleRefreshToken;
    if (!rt) {
        console.warn('[AuthInterceptor] ⚠️ 無 refresh token，無法執行全域刷新');
        return null;
    }
    
    console.info('[AuthInterceptor] 🔄 攔截到 401/403，啟動全域 Silent Token Refresh...');
    try {
        const { accessToken, expiresIn } = await refreshAccessToken(rt);
        const tokenExpiresAt = Date.now() + expiresIn * 1000;
        useGoogleAuthStore.getState()._updateToken(accessToken, tokenExpiresAt);
        console.info(`[AuthInterceptor] ✅ 全域 Token 刷新成功，新 token 有效期 ${expiresIn} 秒`);
        return accessToken;
    } catch (refreshErr) {
        console.error('[AuthInterceptor] ❌ 全域 Refresh token 失效，強制登出:', refreshErr);
        await secureDelete(SECURE_KEY_REFRESH_TOKEN);
        await secureDelete(SECURE_KEY_USER_EMAIL);
        await secureDelete(SECURE_KEY_USER_NAME);
        _moduleRefreshToken = null;
        useGoogleAuthStore.getState()._setSignedOut();
        return null;
    }
}

// 在模組初始時註冊
setAuthRefreshHandler(forceRefreshTokenStandalone);
