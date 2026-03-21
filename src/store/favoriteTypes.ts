export interface DeletedItemRecord {
    id: string;
    /** 刪除操作發生的時間（ISO 8601），用於 tombstone 的 updatedAt */
    deletedAt: string;
}

export interface FavoriteGroup {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

export interface FavoriteRestaurant {
    id: string;
    name: string;
    note?: string; // 使用者備註 (例如：推薦菜色)
    /** Google Places 地址（從搜尋結果帶入） */
    address?: string;
    /** 餐廳分類（如「餐廳」「咖啡廳」「早午餐」，從 Google Places primaryTypeDisplayName 帶入） */
    category?: string;
    /** Google Places ID（用於查詢即時營業狀態） */
    placeId?: string;
    /** 緯度（用於靜態地圖預覽與精確定位） */
    latitude?: number;
    /** 經度（用於靜態地圖預覽與精確定位） */
    longitude?: number;
    /** 所屬群組 ID */
    groupId: string;
    createdAt: string;
    /**
     * 最後修改時間（ISO 8601 字串）。
     *
     * 用於 Google Drive 雲端同步時的 LWW (Last-Write-Wins) 合併策略。
     * 新建時 updatedAt = createdAt；本地修改（改名、改備註、跳過等）時更新此欄位。
     * 若為 undefined，表示尚未同步過，fallback 為 createdAt。
     */
    updatedAt?: string;
}

/** 群組上限 */
export const MAX_GROUPS = 10;

/** 預設群組字母序列（A-J） */
export const GROUP_LETTERS = 'ABCDEFGHIJ';

export interface FavoriteState {
    favorites: FavoriteRestaurant[];
    /** 所有群組 */
    groups: FavoriteGroup[];
    /** 啟用中的群組 ID */
    activeGroupId: string;
    /** 每個群組獨立的輪替佇列 — key: groupId, value: 餐廳 ID 陣列 */
    groupQueues: Record<string, string[]>;
    /** 每個群組獨立的今日推薦 — key: groupId, value: 餐廳 ID | null */
    groupCurrentDailyIds: Record<string, string | null>;
    /** 最後跨日更新日期 — 格式: YYYY-MM-DD */
    lastUpdateDate: string;
    /**
     * 已硬刪除的群組記錄（供 sync 產生 tombstone）。
     * 攜帶刪除時間戳，確保 tombstone 的 updatedAt 使用真正的刪除時間。
     * 同步完成後移除已處理的記錄。
     */
    _deletedGroupIds: DeletedItemRecord[];
    /**
     * 已硬刪除的餐廳記錄（供 sync 產生 tombstone）。
     * 攜帶刪除時間戳，確保 tombstone 的 updatedAt 使用真正的刪除時間。
     * 同步完成後移除已處理的記錄。
     */
    _deletedFavoriteIds: DeletedItemRecord[];

    // ── 群組 Actions ──
    /** 建立新群組（上限 MAX_GROUPS），回傳新群組或 null（已達上限） */
    createGroup: (name?: string) => FavoriteGroup | null;
    /** 重新命名群組 */
    renameGroup: (id: string, name: string) => void;
    /** 刪除群組（禁止刪除最後一個），連帶移除群組內所有餐廳 */
    deleteGroup: (id: string) => boolean;
    /** 切換啟用群組 */
    setActiveGroup: (id: string) => void;
    /** 取得下一個預設群組名稱（群組A → 群組B → …） */
    getNextGroupName: () => string;

    // ── 餐廳 Actions ──
    addFavorite: (name: string, note?: string, extra?: { address?: string; category?: string; placeId?: string; latitude?: number; longitude?: number }) => void;
    removeFavorite: (id: string) => void;
    /**
     * 修改餐廳的名稱。
     * 同時更新 updatedAt 以便雲端同步時正確合併。
     */
    updateFavoriteName: (id: string, name: string) => void;
    /**
     * 修改餐廳的備註。
     * 同時更新 updatedAt 以便雲端同步時正確合併。
     */
    updateFavoriteNote: (id: string, note: string) => void;
    /**
     * 重新排列佇列順序（拖曳排序結束後呼叫）。
     * 操作啟用中群組的 queue。
     */
    reorderQueue: (newOrder: string[]) => void;
    skipCurrent: () => void;
    checkDaily: () => void;
    /**
     * 檢查是否已存在相同的餐廳（重複防呆）。
     * 只在 activeGroup 範圍內查重。
     * 優先比對 placeId（精確匹配），其次模糊比對名稱（忽略大小寫與前後空白）。
     * @returns 找到的重複餐廳，或 null
     */
    findDuplicate: (name: string, placeId?: string) => FavoriteRestaurant | null;

    // ── 便利 Getters ──
    /** 取得啟用中群組的餐廳清單 */
    getActiveGroupFavorites: () => FavoriteRestaurant[];
    /** 取得啟用中群組的 queue */
    getActiveGroupQueue: () => string[];
    /** 取得啟用中群組的 currentDailyId */
    getActiveGroupCurrentDailyId: () => string | null;
}
