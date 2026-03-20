// ============================================================================
// 📁 useNetworkStatus.ts — 網路連線狀態偵測 Hook
// ============================================================================
//
// 🎯 職責：
//   偵測裝置的網路連線狀態（在線/離線），供 SyncOrchestrator 與 UI 使用。
//
// 📖 設計原則：
//   1. 多平台相容（Web 使用 navigator.onLine + 事件 / Native 使用 polling）
//   2. 輕量級：不引入額外套件（如 @react-native-community/netinfo）
//   3. 支援手動刷新連線狀態
//   4. 提供 Zustand store 供非 Hook 場景存取
//
// ⚠️ 為什麼不用 @react-native-community/netinfo？
//   - 避免增加原生依賴（需要 rebuild）
//   - 減少 bundle size
//   - navigator.onLine 在 Web 上已足夠準確
//   - Native 端用 lightweight fetch probe 也能達到目的
//
// 🧠 偵測策略：
//   Web → navigator.onLine + online/offline events（即時通知）
//   Native → 定期 fetch HEAD 到 Google 伺服器（30 秒間隔）
// ============================================================================

import { useEffect, useCallback, useRef } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// 📦 Network Status Store
// ---------------------------------------------------------------------------

interface NetworkState {
    /** 裝置是否連線到網路 */
    isConnected: boolean;
    /** 最後一次成功的連線偵測時間 */
    lastCheckedAt: string | null;
    /** 是否正在偵測連線狀態 */
    isChecking: boolean;

    // Internal actions
    _setConnected: (v: boolean) => void;
    _setChecking: (v: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
    isConnected: true, // 樂觀預設為連線（避免首次渲染閃爍）
    lastCheckedAt: null,
    isChecking: false,

    _setConnected: (v) =>
        set({
            isConnected: v,
            lastCheckedAt: new Date().toISOString(),
            isChecking: false,
        }),
    _setChecking: (v) => set({ isChecking: v }),
}));

// ---------------------------------------------------------------------------
// 🔧 連線偵測工具函式
// ---------------------------------------------------------------------------

/** 用於連線偵測的 URL（Google 的 favicon，極小且全球 CDN 加速） */
const CONNECTIVITY_CHECK_URL = 'https://www.google.com/favicon.ico';

/** 連線偵測的超時時間（毫秒） */
const CONNECTIVITY_TIMEOUT_MS = 5000;

/** Native 端定期偵測間隔（毫秒） */
const NATIVE_POLL_INTERVAL_MS = 30_000;

/**
 * 透過 fetch HEAD 請求偵測網路連線狀態。
 *
 * 使用 HEAD 請求（不下載 body）來最小化流量消耗。
 * 加入 cache-busting query parameter 避免快取干擾。
 *
 * @returns true 表示網路連線正常
 */
async function probeConnectivity(): Promise<boolean> {
    const store = useNetworkStore.getState();

    // 防止並行偵測
    if (store.isChecking) return store.isConnected;

    store._setChecking(true);

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
            () => controller.abort(),
            CONNECTIVITY_TIMEOUT_MS,
        );

        // cache-busting：加上時間戳確保不命中瀏覽器快取
        const url = `${CONNECTIVITY_CHECK_URL}?_t=${Date.now()}`;

        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            // 不需要 credentials（避免 CORS 問題）
            mode: 'no-cors',
            cache: 'no-store',
        });

        clearTimeout(timeoutId);

        // 在 no-cors 模式下，response.type 為 'opaque'，
        // 只要沒拋出異常就代表網路可達
        const connected = response.type === 'opaque' || response.ok;
        store._setConnected(connected);
        return connected;
    } catch {
        // fetch 失敗 = 網路不可用（或超時）
        store._setConnected(false);
        return false;
    }
}

/**
 * 只使用 navigator.onLine 的快速判斷（Web 專用）。
 *
 * navigator.onLine 在瀏覽器中是即時的（通常幾毫秒內回應），
 * 但它只能偵測「是否連到 router」，不能確認「是否連到 Internet」。
 * 所以我們在變更事件觸發時額外做一次 probe 確認。
 */
function getNavigatorOnlineStatus(): boolean {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
        return navigator.onLine;
    }
    // 無法判定時，樂觀回傳 true
    return true;
}

// ---------------------------------------------------------------------------
// 🎣 useNetworkStatus — 網路狀態 Hook
// ---------------------------------------------------------------------------

/**
 * 網路連線狀態 Hook。
 *
 * 使用方式：
 * ```tsx
 * function SyncIndicator() {
 *   const { isConnected, checkNow } = useNetworkStatus();
 *   return (
 *     <View>
 *       <Text>{isConnected ? '🟢 在線' : '🔴 離線'}</Text>
 *       <Button title="重新偵測" onPress={checkNow} />
 *     </View>
 *   );
 * }
 * ```
 *
 * @returns 連線狀態和手動偵測函式
 */
export function useNetworkStatus() {
    const { isConnected, lastCheckedAt, isChecking } = useNetworkStore();
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── 手動觸發連線偵測 ──
    const checkNow = useCallback(async (): Promise<boolean> => {
        return probeConnectivity();
    }, []);

    // ── Web 平台：監聽 online/offline 事件 ──
    useEffect(() => {
        if (Platform.OS !== 'web') return;

        const handleOnline = () => {
            // navigator 報告上線，額外 probe 確認
            useNetworkStore.getState()._setConnected(true);
            probeConnectivity(); // 背景雙重確認
        };

        const handleOffline = () => {
            useNetworkStore.getState()._setConnected(false);
        };

        // 初始狀態
        useNetworkStore.getState()._setConnected(getNavigatorOnlineStatus());

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // ── Native 平台：定期 polling ──
    useEffect(() => {
        if (Platform.OS === 'web') return;

        // 啟動定期偵測
        const startPolling = () => {
            if (pollTimerRef.current) return; // 已在 polling 中
            pollTimerRef.current = setInterval(
                () => probeConnectivity(),
                NATIVE_POLL_INTERVAL_MS,
            );
        };

        const stopPolling = () => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };

        // 初始偵測一次
        probeConnectivity();
        startPolling();

        // 監聽 AppState：前景時 polling，背景時暫停（省電）
        const subscription = AppState.addEventListener(
            'change',
            (state: AppStateStatus) => {
                if (state === 'active') {
                    probeConnectivity(); // 回到前景立即偵測
                    startPolling();
                } else {
                    stopPolling();
                }
            },
        );

        return () => {
            stopPolling();
            subscription.remove();
        };
    }, []);

    return {
        /** 裝置是否連線到網路 */
        isConnected,
        /** 最後一次成功的連線偵測時間 */
        lastCheckedAt,
        /** 是否正在偵測連線狀態 */
        isChecking,
        /** 手動觸發一次連線偵測 */
        checkNow,
    };
}

/**
 * 非 Hook 版本：直接取得當前連線狀態。
 *
 * 用於 SyncOrchestrator 等非 React 元件場景。
 *
 * @returns 當前是否連線
 */
export function getNetworkStatus(): boolean {
    return useNetworkStore.getState().isConnected;
}

/**
 * 非 Hook 版本：執行一次連線偵測。
 *
 * @returns Promise<boolean> 連線狀態
 */
export async function checkNetworkConnectivity(): Promise<boolean> {
    return probeConnectivity();
}
