// ============================================================================
// 📁 oauthCallbackHandler.ts — OAuth Popup 回調處理（BroadcastChannel 方案）
// ============================================================================
//
// 📖 解決 Cross-Origin-Opener-Policy (COOP) 導致 OAuth popup 無法溝通的問題。
//
// 背景：
//   Google 的 accounts.google.com 設定了 COOP: same-origin，
//   這會清空 popup 視窗中的 window.opener，導致：
//   1. expo-web-browser 的 postMessage() 無法回傳授權碼
//   2. window.closed 無法被輪詢
//   3. window.close() 被阻止
//
// 解法：
//   使用 BroadcastChannel API 取代 window.opener.postMessage()。
//   BroadcastChannel 只需要兩個視窗是同源 (same-origin) 即可通訊，
//   不受 COOP 限制。
//
// 流程：
//   [主視窗] → window.open(Google OAuth URL) → [popup: Google 登入]
//              ↓ 使用者授權
//           [popup: redirect 回 app（URL 含 ?code=xxx&state=xxx）]
//              ↓ app bundle 載入 → 此模組在模組頂層執行
//           [popup: BroadcastChannel.postMessage({ code, state })]
//              ↓
//   [主視窗] ← BroadcastChannel.onmessage ← 收到 code → token exchange
// ============================================================================

import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// 🔑 常數
// ---------------------------------------------------------------------------

/** BroadcastChannel 名稱，主視窗和 popup 必須使用相同名稱 */
export const OAUTH_BROADCAST_CHANNEL_NAME = 'expo-oauth-callback';

/** 用於標記「此次頁面載入是 OAuth 回調」的 sessionStorage 鍵 */
const OAUTH_CALLBACK_HANDLED_KEY = 'oauth_callback_handled';

// ---------------------------------------------------------------------------
// 🔧 型別定義
// ---------------------------------------------------------------------------

/** BroadcastChannel 傳送的訊息格式 */
export interface OAuthCallbackMessage {
    /** OAuth authorization code */
    code: string;
    /** OAuth state 參數（用於 CSRF 防護驗證） */
    state: string;
    /** 訊息來源標記 */
    source: 'expo-oauth-popup';
}

// ---------------------------------------------------------------------------
// 🧩 回調處理邏輯
// ---------------------------------------------------------------------------

/**
 * 檢查當前頁面是否是 OAuth 回調頁面，並透過 BroadcastChannel 傳送授權碼。
 *
 * 此函式必須在模組頂層呼叫（類似 maybeCompleteAuthSession），
 * 確保在 React 渲染之前就處理回調。
 *
 * 檢測條件：URL 中同時包含 `code` 和 `state` query 參數。
 *
 * @returns 處理結果
 */
export function handleOAuthCallback(): {
    type: 'success' | 'ignored' | 'error';
    message: string;
} {
    // 僅在 Web 平台執行
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
        return { type: 'ignored', message: 'Not a web environment' };
    }

    // 防止重複處理（例如 HMR 重載時）
    try {
        if (sessionStorage.getItem(OAUTH_CALLBACK_HANDLED_KEY) === window.location.href) {
            return { type: 'ignored', message: 'Callback already handled for this URL' };
        }
    } catch {
        // sessionStorage 不可用（private browsing），繼續執行
    }

    // 解析 URL 參數
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    // 沒有 code 或 state → 不是 OAuth 回調頁面
    if (!code || !state) {
        return { type: 'ignored', message: 'Not an OAuth callback URL' };
    }

    // 檢查是否有 error 參數（使用者拒絕授權等）
    const error = url.searchParams.get('error');
    if (error) {
        console.warn('[OAuthCallback] OAuth error:', error);
        // 即使有錯誤，也要通知主視窗
        try {
            const channel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL_NAME);
            channel.postMessage({
                error,
                errorDescription: url.searchParams.get('error_description') || '',
                source: 'expo-oauth-popup',
            });
            channel.close();
        } catch (broadcastError) {
            console.error('[OAuthCallback] BroadcastChannel error:', broadcastError);
        }
        return { type: 'error', message: `OAuth error: ${error}` };
    }

    console.info('[OAuthCallback] 偵測到 OAuth 回調，正在傳送授權碼...');

    try {
        // 透過 BroadcastChannel 傳送授權碼給主視窗
        const channel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL_NAME);
        const message: OAuthCallbackMessage = {
            code,
            state,
            source: 'expo-oauth-popup',
        };
        channel.postMessage(message);
        channel.close();

        // 標記已處理，防止重複
        try {
            sessionStorage.setItem(OAUTH_CALLBACK_HANDLED_KEY, window.location.href);
        } catch {
            // sessionStorage 不可用
        }

        console.info('[OAuthCallback] ✅ 授權碼已透過 BroadcastChannel 傳送');

        // 嘗試關閉 popup（可能被 COOP 阻止，但試試無妨）
        // 使用延遲確保 BroadcastChannel 訊息已送出
        setTimeout(() => {
            try {
                window.close();
            } catch {
                console.info('[OAuthCallback] 無法自動關閉視窗，請手動關閉此分頁');
            }
        }, 500);

        // 清除 URL 中的 OAuth 參數，避免重新整理時重複觸發
        // 使用 replaceState 不會觸發頁面重新載入
        try {
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('code');
            cleanUrl.searchParams.delete('state');
            cleanUrl.searchParams.delete('scope');
            cleanUrl.searchParams.delete('authuser');
            cleanUrl.searchParams.delete('prompt');
            window.history.replaceState({}, '', cleanUrl.toString());
        } catch {
            // URL 清除失敗不影響功能
        }

        return { type: 'success', message: 'OAuth callback handled successfully' };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[OAuthCallback] 處理回調時發生錯誤:', message);
        return { type: 'error', message };
    }
}
