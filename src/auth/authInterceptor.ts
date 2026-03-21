/**
 * 全域 Auth Interceptor 註冊點。
 * 
 * 允許網路層 (fetchWithResilience)在遇到 401 (Unauthorized) 時，
 * 自動呼叫應用層 (useGoogleAuth) 註冊的 Token Refresh 邏輯。
 * 達成 SOC 且避免循環依賴。
 */

type AuthRefreshHandler = () => Promise<string | null>;

let globalAuthRefreshHandler: AuthRefreshHandler | null = null;

/**
 * 註冊全域的 Token 刷新處理函式。
 * 通常由 useGoogleAuth 或 App Root 初始化時呼叫。
 */
export function setAuthRefreshHandler(handler: AuthRefreshHandler): void {
    globalAuthRefreshHandler = handler;
}

/**
 * 供網路層呼叫以執行 Silent Token Refresh。
 * 若未註冊則回傳 null。
 */
export async function runGlobalAuthRefresh(): Promise<string | null> {
    if (!globalAuthRefreshHandler) {
        console.warn('[AuthInterceptor] 未註冊任何 Token Refresh 處理函式！');
        return null;
    }
    try {
        const newToken = await globalAuthRefreshHandler();
        return newToken;
    } catch (err) {
        console.error('[AuthInterceptor] 執行 Token Refresh 失敗:', err);
        return null;
    }
}
