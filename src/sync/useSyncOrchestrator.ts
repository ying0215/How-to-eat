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
//   - App 從背景回到前景（若有 pendingSync）
//   - 手動觸發「立即同步」
//   - 網路從離線恢復為在線（若有 pendingSync）
//   - 首次登入 Google 帳號
//
// 注意：使用者操作（新增/刪除/修改）僅標記 pendingSync，
//       不會即時觸發同步，降低 API 呼叫與電量消耗。
// ============================================================================

import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGoogleAuthStore } from '../auth/useGoogleAuth';
import { downloadFavorites, uploadFavorites, DriveApiError, validateTokenScopes } from './GoogleDriveAdapter';
import {
    mergeStates,
    upgradeToSyncable,
    upgradeGroupsToSyncable,
    downgradeFromSyncable,
    downgradeGroupsFromSyncable,
    generateDeviceId,
    createEmptySyncState,
    type SyncableFavoriteState,
    type SyncableFavorite,
    type SyncableGroup,
} from './mergeStrategy';
import { useFavoriteStore, type FavoriteRestaurant, type DeletedItemRecord } from '../store/useFavoriteStore';
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
// 🔧 工具函式：組裝本地狀態為同步格式
// ---------------------------------------------------------------------------

/**
 * 從 useFavoriteStore 和 syncMeta 組裝出 SyncableFavoriteState，
 * 供 performSync/pullFromCloud 使用（避免重複程式碼）。
 *
 * 🔑 Tombstone 策略：
 *   store 中的 deleteGroup/removeFavorite 使用硬刪除（直接移除），
 *   但會把已刪除的 ID 和時間戳記錄在 _deletedGroupIds / _deletedFavoriteIds 中。
 *   此函式在組裝同步狀態時，為這些記錄產生 tombstone（isDeleted: true），
 *   使用實際的刪除時間作為 updatedAt，確保 mergeStates 能正確傳播刪除操作到雲端。
 */
function assembleLocalState(deviceId: string, syncVersion: number, lastSyncedAt: string | null): SyncableFavoriteState {
    const favStore = useFavoriteStore.getState();
    const now = new Date().toISOString();

    // 現存的 favorites → isDeleted: false
    const liveFavorites = upgradeToSyncable(favStore.favorites);

    // 已硬刪除的 favorites → tombstone（isDeleted: true），使用實際刪除時間
    const deletedFavRecords: DeletedItemRecord[] = favStore._deletedFavoriteIds ?? [];
    const deletedFavTombstones: SyncableFavorite[] = deletedFavRecords.map((record) => ({
        id: record.id,
        name: '',
        groupId: '',
        createdAt: record.deletedAt,
        updatedAt: record.deletedAt, // 使用實際刪除時間，非同步當下時間
        isDeleted: true,
    }));

    // 現存的 groups → isDeleted: false
    const liveGroups = upgradeGroupsToSyncable(favStore.groups);

    // 已硬刪除的 groups → tombstone（isDeleted: true），使用實際刪除時間
    const deletedGroupRecords: DeletedItemRecord[] = favStore._deletedGroupIds ?? [];
    const deletedGroupTombstones: SyncableGroup[] = deletedGroupRecords.map((record) => ({
        id: record.id,
        name: '',
        createdAt: record.deletedAt,
        updatedAt: record.deletedAt, // 使用實際刪除時間，非同步當下時間
        isDeleted: true,
    }));

    return {
        favorites: [...liveFavorites, ...deletedFavTombstones],
        groups: [...liveGroups, ...deletedGroupTombstones],
        activeGroupId: favStore.activeGroupId,
        groupQueues: { ...favStore.groupQueues },
        groupCurrentDailyIds: { ...favStore.groupCurrentDailyIds },
        lastUpdateDate: favStore.lastUpdateDate,
        _syncVersion: syncVersion,
        _lastSyncedAt: lastSyncedAt ?? new Date().toISOString(),
        _deviceId: deviceId,
    };
}

/**
 * 將合併後的同步狀態寫回本地 useFavoriteStore。
 * 自動清理 tombstone / 孤兒 queue ID。
 *
 * 🔑 增量合併策略（Bug 3 修復）：
 *   同步過程（下載 → 合併 → 上傳）可能耗時數秒。在此期間使用者
 *   可能已經建立新群組或刪除其他項目。為避免覆蓋這些並行操作：
 *   1. 只移除「本次同步已處理」的已刪除記錄，保留同步期間新增的
 *   2. 將同步期間新增的 groups/favorites 與合併結果做 union
 *
 * @param mergedState 合併後的同步狀態
 * @param syncedDeletedGroupIds 本次同步已處理的群組刪除記錄（快照）
 * @param syncedDeletedFavIds 本次同步已處理的餐廳刪除記錄（快照）
 * @param options.forceOverwrite 若為 true，跳過增量合併並完全覆蓋本地狀態（用於 pullFromCloud）
 */
function writebackMergedState(
    mergedState: SyncableFavoriteState,
    syncedDeletedGroupIds?: DeletedItemRecord[],
    syncedDeletedFavIds?: DeletedItemRecord[],
    options?: { forceOverwrite?: boolean },
): void {
    const cleanFavorites = downgradeFromSyncable(mergedState.favorites);
    const cleanGroups = downgradeGroupsFromSyncable(mergedState.groups ?? []);
    const activeIds = new Set(cleanFavorites.map((f) => f.id));

    // 清理每個群組的 queue 和 currentDailyId
    const cleanGroupQueues: Record<string, string[]> = {};
    const cleanGroupCurrentDailyIds: Record<string, string | null> = {};

    for (const group of cleanGroups) {
        const gid = group.id;
        const queue = (mergedState.groupQueues?.[gid] ?? []).filter((id) => activeIds.has(id));
        cleanGroupQueues[gid] = queue;

        const currentId = mergedState.groupCurrentDailyIds?.[gid] ?? null;
        cleanGroupCurrentDailyIds[gid] = currentId && queue.includes(currentId)
            ? currentId
            : (queue[0] ?? null);
    }

    // 確保 activeGroupId 合法
    const activeGroupIds = new Set(cleanGroups.map((g) => g.id));
    const cleanActiveGroupId = activeGroupIds.has(mergedState.activeGroupId)
        ? mergedState.activeGroupId
        : (cleanGroups[0]?.id ?? '');

    runAsSyncWriteback(() => {
        const forceOverwrite = options?.forceOverwrite ?? false;

        if (forceOverwrite) {
            // 強制覆蓋模式：完全用合併結果替換本地狀態，清空所有待處理刪除記錄
            useFavoriteStore.setState({
                favorites: cleanFavorites,
                groups: cleanGroups,
                activeGroupId: cleanActiveGroupId,
                groupQueues: cleanGroupQueues,
                groupCurrentDailyIds: cleanGroupCurrentDailyIds,
                lastUpdateDate: mergedState.lastUpdateDate,
                _deletedGroupIds: [],
                _deletedFavoriteIds: [],
            });
            return;
        }

        // ── 增量合併模式：保留同步期間的並行操作 ──
        // 重新讀取 store 的最新狀態，偵測同步期間的並行操作
        const currentStore = useFavoriteStore.getState();

        // ── 建立合併結果中的 tombstone ID 集合 ──
        // 這些項目被合併邏輯判定為「已刪除」（來自遠端或本地 tombstone）
        // 不應再被當作「同步期間新建」而重新加回
        const tombstonedGroupIds = new Set(
            (mergedState.groups ?? []).filter((g) => g.isDeleted).map((g) => g.id),
        );
        const tombstonedFavIds = new Set(
            mergedState.favorites.filter((f) => f.isDeleted).map((f) => f.id),
        );

        // ── 增量清理已刪除記錄 ──
        // 只移除「本次同步已處理」的已刪除記錄，保留同步期間新增的刪除
        const syncedGroupIdSet = new Set((syncedDeletedGroupIds ?? []).map((r) => r.id));
        const syncedFavIdSet = new Set((syncedDeletedFavIds ?? []).map((r) => r.id));
        const remainingDeletedGroups = (currentStore._deletedGroupIds ?? []).filter(
            (r) => !syncedGroupIdSet.has(r.id),
        );
        const remainingDeletedFavs = (currentStore._deletedFavoriteIds ?? []).filter(
            (r) => !syncedFavIdSet.has(r.id),
        );

        // ── 合併同步期間新增的 groups ──
        // 找出 currentStore 中存在但 cleanGroups 中不存在的群組（同步期間新建的）
        // 但排除被合併結果標記為已刪除的（tombstone），避免復活已刪除的群組
        const mergedGroupIds = new Set(cleanGroups.map((g) => g.id));
        const concurrentNewGroups = currentStore.groups.filter(
            (g) => !mergedGroupIds.has(g.id) && !tombstonedGroupIds.has(g.id),
        );
        const finalGroups = [...cleanGroups, ...concurrentNewGroups];

        // ── 合併同步期間新增的 favorites ──
        // 同理排除被 tombstone 標記的項目
        const mergedFavIds = new Set(cleanFavorites.map((f) => f.id));
        const concurrentNewFavs = currentStore.favorites.filter(
            (f) => !mergedFavIds.has(f.id) && !tombstonedFavIds.has(f.id),
        );
        const finalFavorites = [...cleanFavorites, ...concurrentNewFavs];

        // ── 合併同步期間新增群組的 queue/currentDailyId ──
        const finalGroupQueues = { ...cleanGroupQueues };
        const finalGroupCurrentDailyIds = { ...cleanGroupCurrentDailyIds };
        for (const g of concurrentNewGroups) {
            if (!(g.id in finalGroupQueues)) {
                finalGroupQueues[g.id] = currentStore.groupQueues[g.id] ?? [];
                finalGroupCurrentDailyIds[g.id] = currentStore.groupCurrentDailyIds[g.id] ?? null;
            }
        }

        // 確保 activeGroupId 仍合法（含新增的群組）
        const allGroupIds = new Set(finalGroups.map((g) => g.id));
        const finalActiveGroupId = allGroupIds.has(cleanActiveGroupId)
            ? cleanActiveGroupId
            : (allGroupIds.has(currentStore.activeGroupId)
                ? currentStore.activeGroupId
                : (finalGroups[0]?.id ?? ''));

        useFavoriteStore.setState({
            favorites: finalFavorites,
            groups: finalGroups,
            activeGroupId: finalActiveGroupId,
            groupQueues: finalGroupQueues,
            groupCurrentDailyIds: finalGroupCurrentDailyIds,
            lastUpdateDate: mergedState.lastUpdateDate,
            // 增量清理：只移除已同步的，保留同步期間新增的
            _deletedGroupIds: remainingDeletedGroups,
            _deletedFavoriteIds: remainingDeletedFavs,
        });
    });
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

    // 前置檢查（同步鏈路）
    if (!syncMeta.syncEnabled) return false;
    if (syncMeta.syncStatus === 'syncing') return false; // 防止並發同步

    // 網路連線檢查（同步，不需要設定 syncing）
    if (!getNetworkStatus()) {
        syncMeta._setSyncError('目前處於離線狀態，待恢復連線後自動同步。');
        syncMeta._markPending();
        // 將顯示狀態改為 offline（覆蓋 error 的視覺呈現）
        useSyncMetaStore.setState({ syncStatus: 'offline' as SyncStatus });
        return false;
    }

    // 🔒 立即設定 syncing 狀態，關閉並發競爭窗口
    // 必須在 await getToken() 之前設定，否則兩個同時觸發的 performSync()
    // 都能通過上方的 'syncing' 檢查，導致重複請求觸發限流保護。
    syncMeta._setSyncing();

    const token = await getToken();
    if (!token) {
        // getToken 失敗時，_setSyncError 會將 syncStatus 從 'syncing' 改為 'error'
        syncMeta._setSyncError('無法取得 Google 授權，請重新登入。');
        return false;
    }

    try {
        // 確保 deviceId 已初始化
        let deviceId = syncMeta.deviceId;
        if (!deviceId) {
            deviceId = generateDeviceId();
            syncMeta._setDeviceId(deviceId);
        }

        // 📸 快照當前的已刪除記錄（同步開始前）
        // writeback 時只清除這些已處理的記錄，保留同步期間新增的
        const favStoreSnapshot = useFavoriteStore.getState();
        const syncedDeletedGroupIds: DeletedItemRecord[] = [...(favStoreSnapshot._deletedGroupIds ?? [])];
        const syncedDeletedFavIds: DeletedItemRecord[] = [...(favStoreSnapshot._deletedFavoriteIds ?? [])];

        // Step 1: 下載遠端資料
        const remoteState = await downloadFavorites(token);

        // Step 2: 組裝本地狀態為 SyncableFavoriteState
        const localState = assembleLocalState(deviceId, syncMeta.syncVersion, syncMeta.lastSyncedAt);

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

        // Step 5: 將合併結果寫回本地 Zustand Store（增量合併，保留並行操作）
        writebackMergedState(mergedState, syncedDeletedGroupIds, syncedDeletedFavIds);

        // Step 6: 更新同步 metadata
        syncMeta._setSyncSuccess(mergedState._syncVersion);

        return true;
    } catch (err) {
        // ── 403 特殊處理：診斷 token scope + 嘗試 refresh token 後重試一次 ──
        if (err instanceof DriveApiError && err.requiresReauth) {
            console.warn(
                '[SyncOrchestrator] Drive API 403 — 開始診斷 token scope...',
            );

            try {
                // Step A: 診斷當前 token 的 scope
                const currentToken = await getToken();
                if (currentToken) {
                    const scopeCheck = await validateTokenScopes(currentToken);

                    if (!scopeCheck.valid) {
                        // ── Token 缺少 drive.appdata scope ──
                        const scopeDiagMsg = scopeCheck.error
                            ? `Token 驗證失敗: ${scopeCheck.error}`
                            : `Token 缺少 drive.appdata scope（現有: ${scopeCheck.scopes.join(', ')}）`;

                        console.error(
                            '[SyncOrchestrator] 🔴 403 根因確認：Token scope 不足',
                            '\n ', scopeDiagMsg,
                            '\n  解決步驟:',
                            '\n    1. 檢查 Google Cloud Console → OAuth consent screen → Scopes 是否包含 drive.appdata',
                            '\n    2. 在 App 中登出 Google 帳號',
                            '\n    3. 重新登入以取得含 drive.appdata 權限的新 token',
                        );

                        syncMeta._setSyncError(
                            '同步授權不足：Token 缺少 drive.appdata 權限。' +
                            '請先登出再重新登入 Google 帳號。' +
                            '如問題持續，請到 Google Cloud Console 確認 OAuth 同意畫面已加入 drive.appdata scope。',
                        );
                        return false;
                    }

                    // ── Token 有 scope 但仍 403 ──
                    console.warn(
                        '[SyncOrchestrator] ⚠️ Token 擁有 drive.appdata scope 但仍收到 403。',
                        '\n  可能原因:',
                        '\n    1. Google Cloud Console 的 Google Drive API 未啟用',
                        '\n    2. OAuth 同意畫面為 Testing 模式，但帳號未加入 Test users',
                        '\n    3. Google 端授權可能有延遲，請稍後再試',
                        '\n  嘗試用新 token 重試...',
                    );

                    // Step B: 重試一次（重新組裝＋合併＋上傳＋寫回）
                    const retryRemote = await downloadFavorites(currentToken);
                    let deviceIdRetry = syncMeta.deviceId;
                    if (!deviceIdRetry) {
                        deviceIdRetry = generateDeviceId();
                        syncMeta._setDeviceId(deviceIdRetry);
                    }

                    // 重新快照已刪除記錄
                    const retryFavStore = useFavoriteStore.getState();
                    const retrySyncedDeletedGroupIds: DeletedItemRecord[] = [...(retryFavStore._deletedGroupIds ?? [])];
                    const retrySyncedDeletedFavIds: DeletedItemRecord[] = [...(retryFavStore._deletedFavoriteIds ?? [])];

                    const localStateRetry = assembleLocalState(deviceIdRetry, syncMeta.syncVersion, syncMeta.lastSyncedAt);

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

                    await uploadFavorites(currentToken, retryMerged);
                    writebackMergedState(retryMerged, retrySyncedDeletedGroupIds, retrySyncedDeletedFavIds);
                    syncMeta._setSyncSuccess(retryMerged._syncVersion);
                    console.info('[SyncOrchestrator] ✅ 403 重試成功！');
                    return true;
                }
            } catch (retryErr) {
                console.error('[SyncOrchestrator] 403 診斷/重試流程失敗:', retryErr);
                // fallthrough 到下方通用錯誤處理
            }
        }

        const message =
            err instanceof DriveApiError
                ? err.requiresReauth
                    ? `Drive API 授權失敗 (${err.statusCode}): 請嘗試登出後重新登入。` +
                      '若問題持續，請在 Google Cloud Console 確認：' +
                      '(1) Drive API 已啟用 ' +
                      '(2) OAuth 同意畫面 Scopes 包含 drive.appdata ' +
                      '(3) 帳號已加入 Test users（若為 Testing 模式）。'
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

        // 強制覆蓋本地：將所有待處理的刪除記錄標記為「已同步」以便清空
        const currentStore = useFavoriteStore.getState();
        writebackMergedState(
            remoteState,
            currentStore._deletedGroupIds ?? [],
            currentStore._deletedFavoriteIds ?? [],
            { forceOverwrite: true },
        );
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



/** 同步成功後回到 idle 的延遲 */
const SUCCESS_RESET_MS = 3000;

/**
 * 同步排程器 Hook。
 *
 * 負責：
 *   1. 監聽 useFavoriteStore 變化，標記 pendingSync（不即時同步）
 *   2. 監聽 AppState 變化，App 回到前景時觸發同步
 *   3. 監聽網路恢復，若有 pendingSync 自動同步
 *   4. 提供手動同步方法（立即同步）
 *
 * 使用方式：在 App 根佈局（_layout.tsx）中呼叫一次即可。
 *
 * @param getToken 取得有效 access token 的函式
 */
export function useSyncOrchestrator(
    getToken: () => Promise<string | null>,
) {

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

    // ── 監聽 FavoriteStore 變化 → 僅標記待同步（不即時觸發） ──
    // 同步延遲到下次 App 回到前景、手動觸發、網路恢復或首次登入時執行
    useEffect(() => {
        if (!isSignedIn || !syncEnabled) return;

        const unsubscribe = useFavoriteStore.subscribe(() => {
            // 🛡️ 如果是同步寫回觸發的變更，不再標記
            if (isSyncWriteback()) return;

            // 標記待同步（實際同步延遲到下次 App 啟動 / 手動觸發）
            useSyncMetaStore.getState()._markPending();
        });

        return () => {
            unsubscribe();
        };
    }, [isSignedIn, syncEnabled]);

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
    // 🔧 isInitialMountRef 區分「真正的首次登入」與「App 重啟 token 恢復」
    //    App 重啟時 useGoogleAuth 會用 SecureStore 中的 refresh token 恢復 isSignedIn，
    //    此時 isSignedIn 從 false → true，但這不是使用者主動登入，不應觸發立即同步。
    //    同步會在使用者下次切換 App（AppState → active）或手動觸發時自然發生。
    const isInitialMountRef = useRef(true);
    const prevSignedInRef = useRef(isSignedIn);
    useEffect(() => {
        if (isInitialMountRef.current) {
            // 首次掛載：記錄初始狀態，不觸發同步
            isInitialMountRef.current = false;
            prevSignedInRef.current = isSignedIn;
            return;
        }
        if (isSignedIn && !prevSignedInRef.current && syncEnabled) {
            // 剛從未登入 → 已登入（使用者主動登入）
            triggerSync();
        }
        prevSignedInRef.current = isSignedIn;
    }, [isSignedIn, syncEnabled, triggerSync]);

    // ── Cleanup ──
    useEffect(() => {
        return () => {
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
