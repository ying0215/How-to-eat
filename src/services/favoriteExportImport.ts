// ============================================================================
// 📦 favoriteExportImport.ts — 最愛清單匯出入核心邏輯
// ============================================================================
//
// 純邏輯層，不涉及 UI 或平台 API。
// 負責：
//   1. 從 Zustand store 讀取資料 → 序列化為 JSON string（匯出）
//   2. 解析 JSON string → 驗證結構 → 覆蓋 Zustand store（匯入）
//
// 匯出格式：FavoriteExportPayload
//   - 包含所有群組、餐廳、佇列順序、今日推薦等完整狀態
//   - 不包含 sync metadata（_syncVersion, _deviceId 等）和 tombstone
//   - 附帶 _exportVersion 供未來向後相容遷移用
//
// ============================================================================

import type { FavoriteRestaurant, FavoriteGroup } from '../store/favoriteTypes';
import { useFavoriteStore } from '../store/useFavoriteStore';

// ---------------------------------------------------------------------------
// 📦 匯出入資料結構
// ---------------------------------------------------------------------------

/** 當前匯出格式版本號（變更匯出結構時遞增） */
export const EXPORT_VERSION = 1 as const;

/**
 * 匯出的 JSON payload 結構。
 *
 * 設計決策：
 *   - 與 store 的 partialize 欄位對齊，但排除 sync/tombstone 相關欄位
 *   - 附帶 _exportVersion 以便未來版本升級時的向後相容遷移
 *   - 附帶 _exportedAt 供使用者辨識匯出時間
 */
export interface FavoriteExportPayload {
    /** 格式版本號 */
    _exportVersion: typeof EXPORT_VERSION;
    /** 匯出時間（ISO 8601） */
    _exportedAt: string;
    /** 所有餐廳 */
    favorites: FavoriteRestaurant[];
    /** 所有群組 */
    groups: FavoriteGroup[];
    /** 啟用中的群組 ID */
    activeGroupId: string;
    /** 每個群組獨立的輪替佇列 */
    groupQueues: Record<string, string[]>;
    /** 每個群組獨立的今日推薦 */
    groupCurrentDailyIds: Record<string, string | null>;
    /** 最後跨日更新日期 */
    lastUpdateDate: string;
}

// ---------------------------------------------------------------------------
// 📤 匯出邏輯
// ---------------------------------------------------------------------------

/**
 * 從 useFavoriteStore 讀取當前狀態，打包為 JSON string。
 *
 * 不包含 sync metadata 和 tombstone（_deletedGroupIds / _deletedFavoriteIds），
 * 因為匯出入是全量覆蓋操作，不需要增量合併資訊。
 *
 * @returns 格式化的 JSON string（2-space indent，方便使用者閱讀）
 */
export function buildExportData(): string {
    const state = useFavoriteStore.getState();

    // 為缺少 groupId 的餐廳（歷史資料）回填 activeGroupId
    // 這些餐廳通常是在群組系統導入前新增的，邏輯上屬於當前啟用群組
    const sanitizedFavorites = state.favorites.map((fav) => {
        if (!fav.groupId) {
            return { ...fav, groupId: state.activeGroupId };
        }
        return fav;
    });

    // 確保所有被回填的餐廳也出現在對應群組的 queue 中
    const sanitizedQueues = { ...state.groupQueues };
    for (const fav of sanitizedFavorites) {
        const queue = sanitizedQueues[fav.groupId] ?? [];
        if (!queue.includes(fav.id)) {
            sanitizedQueues[fav.groupId] = [...queue, fav.id];
        }
    }

    const payload: FavoriteExportPayload = {
        _exportVersion: EXPORT_VERSION,
        _exportedAt: new Date().toISOString(),
        favorites: sanitizedFavorites,
        groups: state.groups,
        activeGroupId: state.activeGroupId,
        groupQueues: sanitizedQueues,
        groupCurrentDailyIds: { ...state.groupCurrentDailyIds },
        lastUpdateDate: state.lastUpdateDate,
    };

    return JSON.stringify(payload, null, 2);
}

/**
 * 產生匯出檔案名稱。
 *
 * 格式：how-to-eat-favorites-YYYY-MM-DD.json
 * 使用本地時區日期，方便使用者辨識。
 *
 * @returns 檔案名稱 string
 */
export function buildExportFilename(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `how-to-eat-favorites-${yyyy}-${mm}-${dd}.json`;
}

// ---------------------------------------------------------------------------
// 📥 匯入邏輯
// ---------------------------------------------------------------------------

/**
 * 匯入驗證錯誤，附帶具體的失敗原因。
 */
export class ImportValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ImportValidationError';
    }
}

/**
 * 解析並驗證匯入的 JSON string。
 *
 * 驗證規則：
 *   1. 必須是合法 JSON
 *   2. 頂層必須是 object
 *   3. _exportVersion 必須為 EXPORT_VERSION（當前為 1）
 *   4. favorites 必須是 array
 *   5. groups 必須是非空 array（至少有一個群組）
 *   6. activeGroupId 必須是 string
 *   7. groupQueues 必須是 object
 *   8. groupCurrentDailyIds 必須是 object
 *   9. 每個 favorite 必須有 id, name, createdAt（groupId 可選，缺少時自動指派到第一個群組）
 *   10. 每個 group 必須有 id, name, createdAt, updatedAt
 *
 * 自動修復：
 *   - 餐廳缺少 groupId 時自動指派到第一個 group
 *   - 自動確保被指派的餐廳出現在對應群組的 queue 中
 *   - 自動為缺少 currentDailyId 的群組設置首筆餐廳
 *
 * @param jsonString 使用者選取的 JSON 檔案內容
 * @returns 驗證通過的 FavoriteExportPayload
 * @throws ImportValidationError 若驗證失敗
 */
export function parseAndValidateImport(jsonString: string): FavoriteExportPayload {
    // ── Step 1: JSON 解析 ──
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonString);
    } catch {
        throw new ImportValidationError('檔案格式錯誤：不是有效的 JSON 檔案。');
    }

    // ── Step 2: 頂層結構檢查 ──
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ImportValidationError('檔案格式錯誤：預期為 JSON 物件。');
    }

    const data = parsed as Record<string, unknown>;

    // ── Step 3: 版本號檢查 ──
    if (data._exportVersion !== EXPORT_VERSION) {
        throw new ImportValidationError(
            `檔案版本不相容：預期 v${EXPORT_VERSION}，` +
            `收到 v${data._exportVersion ?? '未知'}。` +
            `\n\n請確認這是由本 App 匯出的檔案。`,
        );
    }

    // ── Step 4: 必填欄位型別檢查 ──
    if (!Array.isArray(data.favorites)) {
        throw new ImportValidationError('檔案格式錯誤：缺少 favorites 欄位或類型不正確。');
    }

    if (!Array.isArray(data.groups) || data.groups.length === 0) {
        throw new ImportValidationError('檔案格式錯誤：缺少 groups 欄位或群組為空。');
    }

    if (typeof data.activeGroupId !== 'string') {
        throw new ImportValidationError('檔案格式錯誤：缺少 activeGroupId 欄位。');
    }

    if (typeof data.groupQueues !== 'object' || data.groupQueues === null || Array.isArray(data.groupQueues)) {
        throw new ImportValidationError('檔案格式錯誤：缺少 groupQueues 欄位或類型不正確。');
    }

    if (typeof data.groupCurrentDailyIds !== 'object' || data.groupCurrentDailyIds === null || Array.isArray(data.groupCurrentDailyIds)) {
        throw new ImportValidationError('檔案格式錯誤：缺少 groupCurrentDailyIds 欄位或類型不正確。');
    }

    // ── Step 5: groups 內容驗證（先驗 groups，因為 favorites 修復需要參照第一個群組） ──
    const groups = data.groups as Record<string, unknown>[];
    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        if (typeof group !== 'object' || group === null) {
            throw new ImportValidationError(`第 ${i + 1} 個群組資料格式不正確。`);
        }
        if (typeof group.id !== 'string' || !group.id) {
            throw new ImportValidationError(`第 ${i + 1} 個群組缺少 id 欄位。`);
        }
        if (typeof group.name !== 'string' || !group.name) {
            throw new ImportValidationError(`第 ${i + 1} 個群組缺少 name 欄位。`);
        }
        if (typeof group.createdAt !== 'string') {
            throw new ImportValidationError(`第 ${i + 1} 個群組「${group.name}」缺少 createdAt。`);
        }
        if (typeof group.updatedAt !== 'string') {
            throw new ImportValidationError(`第 ${i + 1} 個群組「${group.name}」缺少 updatedAt。`);
        }
    }

    // 確定預設群組 ID（用於回填缺少 groupId 的餐廳）
    const defaultGroupId = groups[0].id as string;

    // ── Step 6: favorites 內容驗證 + 自動回填 groupId ──
    const favorites = data.favorites as Record<string, unknown>[];
    const orphanRestaurantIds: string[] = [];
    for (let i = 0; i < favorites.length; i++) {
        const fav = favorites[i];
        if (typeof fav !== 'object' || fav === null) {
            throw new ImportValidationError(`第 ${i + 1} 筆餐廳資料格式不正確。`);
        }
        if (typeof fav.id !== 'string' || !fav.id) {
            throw new ImportValidationError(`第 ${i + 1} 筆餐廳缺少 id 欄位。`);
        }
        if (typeof fav.name !== 'string' || !fav.name) {
            throw new ImportValidationError(`第 ${i + 1} 筆餐廳缺少 name 欄位。`);
        }
        if (typeof fav.createdAt !== 'string' || !fav.createdAt) {
            throw new ImportValidationError(`第 ${i + 1} 筆餐廳「${fav.name}」缺少 createdAt。`);
        }
        // groupId 缺少時自動回填到第一個群組（歷史資料相容）
        if (typeof fav.groupId !== 'string' || !fav.groupId) {
            fav.groupId = defaultGroupId;
            orphanRestaurantIds.push(fav.id as string);
        }
    }

    // ── Step 7: 修復 groupQueues —— 確保被回填的孤兒餐廳出現在 queue 中 ──
    const repairedQueues = { ...(data.groupQueues as Record<string, string[]>) };
    if (orphanRestaurantIds.length > 0) {
        const existingQueue = repairedQueues[defaultGroupId] ?? [];
        const missingIds = orphanRestaurantIds.filter((id) => !existingQueue.includes(id));
        if (missingIds.length > 0) {
            repairedQueues[defaultGroupId] = [...existingQueue, ...missingIds];
        }
    }
    // 確保每個群組至少都有一個空 queue entry
    for (const group of groups) {
        const gid = group.id as string;
        if (!repairedQueues[gid]) {
            repairedQueues[gid] = [];
        }
    }

    // ── Step 8: 修復 groupCurrentDailyIds —— 確保每個群組都有 entry ──
    const repairedCurrentDailyIds = { ...(data.groupCurrentDailyIds as Record<string, string | null>) };
    for (const group of groups) {
        const gid = group.id as string;
        if (repairedCurrentDailyIds[gid] === undefined) {
            // 設為該群組 queue 的第一筆，若 queue 為空則 null
            const queue = repairedQueues[gid] ?? [];
            repairedCurrentDailyIds[gid] = queue.length > 0 ? queue[0] : null;
        }
    }

    // ── 通過所有驗證 ──
    return {
        _exportVersion: EXPORT_VERSION,
        _exportedAt: (data._exportedAt as string) ?? new Date().toISOString(),
        favorites: data.favorites as FavoriteRestaurant[],
        groups: data.groups as FavoriteGroup[],
        activeGroupId: data.activeGroupId as string,
        groupQueues: repairedQueues,
        groupCurrentDailyIds: repairedCurrentDailyIds,
        lastUpdateDate: (data.lastUpdateDate as string) ?? '',
    };
}

/**
 * 將驗證過的匯入資料覆蓋寫入 useFavoriteStore。
 *
 * 寫入後：
 *   - 所有 favorites, groups, queues, currentDailyIds 被完全取代
 *   - tombstone（_deletedGroupIds, _deletedFavoriteIds）清空
 *     （匯入是全量操作，不需要保留增量刪除記錄）
 *
 * @param data 經 parseAndValidateImport() 驗證通過的資料
 */
export function applyImportToStore(data: FavoriteExportPayload): void {
    useFavoriteStore.setState({
        favorites: data.favorites,
        groups: data.groups,
        activeGroupId: data.activeGroupId,
        groupQueues: data.groupQueues,
        groupCurrentDailyIds: data.groupCurrentDailyIds,
        lastUpdateDate: data.lastUpdateDate,
        // 清空 tombstone（全量覆蓋後不需要增量刪除記錄）
        _deletedGroupIds: [],
        _deletedFavoriteIds: [],
    });
}
