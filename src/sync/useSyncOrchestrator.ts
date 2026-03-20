// ============================================================================
// 📁 useSyncOrchestrator.ts — 同步排程器
// ============================================================================
//
// 🎯 職責：協調本地 Zustand Store 與 Google Drive 之間的資料同步。
//
// 設計原則：Local-First Architecture
//   1. 所有操作即時寫入本地（AsyncStorage），UI 零延遲
//   2. 背景非同步同步到 Google Drive
//   3. 衝突自動以 LWW per-item 合併
//   4. 離線時標記 pendingSync，網路恢復後自動同步
//
// 同步觸發時機：
//   - 使用者修改最愛清單後 debounce 2 秒
//   - App 從背景回到前景
//   - 手動觸發同步
//   - 網路從離線恢復為在線（若有 pendingSync）
// ============================================================================

import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGoogleAuthStore } from '../auth/useGoogleAuth';
import { downloadFavorites, uploadFavorites, DriveApiError } from './GoogleDriveAdapter';
import {
    mergeStates,
    upgradeToSyncable,
    downgradeFromSyncable,
    generateDeviceId,
    createEmptySyncState,
    type SyncableFavoriteState,
    type SyncableFavorite,
} from './mergeStrategy';
import { useFavoriteStore, type FavoriteRestaurant } from '../store/useFavoriteStore';
import { getNetworkStatus, useNetworkStore } from '../hooks/useNetworkStatus';

// ---------------------------------------------------------------------------
// 📦 Sync Metadata Store
// ---------------------------------------------------------------------------

/** 同步狀態 */
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline';

interface SyncMetaState {
    /** 本裝置的唯一識別碼 */
    deviceId: string;
    /** 同步版本號（每次成功同步 +1） */
    syncVersion: number;
    /** 最後同步時間 */
    lastSyncedAt: string | null;
    /** 是否有待同步的變更 */
    pendingSync: boolean;
    /** 目前同步狀態 */
    syncStatus: SyncStatus;
    /** 最近一次同步錯誤訊息 */
    syncError: string | null;
    /** 同步開關（使用者可在設定中關閉） */
    syncEnabled: boolean;

    // Actions
    _setDeviceId: (id: string) => void;
    _markPending: () => void;
    _setSyncing: () => void;
    _setSyncSuccess: (version: number) => void;
    _setSyncError: (msg: string) => void;
    _setSyncIdle: () => void;
    _setSyncEnabled: (v: boolean) => void;
    _clearPending: () => void;
}

export const useSyncMetaStore = create<SyncMetaState>()(
    persist(
        (set) => ({
            deviceId: '',
            syncVersion: 0,
            lastSyncedAt: null,
            pendingSync: false,
            syncStatus: 'idle' as SyncStatus,
            syncError: null,
            syncEnabled: true,

            _setDeviceId: (id) => set({ deviceId: id }),
            _markPending: () => set({ pendingSync: true }),
            _setSyncing: () => set({ syncStatus: 'syncing', syncError: null }),
            _setSyncSuccess: (version) =>
                set({
                    syncStatus: 'success',
                    syncVersion: version,
                    lastSyncedAt: new Date().toISOString(),
                    pendingSync: false,
                    syncError: null,
                }),
            _setSyncError: (msg) =>
                set({ syncStatus: 'error', syncError: msg }),
            _setSyncIdle: () => set({ syncStatus: 'idle' }),
            _setSyncEnabled: (v) => set({ syncEnabled: v }),
            _clearPending: () => set({ pendingSync: false }),
        }),
        {
            name: 'sync-meta-storage',
            storage: createJSONStorage(() => AsyncStorage),
        },
    ),
);

// ---------------------------------------------------------------------------
// 🛡️ Writeback Guard — 防止同步寫回觸發連鎖同步
// ---------------------------------------------------------------------------

/**
 * 當 performSync / pullFromCloud 將合併結果寫回 useFavoriteStore 時，
 * 此 flag 設為 true，讓 subscribe listener 知道這次 store 變更是「來自同步」，
 * 不需要再觸發新的同步，避免 已同步→同步中→已就緒 的無限循環。
 */
let _isSyncWriteback = false;

/** 安全地在同步寫回期間設定 flag，確保即使拋出例外也會重置 */
function runAsSyncWriteback(fn: () => void): void {
    _isSyncWriteback = true;
    try {
        fn();
    } finally {
        _isSyncWriteback = false;
    }
}

/** 外部查詢目前是否正在同步寫回（供 subscribe listener 使用） */
export function isSyncWriteback(): boolean {
    return _isSyncWriteback;
}

// ---------------------------------------------------------------------------
// 🔄 Core Sync Logic（非 Hook 版本，可獨立測試）
// ---------------------------------------------------------------------------

/**
 * 執行一次完整的雙向同步。
 *
 * 流程：
 *   1. 從 Google Drive 下載遠端資料
 *   2. 將本地資料與遠端資料合併
 *   3. 將合併結果上傳回 Google Drive
 *   4. 將合併結果寫回本地 Zustand Store
 *
 * @param getToken 取得有效 access token 的函式
 * @returns 同步是否成功
 */
export async function performSync(
    getToken: () => Promise<string | null>,
): Promise<boolean> {
    const syncMeta = useSyncMetaStore.getState();

    // 前置檢查
    if (!syncMeta.syncEnabled) return false;
    if (syncMeta.syncStatus === 'syncing') return false; // 防止並發同步

    // 網路連線檢查
    if (!getNetworkStatus()) {
        syncMeta._setSyncError('目前處於離線狀態，待恢復連線後自動同步。');
        syncMeta._markPending();
        // 將顯示狀態改為 offline（覆蓋 error 的視覺呈現）
        useSyncMetaStore.setState({ syncStatus: 'offline' as SyncStatus });
        return false;
    }

    const token = await getToken();
    if (!token) {
        syncMeta._setSyncError('無法取得 Google 授權，請重新登入。');
        return false;
    }

    syncMeta._setSyncing();

    try {
        // 確保 deviceId 已初始化
        let deviceId = syncMeta.deviceId;
        if (!deviceId) {
            deviceId = generateDeviceId();
            syncMeta._setDeviceId(deviceId);
        }

        // Step 1: 下載遠端資料
        const remoteState = await downloadFavorites(token);

        // Step 2: 組裝本地狀態為 SyncableFavoriteState
        const favStore = useFavoriteStore.getState();
        const localSyncables = upgradeToSyncable(favStore.favorites);
        const localState: SyncableFavoriteState = {
            favorites: localSyncables,
            queue: [...favStore.queue],
            currentDailyId: favStore.currentDailyId,
            lastUpdateDate: favStore.lastUpdateDate,
            _syncVersion: syncMeta.syncVersion,
            _lastSyncedAt: syncMeta.lastSyncedAt ?? new Date().toISOString(),
            _deviceId: deviceId,
        };

        // Step 3: 合併
        let mergedState: SyncableFavoriteState;
        if (remoteState) {
            mergedState = mergeStates(localState, remoteState);
        } else {
            // 首次同步：直接上傳本地資料
            mergedState = {
                ...localState,
                _syncVersion: localState._syncVersion + 1,
                _lastSyncedAt: new Date().toISOString(),
            };
        }

        // Step 4: 上傳合併結果到 Google Drive
        await uploadFavorites(token, mergedState);

        // Step 5: 將合併結果寫回本地 Zustand Store
        const cleanFavorites = downgradeFromSyncable(mergedState.favorites);
        const activeIds = new Set(cleanFavorites.map((f) => f.id));
        const cleanQueue = mergedState.queue.filter((id) => activeIds.has(id));
        const cleanCurrentId =
            mergedState.currentDailyId && cleanQueue.includes(mergedState.currentDailyId)
                ? mergedState.currentDailyId
                : cleanQueue[0] ?? null;

        // 使用 writeback guard 避免寫回觸發 subscribe → 再次同步
        runAsSyncWriteback(() => {
            useFavoriteStore.setState({
                favorites: cleanFavorites,
                queue: cleanQueue,
                currentDailyId: cleanCurrentId,
                lastUpdateDate: mergedState.lastUpdateDate,
            });
        });

        // Step 6: 更新同步 metadata
        syncMeta._setSyncSuccess(mergedState._syncVersion);

        return true;
    } catch (err) {
        // ── 403 特殊處理：嘗試 refresh token 後重試一次 ──
        if (err instanceof DriveApiError && err.requiresReauth) {
            console.warn(
                '[SyncOrchestrator] Drive API 403 — 嘗試重新取得 token 後重試...',
            );

            try {
                // 強制重新取得 token（useGoogleAuth 的 getValidToken 應自動 refresh）
                const freshToken = await getToken();
                if (freshToken) {
                    // 用新 token 重試下載
                    const retryRemote = await downloadFavorites(freshToken);

                    // 組裝本地資料
                    const favStoreRetry = useFavoriteStore.getState();
                    let deviceId = syncMeta.deviceId;
                    if (!deviceId) {
                        deviceId = generateDeviceId();
                        syncMeta._setDeviceId(deviceId);
                    }
                    const localSyncablesRetry = upgradeToSyncable(favStoreRetry.favorites);
                    const localStateRetry: SyncableFavoriteState = {
                        favorites: localSyncablesRetry,
                        queue: [...favStoreRetry.queue],
                        currentDailyId: favStoreRetry.currentDailyId,
                        lastUpdateDate: favStoreRetry.lastUpdateDate,
                        _syncVersion: syncMeta.syncVersion,
                        _lastSyncedAt: syncMeta.lastSyncedAt ?? new Date().toISOString(),
                        _deviceId: deviceId,
                    };

                    // 合併
                    let retryMerged: SyncableFavoriteState;
                    if (retryRemote) {
                        retryMerged = mergeStates(localStateRetry, retryRemote);
                    } else {
                        retryMerged = {
                            ...localStateRetry,
                            _syncVersion: localStateRetry._syncVersion + 1,
                            _lastSyncedAt: new Date().toISOString(),
                        };
                    }

                    // 上傳
                    await uploadFavorites(freshToken, retryMerged);

                    // 寫回本地
                    const retryClean = downgradeFromSyncable(retryMerged.favorites);
                    const retryActiveIds = new Set(retryClean.map((f) => f.id));
                    const retryQueue = retryMerged.queue.filter((id) => retryActiveIds.has(id));
                    const retryCurrentId =
                        retryMerged.currentDailyId && retryQueue.includes(retryMerged.currentDailyId)
                            ? retryMerged.currentDailyId
                            : retryQueue[0] ?? null;

                    runAsSyncWriteback(() => {
                        useFavoriteStore.setState({
                            favorites: retryClean,
                            queue: retryQueue,
                            currentDailyId: retryCurrentId,
                            lastUpdateDate: retryMerged.lastUpdateDate,
                        });
                    });

                    syncMeta._setSyncSuccess(retryMerged._syncVersion);
                    console.info('[SyncOrchestrator] 403 重試成功！');
                    return true;
                }
            } catch (retryErr) {
                console.error('[SyncOrchestrator] 403 重試失敗:', retryErr);
                // fallthrough 到下方通用錯誤處理
            }
        }

        const message =
            err instanceof DriveApiError
                ? err.requiresReauth
                    ? `Drive API 授權失敗 (${err.statusCode}): 請嘗試重新登入，` +
                      '或在 Google Cloud Console 確認 Drive API 已啟用且帳號為測試使用者。'
                    : `Drive API 錯誤 (${err.statusCode}): ${err.message}`
                : err instanceof Error
                  ? err.message
                  : '同步時發生未知錯誤';

        syncMeta._setSyncError(message);

        // 如果是 retryable 的錯誤，保留 pendingSync 標記以便之後重試
        if (err instanceof DriveApiError && err.retryable) {
            syncMeta._markPending();
        }

        return false;
    }
}

/**
 * 強制從雲端拉取資料覆蓋本地（用於「使用雲端資料」場景）。
 *
 * @param getToken 取得有效 access token 的函式
 * @returns 是否成功
 */
export async function pullFromCloud(
    getToken: () => Promise<string | null>,
): Promise<boolean> {
    const token = await getToken();
    if (!token) return false;

    const syncMeta = useSyncMetaStore.getState();
    syncMeta._setSyncing();

    try {
        const remoteState = await downloadFavorites(token);
        if (!remoteState) {
            syncMeta._setSyncError('雲端沒有找到同步資料。');
            return false;
        }

        // 直接覆蓋本地
        const cleanFavorites = downgradeFromSyncable(remoteState.favorites);
        const activeIds = new Set(cleanFavorites.map((f) => f.id));
        const cleanQueue = remoteState.queue.filter((id: string) => activeIds.has(id));

        // 使用 writeback guard 避免寫回觸發 subscribe → 再次同步
        runAsSyncWriteback(() => {
            useFavoriteStore.setState({
                favorites: cleanFavorites,
                queue: cleanQueue,
                currentDailyId:
                    remoteState.currentDailyId && cleanQueue.includes(remoteState.currentDailyId)
                        ? remoteState.currentDailyId
                        : cleanQueue[0] ?? null,
                lastUpdateDate: remoteState.lastUpdateDate,
            });
        });

        syncMeta._setSyncSuccess(remoteState._syncVersion);
        return true;
    } catch (err) {
        const message = err instanceof Error ? err.message : '拉取雲端資料失敗';
        syncMeta._setSyncError(message);
        return false;
    }
}

// ---------------------------------------------------------------------------
// 🎣 useSyncOrchestrator — React Hook 版同步排程器
// ---------------------------------------------------------------------------

/** Debounce 延遲（毫秒） */
const SYNC_DEBOUNCE_MS = 2000;

/** 同步成功後回到 idle 的延遲 */
const SUCCESS_RESET_MS = 3000;

/**
 * 同步排程器 Hook。
 *
 * 負責：
 *   1. 監聽 useFavoriteStore 變化，debounce 後觸發同步
 *   2. 監聽 AppState 變化，App 回到前景時觸發同步
 *   3. 提供手動同步方法
 *
 * 使用方式：在 App 根佈局（_layout.tsx）中呼叫一次即可。
 *
 * @param getToken 取得有效 access token 的函式
 */
export function useSyncOrchestrator(
    getToken: () => Promise<string | null>,
) {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const successResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isSignedIn = useGoogleAuthStore((s) => s.isSignedIn);
    const syncStatus = useSyncMetaStore((s) => s.syncStatus);
    const syncEnabled = useSyncMetaStore((s) => s.syncEnabled);

    // ── 手動觸發同步 ──
    const triggerSync = useCallback(async () => {
        if (!isSignedIn || !syncEnabled) return;
        const success = await performSync(getToken);

        if (success) {
            // 3 秒後將狀態從 'success' 重置為 'idle'
            if (successResetRef.current) clearTimeout(successResetRef.current);
            successResetRef.current = setTimeout(() => {
                useSyncMetaStore.getState()._setSyncIdle();
            }, SUCCESS_RESET_MS);
        }
    }, [isSignedIn, syncEnabled, getToken]);

    // ── 監聽 FavoriteStore 變化 → debounce 同步 ──
    useEffect(() => {
        if (!isSignedIn || !syncEnabled) return;

        const unsubscribe = useFavoriteStore.subscribe(() => {
            // 🛡️ 如果是同步寫回觸發的變更，不再重新同步
            if (isSyncWriteback()) return;

            // 標記待同步
            useSyncMetaStore.getState()._markPending();

            // 重設 debounce 計時器
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                triggerSync();
            }, SYNC_DEBOUNCE_MS);
        });

        return () => {
            unsubscribe();
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [isSignedIn, syncEnabled, triggerSync]);

    // ── 監聽 App 回到前景 → 觸發同步 ──
    useEffect(() => {
        if (!isSignedIn || !syncEnabled) return;

        let previousState: AppStateStatus = AppState.currentState;

        const subscription = AppState.addEventListener(
            'change',
            (nextState: AppStateStatus) => {
                // 從背景 → 前景
                if (
                    previousState.match(/inactive|background/) &&
                    nextState === 'active'
                ) {
                    triggerSync();
                }
                previousState = nextState;
            },
        );

        return () => subscription.remove();
    }, [isSignedIn, syncEnabled, triggerSync]);

    // ── 監聽網路恢復 → 消化 pendingSync ──
    const isConnected = useNetworkStore((s) => s.isConnected);
    const prevConnectedRef = useRef(isConnected);
    useEffect(() => {
        if (
            isConnected &&
            !prevConnectedRef.current &&
            isSignedIn &&
            syncEnabled
        ) {
            // 從離線恢復為在線，且有待同步資料
            const pending = useSyncMetaStore.getState().pendingSync;
            if (pending) {
                triggerSync();
            }
        }
        prevConnectedRef.current = isConnected;
    }, [isConnected, isSignedIn, syncEnabled, triggerSync]);

    // ── 首次登入時立即同步一次 ──
    const prevSignedInRef = useRef(isSignedIn);
    useEffect(() => {
        if (isSignedIn && !prevSignedInRef.current && syncEnabled) {
            // 剛從未登入 → 已登入
            triggerSync();
        }
        prevSignedInRef.current = isSignedIn;
    }, [isSignedIn, syncEnabled, triggerSync]);

    // ── Cleanup ──
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (successResetRef.current) clearTimeout(successResetRef.current);
        };
    }, []);

    return {
        /** 目前同步狀態 */
        syncStatus,
        /** 手動觸發一次同步 */
        triggerSync,
        /** 強制從雲端拉取覆蓋本地 */
        pullFromCloud: useCallback(
            () => pullFromCloud(getToken),
            [getToken],
        ),
    };
}
