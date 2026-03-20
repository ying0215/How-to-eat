import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

interface FavoriteState {
    favorites: FavoriteRestaurant[];
    queue: string[];          // 餐廳 ID 組成的輪替佇列
    currentDailyId: string | null;
    lastUpdateDate: string;   // 格式: YYYY-MM-DD

    // Actions
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
     * 接受新的 ID 陣列，直接覆蓋 queue。
     */
    reorderQueue: (newOrder: string[]) => void;
    skipCurrent: () => void;
    checkDaily: () => void;
    /**
     * 檢查是否已存在相同的餐廳（重複防呆）。
     * 優先比對 placeId（精確匹配），其次模糊比對名稱（忽略大小寫與前後空白）。
     * @returns 找到的重複餐廳，或 null
     */
    findDuplicate: (name: string, placeId?: string) => FavoriteRestaurant | null;
}

/** 取得今天的本地日期字串 */
const getTodayString = (): string => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

/**
 * 產生碰撞安全的唯一 ID。
 *
 * 組合 timestamp（36 進位）+ 遞增計數器 + 密碼學隨機雜湊，
 * 在快速連續呼叫（批次匯入）或多裝置同步場景中仍能保證唯一性。
 */
let _idCounter = 0;
const generateId = (): string => {
    const timestamp = Date.now().toString(36);
    const counter = (_idCounter++).toString(36);
    // 優先使用 crypto API（Web + 新版 RN），fallback Math.random
    let random: string;
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        const bytes = new Uint8Array(8);
        globalThis.crypto.getRandomValues(bytes);
        random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } else {
        random = Math.random().toString(36).substring(2, 10)
            + Math.random().toString(36).substring(2, 10);
    }
    return `${timestamp}-${counter}-${random}`;
};

/**
 * 孤兒 ID 清理：若 currentDailyId 不在 queue 中（資料不一致），
 * 自動重置為 queue[0] 或 null，避免幽靈 ID 永久殘留。
 */
const sanitizeCurrentId = (currentId: string | null, queue: string[]): string | null => {
    if (currentId === null) return null;
    return queue.includes(currentId) ? currentId : (queue[0] ?? null);
};

export const useFavoriteStore = create<FavoriteState>()(
    persist(
        (set, get) => ({
            favorites: [],
            queue: [],
            currentDailyId: null,
            lastUpdateDate: '',

            addFavorite: (name: string, note?: string, extra?: { address?: string; category?: string; placeId?: string; latitude?: number; longitude?: number }) => {
                const id = generateId();
                const now = new Date().toISOString();
                const newItem: FavoriteRestaurant = {
                    id,
                    name,
                    note,
                    address: extra?.address,
                    category: extra?.category,
                    placeId: extra?.placeId,
                    latitude: extra?.latitude,
                    longitude: extra?.longitude,
                    createdAt: now,
                    updatedAt: now, // 新建時 updatedAt = createdAt
                };

                set((state) => {
                    const newQueue = [...state.queue, id];
                    // 若 currentDailyId 為 null 或為幽靈 ID（不在現有 queue 中），重置為新加入的 id
                    const isOrphan = state.currentDailyId !== null && !state.queue.includes(state.currentDailyId);
                    const newCurrentId = (state.currentDailyId === null || isOrphan) ? id : state.currentDailyId;
                    return {
                        favorites: [...state.favorites, newItem],
                        queue: newQueue,
                        currentDailyId: newCurrentId,
                        lastUpdateDate: state.lastUpdateDate || getTodayString(),
                    };
                });
            },

            removeFavorite: (id: string) => {
                set((state) => {
                    const newFavorites = state.favorites.filter((f) => f.id !== id);
                    const newQueue = state.queue.filter((qId) => qId !== id);

                    let newCurrentId: string | null;
                    if (state.currentDailyId === id) {
                        // 被刪除的剛好是當前推薦，推進到下一個
                        newCurrentId = newQueue.length > 0 ? newQueue[0] : null;
                    } else {
                        // 即使不是刪除當前推薦，仍需確認 currentDailyId 在新 queue 中（防孤兒）
                        newCurrentId = sanitizeCurrentId(state.currentDailyId, newQueue);
                    }

                    return {
                        favorites: newFavorites,
                        queue: newQueue,
                        currentDailyId: newCurrentId,
                    };
                });
            },

            updateFavoriteName: (id: string, name: string) => {
                set((state) => {
                    const now = new Date().toISOString();
                    return {
                        favorites: state.favorites.map((f) =>
                            f.id === id
                                ? { ...f, name, updatedAt: now }
                                : f,
                        ),
                    };
                });
            },

            updateFavoriteNote: (id: string, note: string) => {
                set((state) => {
                    const now = new Date().toISOString();
                    return {
                        favorites: state.favorites.map((f) =>
                            f.id === id
                                ? { ...f, note, updatedAt: now }
                                : f,
                        ),
                    };
                });
            },

            reorderQueue: (newOrder: string[]) => {
                set((state) => {
                    // 確保新排序只包含合法的 ID
                    const validIds = new Set(state.favorites.map((f) => f.id));
                    const sanitized = newOrder.filter((id) => validIds.has(id));
                    // 保持 currentDailyId 不變（佇列順序改變不影響今日推薦）
                    return {
                        queue: sanitized,
                        currentDailyId: sanitizeCurrentId(state.currentDailyId, sanitized),
                    };
                });
            },

            skipCurrent: () => {
                set((state) => {
                    if (!state.currentDailyId || state.queue.length <= 1) return state;

                    // 把目前這個移到佇列最後面，前進到下一個
                    const newQueue = [...state.queue];
                    const currentIndex = newQueue.indexOf(state.currentDailyId);
                    if (currentIndex !== -1) {
                        const [skipped] = newQueue.splice(currentIndex, 1);
                        newQueue.push(skipped);
                    }

                    return {
                        queue: newQueue,
                        currentDailyId: newQueue[0],
                    };
                });
            },

            checkDaily: () => {
                const today = getTodayString();
                const state = get();

                if (state.lastUpdateDate === today) return; // 今天已更新過
                if (state.queue.length === 0) {
                    set({ lastUpdateDate: today });
                    return;
                }

                // 跨日前先清理孤兒（currentDailyId 不在 queue 中的情況）
                const sanitized = sanitizeCurrentId(state.currentDailyId, state.queue);

                // 跨日：把昨天的推到佇列底部，推進到下一個
                const newQueue = [...state.queue];
                if (sanitized) {
                    const idx = newQueue.indexOf(sanitized);
                    if (idx !== -1) {
                        const [yesterday] = newQueue.splice(idx, 1);
                        newQueue.push(yesterday);
                    }
                }

                set({
                    queue: newQueue,
                    currentDailyId: newQueue[0] ?? null,
                    lastUpdateDate: today,
                });
            },
            findDuplicate: (name: string, placeId?: string): FavoriteRestaurant | null => {
                const { favorites } = get();
                // 策略 1：placeId 精確比對（最可靠）
                if (placeId) {
                    const byPlaceId = favorites.find((f) => f.placeId === placeId);
                    if (byPlaceId) return byPlaceId;
                }
                // 策略 2：名稱模糊比對（忽略大小寫與前後空白）
                const normalizedName = name.trim().toLowerCase();
                const byName = favorites.find((f) => f.name.trim().toLowerCase() === normalizedName);
                return byName ?? null;
            },
        }),
        {
            name: 'favorite-restaurant-storage',
            storage: createJSONStorage(() => AsyncStorage),
        }
    )
);
