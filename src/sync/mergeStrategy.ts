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
//
// 📖 為什麼不用 CRDT？
//    CRDT（Conflict-free Replicated Data Types）是更強大的合併演算法，
//    但對於「最愛餐廳清單」這種低衝突場景來說過度設計（over-engineering）。
//    LWW per-item 已足夠處理 99.9% 的使用情境。
// ============================================================================

import type { FavoriteRestaurant } from '../store/useFavoriteStore';

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
 * 可同步的完整最愛餐廳狀態。
 *
 * 這是寫入 Google Drive appDataFolder 的 JSON 結構：
 *
 * ```json
 * {
 *   "favorites": [{ id, name, note, createdAt, updatedAt, isDeleted? }],
 *   "queue": ["id1", "id2", ...],
 *   "currentDailyId": "id1" | null,
 *   "lastUpdateDate": "2025-03-13",
 *   "_syncVersion": 42,
 *   "_lastSyncedAt": "2025-03-13T14:00:00.000Z",
 *   "_deviceId": "device-abc123"
 * }
 * ```
 */
export interface SyncableFavoriteState {
    favorites: SyncableFavorite[];
    queue: string[];
    currentDailyId: string | null;
    lastUpdateDate: string;

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
 * @param local 本地狀態
 * @param remote 遠端狀態（從 Google Drive 下載的）
 * @returns 合併後的新狀態
 */
export function mergeStates(
    local: SyncableFavoriteState,
    remote: SyncableFavoriteState,
): SyncableFavoriteState {
    // 1. 收集所有餐廳 ID（去重）
    const allIds = new Set<string>([
        ...local.favorites.map((f) => f.id),
        ...remote.favorites.map((f) => f.id),
    ]);

    const mergedFavorites: SyncableFavorite[] = [];
    const now = new Date().toISOString();

    for (const id of allIds) {
        const localItem = local.favorites.find((f) => f.id === id);
        const remoteItem = remote.favorites.find((f) => f.id === id);

        if (localItem && !remoteItem) {
            // 場景 1：只有本地有 → 本地新增的項目，保留
            mergedFavorites.push(localItem);
        } else if (!localItem && remoteItem) {
            // 場景 2：只有遠端有 → 遠端/其他裝置新增的，合併進來
            mergedFavorites.push(remoteItem);
        } else if (localItem && remoteItem) {
            // 場景 3-6：兩邊都有 → 比較 updatedAt
            const localTime = new Date(localItem.updatedAt).getTime();
            const remoteTime = new Date(remoteItem.updatedAt).getTime();
            const winner = localTime >= remoteTime ? localItem : remoteItem;
            mergedFavorites.push(winner);
        }
    }

    // 2. 清理過期的 tombstones
    const cutoffTime = Date.now() - TOMBSTONE_TTL_MS;
    const cleaned = mergedFavorites.filter((f) => {
        if (!f.isDeleted) return true;
        // 已刪除的項目：如果 updatedAt 超過 7 天，永久移除
        return new Date(f.updatedAt).getTime() > cutoffTime;
    });

    // 3. 合併 queue
    //    策略：以 _syncVersion 較高者的 queue 為基準，
    //    過濾掉已被刪除或不存在的 ID
    const activeIds = new Set(
        cleaned.filter((f) => !f.isDeleted).map((f) => f.id),
    );

    const baseQueue =
        local._syncVersion >= remote._syncVersion ? local.queue : remote.queue;

    // 先保留 baseQueue 中仍然存活的 ID，再加入新增的（baseQueue 中不存在的）
    const mergedQueue = [
        ...baseQueue.filter((id) => activeIds.has(id)),
        ...[...activeIds].filter((id) => !baseQueue.includes(id)),
    ];

    // 4. 合併 currentDailyId
    //    策略：以 _syncVersion 較高者的 currentDailyId 為準，
    //    但如果該 ID 已不在 mergedQueue 中，fallback 為 queue[0]
    const baseCurrent =
        local._syncVersion >= remote._syncVersion
            ? local.currentDailyId
            : remote.currentDailyId;
    const mergedCurrentId =
        baseCurrent && mergedQueue.includes(baseCurrent)
            ? baseCurrent
            : mergedQueue[0] ?? null;

    // 5. lastUpdateDate：取較新的日期
    const mergedLastUpdateDate =
        local.lastUpdateDate > remote.lastUpdateDate
            ? local.lastUpdateDate
            : remote.lastUpdateDate;

    return {
        favorites: cleaned,
        queue: mergedQueue,
        currentDailyId: mergedCurrentId,
        lastUpdateDate: mergedLastUpdateDate,
        _syncVersion: Math.max(local._syncVersion, remote._syncVersion) + 1,
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
 *   - 為每個餐廳加上 updatedAt（使用 createdAt 作為初始值）
 *   - 為每個餐廳加上 isDeleted: false
 *
 * @param favorites 舊格式的餐廳清單
 * @returns 可同步格式的餐廳清單
 */
export function upgradeToSyncable(
    favorites: FavoriteRestaurant[],
): SyncableFavorite[] {
    return favorites.map((f) => ({
        ...f,
        updatedAt: f.createdAt, // 初始 updatedAt = createdAt
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
        .map(({ updatedAt, isDeleted, ...rest }) => rest);
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
        queue: [],
        currentDailyId: null,
        lastUpdateDate: '',
        _syncVersion: 0,
        _lastSyncedAt: new Date().toISOString(),
        _deviceId: deviceId,
    };
}
