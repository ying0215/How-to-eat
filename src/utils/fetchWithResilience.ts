// ============================================================================
// 🛡️ fetchWithResilience.ts — 提供指數退避、逾時與熔斷機制的高級 Fetch
// ============================================================================
//
// 💡 架構決策：
//   為防範網路不穩與節省 API 費用，提供以下三大機制：
//   1. Timeout (逾時保護)：避免請求永久掛起。
//   2. Rate Limiter (頻率限制)：保護 API 不被短時間內過度呼叫。
//   3. Exponential Backoff (指數退避重試)：網路瞬斷時自動重試，提升可靠性。
// ============================================================================

import { useDiagnosticStore } from '../store/useDiagnosticStore';
import { runGlobalAuthRefresh } from '../auth/authInterceptor';

export interface ResilienceConfig {
    /** 網路逾時時間（毫秒），預設 10,000 */
    timeoutMs?: number;
    /** 最大重試次數，預設 3 */
    maxRetries?: number;
    /** 退避基礎時間（毫秒），預設 500 */
    baseDelayMs?: number;
    /** 全域 API 單一端點防抖間隔（毫秒），預設 1000 */
    rateLimitMs?: number;
    /** API 端點識別碼，用於 Rate Limit 計算 */
    endpointId: string;
}

const lastRequestTimes = new Map<string, number>();

/** 等待輔助函式 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 具有韌性策略的強化版 Fetch
 */
// 測試環境下是否啟用 Rate Limiting (讓 Jest 可以特定測試它)
export let isRateLimitingEnabled = process.env.NODE_ENV !== 'test' && process.env.JEST_WORKER_ID === undefined;
export const setRateLimitingEnabled = (enabled: boolean) => { isRateLimitingEnabled = enabled; };

export const fetchWithResilience = async (
    input: string,
    init?: RequestInit,
    config?: ResilienceConfig,
): Promise<Response> => {
    const endpointId = config?.endpointId ?? 'default';
    const rateLimitMs = config?.rateLimitMs ?? 1000;
    const maxRetries = config?.maxRetries ?? 3;
    const baseDelayMs = config?.baseDelayMs ?? 500;
    const timeoutMs = config?.timeoutMs ?? 10000;

    const { addLog } = useDiagnosticStore.getState();

    // ── 1. Rate Limiting 限制 ──
    const now = Date.now();
    const lastTime = lastRequestTimes.get(endpointId) ?? 0;

    if (isRateLimitingEnabled && now - lastTime < rateLimitMs) {
        addLog('warn', `API Rate Limited Triggered`, { endpointId, rateLimitMs });
        throw new Error(`保護機制：請求過於頻繁，請稍後再試`);
    }

    let retries = 0;

    while (true) {
        // 更新最近請求時間
        lastRequestTimes.set(endpointId, Date.now());

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            let response = await fetch(input, {
                ...init,
                signal: controller.signal,
            });
            clearTimeout(timer);

            // ── 全域 Auth Interceptor：自動處理 401 ──
            if (response.status === 401) {
                addLog('warn', `API 回傳 401 (Unauthorized)，觸發全域 Auth Interceptor...`, { endpointId });
                const newToken = await runGlobalAuthRefresh();

                if (newToken) {
                    addLog('info', `✅ Auth Interceptor 刷新成功，準備即時重播請求`, { endpointId });
                    
                    // 覆寫 Authorization 標頭
                    const headers = new Headers(init?.headers);
                    headers.set('Authorization', `Bearer ${newToken}`);
                    const newInit = { ...init, headers };

                    // 即時重發請求（不進入 while 的下一次，不增加 retries 計數）
                    const retryController = new AbortController();
                    const retryTimer = setTimeout(() => retryController.abort(), timeoutMs);
                    try {
                        const retryResponse = await fetch(input, {
                            ...newInit,
                            signal: retryController.signal
                        });
                        clearTimeout(retryTimer);
                        
                        // 覆蓋原始 response，若回放還是 401 就不再重複刷新
                        response = retryResponse;
                    } catch (retryErr) {
                        clearTimeout(retryTimer);
                        throw retryErr; // 將回放時的連線錯誤丟出，走正常重試邏輯
                    }
                } else {
                    addLog('error', `❌ Auth Interceptor 刷新失敗，放棄重播`, { endpointId });
                }
            }

            // 若回傳 429 或 5xx 錯誤，視為可重試的伺服器異常
            if (response.status === 429 || response.status >= 500) {
                const error = new Error(`Retryable Error: ${response.status}`);
                (error as any).status = response.status;
                if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    if (retryAfter) {
                        const seconds = parseInt(retryAfter, 10);
                        if (!isNaN(seconds)) {
                            (error as any).retryAfter = seconds;
                        }
                    }
                }
                throw error;
            }

            return response;
        } catch (error: unknown) {
            clearTimeout(timer);

            const isAbortError = error instanceof Error && error.name === 'AbortError';
            const errorMessage = isAbortError ? 'Request timeout' : (error instanceof Error ? error.message : String(error));
            
            // 是否超過最大重試次數
            if (retries >= maxRetries) {
                addLog('error', `API Request Failed permanently after ${retries} retries`, {
                    endpointId,
                    errorMessage
                });
                throw new Error(errorMessage);
            }

            retries++;
            
            // 基礎 Exponential Backoff 計算：baseDelay * 2^(retries-1)
            let currentDelay = baseDelayMs * Math.pow(2, retries - 1);
            
            // 若為 429 且伺服器有回傳 Retry-After，則優先採用
            if (error instanceof Error && (error as any).status === 429 && typeof (error as any).retryAfter === 'number') {
                currentDelay = (error as any).retryAfter * 1000;
            }
            
            // 加入 Jitter 避免驚群效應 (Thundering Herd)
            const jitter = Math.random() * 100;
            const finalDelay = Math.round(currentDelay + jitter);

            addLog('warn', `API Request Failed. Retrying ${retries}/${maxRetries}...`, {
                endpointId,
                errorMessage,
                nextRetryInMs: finalDelay
            });

            await delay(finalDelay);
        }
    }
};
