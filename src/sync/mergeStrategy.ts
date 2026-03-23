// ============================================================================
// 📁 mergeStrategy.ts — 多裝置資料合併策略
// ============================================================================
//
// 🎯 核心問題：
//    當使用者在裝置 A 和裝置 B 同時修改最愛清單時，如何合併兩份資料？
//
// 🧠 採用策略：LWW (Last-Write-Wins) Per-Item Merge
//    - 對每個餐廳（by id）獨立比較 updatedAt 時間戳
//    - 較新的修改獲勝
//    - 新增的項目自動合併
//    - 刪除操作透過 tombstone（刪除標記）傳播
//    - 群組合併：per-group LWW，群組內的 queue 和 currentDailyId 各自合併
//
// 📖 為什麼不用 CRDT？
//    CRDT（Conflict-free Replicated Data Types）是更強大的合併演算法，
//    但對於「最愛餐廳清單」這種低衝突場景來說過度設計（over-engineering）。
//    LWW per-item 已足夠處理 99.9% 的使用情境。
// ============================================================================

import type { FavoriteRestaurant, FavoriteGroup } from '../store/useFavoriteStore';

// ---------------------------------------------------------------------------
// 📦 同步用的資料結構（擴展原有 FavoriteRestaurant）
// ---------------------------------------------------------------------------

/**
 * 可同步的餐廳資料（在原有欄位上加入同步 metadata）。
 *
 * updatedAt 是 LWW 合併的關鍵欄位——取時間較新的那筆資料。
 * isDeleted 是 tombstone 標記——用於跨裝置傳播刪除操作。
 */
export interface SyncableFavorite extends FavoriteRestaurant {
    /** 最後修改時間（ISO 8601 字串），用於 LWW 比較 */
    updatedAt: string;
    /** 軟刪除標記（tombstone），true 表示已在某裝置上被刪除 */
    isDeleted?: boolean;
}

/**
 * 可同步的群組資料（含軟刪除標記）。
 */
export interface SyncableGroup extends FavoriteGroup {
    /** 軟刪除標記 */
    isDeleted?: boolean;
}

/**
 * 可同步的完整最愛餐廳狀態。
 *
 * 這是寫入 Google Drive appDataFolder 的 JSON 結構：
 *
 * ```json
 * {
 *   "favorites": [{ id, name, note, groupId, createdAt, updatedAt, isDeleted? }],
 *   "groups": [{ id, name, createdAt, updatedAt, isDeleted? }],
 *   "activeGroupId": "group-abc",
 *   "groupQueues": { "group-abc": ["id1","id2"], "group-xyz": [...] },
 *   "groupCurrentDailyIds": { "group-abc": "id1", "group-xyz": null },
 *   "lastUpdateDate": "2025-03-13",
 *   "_syncVersion": 42,
 *   "_lastSyncedAt": "2025-03-13T14:00:00.000Z",
 *   "_deviceId": "device-abc123"
 * }
 * ```
 */
export interface SyncableFavoriteState {
    favorites: SyncableFavorite[];
    groups: SyncableGroup[];
    activeGroupId: string;
    /** 每個群組獨立的輪替佇列 */
    groupQueues: Record<string, string[]>;
    /** 每個群組獨立的今日推薦 */
    groupCurrentDailyIds: Record<string, string | null>;
    lastUpdateDate: string;

    // ── 向後相容（舊版資料可能包含這些欄位） ──
    /** @deprecated 使用 groupQueues 替代 */
    queue?: string[];
    /** @deprecated 使用 groupCurrentDailyIds 替代 */
    currentDailyId?: string | null;

    /** 單調遞增的版本號，每次同步 +1 */
    _syncVersion: number;
    /** 最後一次成功同步的時間（ISO 8601） */
    _lastSyncedAt: string;
    /** 產生此資料的裝置識別碼 */
    _deviceId: string;
}

// ---------------------------------------------------------------------------
// 🔀 合併邏輯
// ---------------------------------------------------------------------------

/** Tombstone 保留期限（7 天），超過此期限的 tombstone 會被清除 */
const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 合併本地與遠端的最愛餐廳資料。
 *
 * 合併規則（按優先順序）：
 *
 * | 場景 | 本地 | 遠端 | 結果 |
 * |------|------|------|------|
 * | 1 | 新增 | 不存在 | 保留本地 |
 * | 2 | 不存在 | 新增 | 保留遠端 |
 * | 3 | 修改 | 修改 | 取 updatedAt 較新者 |
 * | 4 | 修改 | 刪除 | 取 updatedAt 較新者（可能保留或刪除） |
 * | 5 | 刪除 | 修改 | 取 updatedAt 較新者（可能保留或刪除） |
 * | 6 | 刪除 | 刪除 | 保留 tombstone（稍後清理） |
 *
 * 群組合併：同 per-item LWW 策略
 * Queue/CurrentDailyId：per-group 各自合併
 *
 * @param local 本地狀態
 * @param remote 遠端狀態（從 Google Drive 下載的）
 * @returns 合併後的新狀態
 */
export function mergeStates(
    local: SyncableFavoriteState,
    remote: SyncableFavoriteState,
): SyncableFavoriteState {
    const now = new Date().toISOString();

    // ── 0. 向後相容（舊版雲端資料遷移） ──
    // 如果遠端資料為舊版（無 groups），將其暫時掛載至本地的活躍群組，以便能與本地資料正確合併
    let remoteToMerge = remote;
    const isLegacyRemote = !remote.groups || remote.groups.length === 0;

    if (isLegacyRemote && Array.isArray(remote.favorites)) {
        // 優先使用本地目前的 activeGroupId，若無則使用 local.groups[0]
        let targetGroupId = local.activeGroupId;
        if (!targetGroupId && local.groups && local.groups.length > 0) {
            targetGroupId = local.groups[0].id;
        }

        if (targetGroupId) {
            console.info(`[mergeStrategy] 偵測到舊版遠端資料，將記錄遷移至本地群組: ${targetGroupId}`);
            const migratedFavorites = remote.favorites.map((f) => ({
                ...f,
                groupId: f.groupId ?? targetGroupId,
            }));

            const migratedQueues = { ...(remote.groupQueues ?? {}) };
            if (remote.queue && Array.isArray(remote.queue)) {
                migratedQueues[targetGroupId] = remote.queue;
            }

            const migratedCurrentIds = { ...(remote.groupCurrentDailyIds ?? {}) };
            if (remote.currentDailyId !== undefined) {
                migratedCurrentIds[targetGroupId] = remote.currentDailyId;
            }

            remoteToMerge = {
                ...remote,
                favorites: migratedFavorites,
                groups: [], // 遠端無 group 資訊，空陣列讓 LWW 保留本地 group
                groupQueues: migratedQueues,
                groupCurrentDailyIds: migratedCurrentIds,
            };
        }
    }

    // 後續邏輯使用 remoteToMerge
    const actualRemote = remoteToMerge;

    // ── 1. 合併 Favorites（per-item LWW） ──
    const allFavIds = new Set<string>([
        ...local.favorites.map((f) => f.id),
        ...actualRemote.favorites.map((f) => f.id),
    ]);

    const mergedFavorites: SyncableFavorite[] = [];
    const cutoffTime = Date.now() - TOMBSTONE_TTL_MS;

    for (const id of allFavIds) {
        const localItem = local.favorites.find((f) => f.id === id);
        const remoteItem = actualRemote.favorites.find((f) => f.id === id);

        let winner: SyncableFavorite;
        if (localItem && !remoteItem) {
            winner = localItem;
        } else if (!localItem && remoteItem) {
            winner = remoteItem;
        } else if (localItem && remoteItem) {
            const localTime = new Date(localItem.updatedAt).getTime();
            const remoteTime = new Date(remoteItem.updatedAt).getTime();
            winner = localTime >= remoteTime ? localItem : remoteItem;
        } else {
            continue; // 理論上不會到這裡
        }

        // 清理過期 tombstone
        if (winner.isDeleted && new Date(winner.updatedAt).getTime() <= cutoffTime) {
            continue; // 永久移除
        }

        mergedFavorites.push(winner);
    }

    // ── 2. 合併 Groups（per-item LWW） ──
    const localGroups = local.groups ?? [];
    const remoteGroups = actualRemote.groups ?? [];
    const allGroupIds = new Set<string>([
        ...localGroups.map((g) => g.id),
        ...remoteGroups.map((g) => g.id),
    ]);

    const mergedGroups: SyncableGroup[] = [];
    for (const gid of allGroupIds) {
        const localGroup = localGroups.find((g) => g.id === gid);
        const remoteGroup = remoteGroups.find((g) => g.id === gid);

        let winner: SyncableGroup;
        if (localGroup && !remoteGroup) {
            winner = localGroup;
        } else if (!localGroup && remoteGroup) {
            winner = remoteGroup;
        } else if (localGroup && remoteGroup) {
            const lt = new Date(localGroup.updatedAt).getTime();
            const rt = new Date(remoteGroup.updatedAt).getTime();
            winner = lt >= rt ? localGroup : remoteGroup;
        } else {
            continue;
        }

        // 清理過期 tombstone
        if (winner.isDeleted && new Date(winner.updatedAt).getTime() <= cutoffTime) {
            continue;
        }

        mergedGroups.push(winner);
    }

    // 只保留活躍的群組和餐廳
    const activeGroupIds = new Set(
        mergedGroups.filter((g) => !g.isDeleted).map((g) => g.id),
    );
    const activeFavIds = new Set(
        mergedFavorites.filter((f) => !f.isDeleted && activeGroupIds.has(f.groupId)).map((f) => f.id),
    );

    // ── 3. 合併 groupQueues（per-group） ──
    const localQueues = local.groupQueues ?? {};
    const remoteQueues = actualRemote.groupQueues ?? {};
    const mergedGroupQueues: Record<string, string[]> = {};

    for (const gid of activeGroupIds) {
        const localQ = localQueues[gid] ?? [];
        const remoteQ = remoteQueues[gid] ?? [];

        // 以 syncVersion 較高者的 queue 為基準
        const baseQ = local._syncVersion >= actualRemote._syncVersion ? localQ : remoteQ;

        // 保留 baseQueue 中仍存活的 ID，再加入基準中不存在的新 ID
        const groupActiveFavIds = new Set(
            mergedFavorites
                .filter((f) => !f.isDeleted && f.groupId === gid)
                .map((f) => f.id),
        );

        const q = [
            ...baseQ.filter((id) => groupActiveFavIds.has(id)),
            ...[...groupActiveFavIds].filter((id) => !baseQ.includes(id)),
        ];
        mergedGroupQueues[gid] = q;
    }

    // ── 4. 合併 groupCurrentDailyIds（per-group） ──
    const localCurrentIds = local.groupCurrentDailyIds ?? {};
    const remoteCurrentIds = actualRemote.groupCurrentDailyIds ?? {};
    const mergedGroupCurrentDailyIds: Record<string, string | null> = {};

    for (const gid of activeGroupIds) {
        const q = mergedGroupQueues[gid] ?? [];
        const baseCurrent = local._syncVersion >= actualRemote._syncVersion
            ? (localCurrentIds[gid] ?? null)
            : (remoteCurrentIds[gid] ?? null);
        mergedGroupCurrentDailyIds[gid] = baseCurrent && q.includes(baseCurrent)
            ? baseCurrent
            : (q[0] ?? null);
    }

    // ── 5. activeGroupId：以本地為準（使用者目前正在操作的裝置） ──
    let mergedActiveGroupId = local.activeGroupId;
    if (!activeGroupIds.has(mergedActiveGroupId)) {
        // 本地 activeGroupId 對應的群組已被刪除 → fallback
        mergedActiveGroupId = [...activeGroupIds][0] ?? '';
    }

    // ── 6. lastUpdateDate：取較新的日期 ──
    const mergedLastUpdateDate =
        local.lastUpdateDate > actualRemote.lastUpdateDate
            ? local.lastUpdateDate
            : actualRemote.lastUpdateDate;

    return {
        favorites: mergedFavorites,
        groups: mergedGroups,
        activeGroupId: mergedActiveGroupId,
        groupQueues: mergedGroupQueues,
        groupCurrentDailyIds: mergedGroupCurrentDailyIds,
        lastUpdateDate: mergedLastUpdateDate,
        _syncVersion: Math.max(local._syncVersion, actualRemote._syncVersion) + 1,
        _lastSyncedAt: now,
        _deviceId: local._deviceId, // 合併操作由本地裝置發起
    };
}

// ---------------------------------------------------------------------------
// 🔄 格式轉換工具
// ---------------------------------------------------------------------------

/**
 * 產生唯一的裝置識別碼。
 *
 * 用於追蹤哪個裝置做了最後的修改。
 * 在每個裝置上首次安裝時生成，之後持久儲存。
 */
export function generateDeviceId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    const platform =
        typeof navigator !== 'undefined' && navigator.userAgent
            ? navigator.userAgent.slice(0, 8).replace(/[^a-zA-Z0-9]/g, '')
            : 'native';
    return `${platform}-${timestamp}-${random}`;
}

/**
 * 將現有的 FavoriteRestaurant[] 轉換為 SyncableFavorite[]。
 *
 * 在首次啟用同步功能時，需要將既有的本地資料升級為可同步格式：
 *   - 確保 updatedAt 有值（使用 createdAt 作為 fallback）
 *   - 為每個餐廳加上 isDeleted: false
 *
 * @param favorites 原始餐廳清單
 * @returns 可同步格式的餐廳清單
 */
export function upgradeToSyncable(
    favorites: FavoriteRestaurant[],
): SyncableFavorite[] {
    return favorites.map((f) => ({
        ...f,
        updatedAt: f.updatedAt ?? f.createdAt, // updatedAt 可能已存在
        isDeleted: false,
    }));
}

/**
 * 將 FavoriteGroup[] 轉換為 SyncableGroup[]。
 */
export function upgradeGroupsToSyncable(
    groups: FavoriteGroup[],
): SyncableGroup[] {
    return groups.map((g) => ({
        ...g,
        isDeleted: false,
    }));
}

/**
 * 將 SyncableFavorite[] 轉換回 FavoriteRestaurant[]。
 *
 * 過濾掉 tombstone（isDeleted=true）後，移除 sync metadata，
 * 回傳乾淨的 FavoriteRestaurant[] 供 UI 使用。
 *
 * @param syncables 可同步格式的餐廳清單
 * @returns 過濾後的乾淨格式清單
 */
export function downgradeFromSyncable(
    syncables: SyncableFavorite[],
): FavoriteRestaurant[] {
    return syncables
        .filter((f) => !f.isDeleted)
        .map(({ isDeleted, ...rest }) => rest);
}

/**
 * 將 SyncableGroup[] 轉換回 FavoriteGroup[]。
 * 過濾掉 tombstone 後移除 sync metadata。
 */
export function downgradeGroupsFromSyncable(
    syncables: SyncableGroup[],
): FavoriteGroup[] {
    return syncables
        .filter((g) => !g.isDeleted)
        .map(({ isDeleted, ...rest }) => rest);
}

/**
 * 建立一個空白的初始同步狀態。
 *
 * @param deviceId 裝置識別碼
 * @returns 空的 SyncableFavoriteState
 */
export function createEmptySyncState(deviceId: string): SyncableFavoriteState {
    return {
        favorites: [],
        groups: [],
        activeGroupId: '',
        groupQueues: {},
        groupCurrentDailyIds: {},
        lastUpdateDate: '',
        _syncVersion: 0,
        _lastSyncedAt: new Date().toISOString(),
        _deviceId: deviceId,
    };
}
