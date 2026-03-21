import { FavoriteState, FavoriteRestaurant, FavoriteGroup } from './favoriteTypes';
import { createDefaultGroup } from './favoriteUtils';

/**
 * 偵測並遷移舊版持久化資料。
 *
 * 舊版結構：{ favorites, queue, currentDailyId, lastUpdateDate }
 * 新版結構：{ favorites(+groupId), groups, activeGroupId, groupQueues, groupCurrentDailyIds, lastUpdateDate }
 *
 * 遷移策略：
 *   1. 建立預設群組「群組A」
 *   2. 為所有既有 favorites 加上 groupId
 *   3. 將 queue → groupQueues[defaultGroupId]
 *   4. 將 currentDailyId → groupCurrentDailyIds[defaultGroupId]
 */
export interface LegacyState {
    favorites?: Array<Omit<FavoriteRestaurant, 'groupId'> & { groupId?: string }>;
    queue?: string[];
    currentDailyId?: string | null;
    lastUpdateDate?: string;
    groups?: FavoriteGroup[];
    activeGroupId?: string;
    groupQueues?: Record<string, string[]>;
    groupCurrentDailyIds?: Record<string, string | null>;
}

export function migrateIfNeeded(persisted: LegacyState): Partial<FavoriteState> {
    // 已經是新版結構 → 不需遷移
    if (persisted.groups && persisted.groups.length > 0 && persisted.activeGroupId) {
        return persisted as Partial<FavoriteState>;
    }

    // 舊版結構 → 遷移
    const defaultGroup = createDefaultGroup();
    const legacyFavorites = persisted.favorites ?? [];
    const legacyQueue = persisted.queue ?? [];
    const legacyCurrentDailyId = persisted.currentDailyId ?? null;

    const migratedFavorites: FavoriteRestaurant[] = legacyFavorites.map((f) => ({
        ...f,
        groupId: defaultGroup.id,
    }));

    return {
        favorites: migratedFavorites,
        groups: [defaultGroup],
        activeGroupId: defaultGroup.id,
        groupQueues: { [defaultGroup.id]: legacyQueue },
        groupCurrentDailyIds: { [defaultGroup.id]: legacyCurrentDailyId },
        lastUpdateDate: persisted.lastUpdateDate ?? '',
    };
}

/**
 * 偵測並遷移舊版已刪除記錄格式。
 *
 * 舊版格式：_deletedGroupIds: string[]  / _deletedFavoriteIds: string[]
 * 新版格式：_deletedGroupIds: DeletedItemRecord[] / _deletedFavoriteIds: DeletedItemRecord[]
 *
 * 若偵測到舊版格式（第一個元素為 string 而非物件），
 * 自動轉換為 { id, deletedAt: now }，避免 tombstone 的 updatedAt 為 undefined。
 *
 * @returns 需要寫回 store 的欄位，或空物件（不需遷移）
 */
export function migrateDeletedRecords(raw: Record<string, unknown>): Partial<FavoriteState> {
    const result: Partial<FavoriteState> = {};
    const now = new Date().toISOString();
    let migrated = false;

    // _deletedGroupIds 格式檢測
    if (
        Array.isArray(raw._deletedGroupIds) &&
        raw._deletedGroupIds.length > 0 &&
        typeof raw._deletedGroupIds[0] === 'string'
    ) {
        result._deletedGroupIds = (raw._deletedGroupIds as string[]).map((id) => ({ id, deletedAt: now }));
        migrated = true;
    }

    // _deletedFavoriteIds 格式檢測
    if (
        Array.isArray(raw._deletedFavoriteIds) &&
        raw._deletedFavoriteIds.length > 0 &&
        typeof raw._deletedFavoriteIds[0] === 'string'
    ) {
        result._deletedFavoriteIds = (raw._deletedFavoriteIds as string[]).map((id) => ({ id, deletedAt: now }));
        migrated = true;
    }

    if (migrated) {
        console.info('[useFavoriteStore] 舊版已刪除記錄 string[] 已遷移至 DeletedItemRecord[]');
    }

    return result;
}
