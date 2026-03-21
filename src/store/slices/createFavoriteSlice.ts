import { StateCreator } from 'zustand';
import { FavoriteState, FavoriteRestaurant } from '../favoriteTypes';
import { generateId, getTodayString, sanitizeCurrentId } from '../favoriteUtils';

type FavoriteSlice = Pick<FavoriteState, 'addFavorite' | 'removeFavorite' | 'updateFavoriteName' | 'updateFavoriteNote' | 'findDuplicate' | 'getActiveGroupFavorites'>;

export const createFavoriteSlice: StateCreator<FavoriteState, [], [], FavoriteSlice> = (set, get) => ({
    addFavorite: (name: string, note?: string, extra?: { address?: string; category?: string; placeId?: string; latitude?: number; longitude?: number }) => {
        const id = generateId();
        const now = new Date().toISOString();
        const { activeGroupId } = get();
        const newItem: FavoriteRestaurant = {
            id,
            name,
            note,
            address: extra?.address,
            category: extra?.category,
            placeId: extra?.placeId,
            latitude: extra?.latitude,
            longitude: extra?.longitude,
            groupId: activeGroupId,
            createdAt: now,
            updatedAt: now,
        };

        set((state) => {
            const groupQueue = state.groupQueues[activeGroupId] ?? [];
            const newQueue = [...groupQueue, id];
            const currentId = state.groupCurrentDailyIds[activeGroupId];

            // 若 currentDailyId 為 null 或為幽靈 ID（不在現有 queue 中），重置為新加入的 id
            const isOrphan = currentId !== null && !groupQueue.includes(currentId);
            const newCurrentId = (currentId === null || isOrphan) ? id : currentId;

            return {
                favorites: [...state.favorites, newItem],
                groupQueues: {
                    ...state.groupQueues,
                    [activeGroupId]: newQueue,
                },
                groupCurrentDailyIds: {
                    ...state.groupCurrentDailyIds,
                    [activeGroupId]: newCurrentId,
                },
                lastUpdateDate: state.lastUpdateDate || getTodayString(),
            };
        });
    },

    removeFavorite: (id: string) => {
        set((state) => {
            const target = state.favorites.find((f) => f.id === id);
            if (!target) return state;

            const now = new Date().toISOString();
            const groupId = target.groupId;
            const newFavorites = state.favorites.filter((f) => f.id !== id);
            const groupQueue = state.groupQueues[groupId] ?? [];
            const newQueue = groupQueue.filter((qId) => qId !== id);
            const currentId = state.groupCurrentDailyIds[groupId];

            let newCurrentId: string | null;
            if (currentId === id) {
                // 被刪除的剛好是當前推薦，推進到下一個
                newCurrentId = newQueue.length > 0 ? newQueue[0] : null;
            } else {
                // 即使不是刪除當前推薦，仍需確認 currentDailyId 在新 queue 中（防孤兒）
                newCurrentId = sanitizeCurrentId(currentId ?? null, newQueue);
            }

            return {
                favorites: newFavorites,
                groupQueues: {
                    ...state.groupQueues,
                    [groupId]: newQueue,
                },
                groupCurrentDailyIds: {
                    ...state.groupCurrentDailyIds,
                    [groupId]: newCurrentId,
                },
                // 追蹤已刪除的餐廳 ID + 時間戳，供 sync 產生 tombstone
                _deletedFavoriteIds: [...state._deletedFavoriteIds, { id, deletedAt: now }],
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

    findDuplicate: (name: string, placeId?: string): FavoriteRestaurant | null => {
        const { favorites, activeGroupId } = get();
        const groupFavorites = favorites.filter((f) => f.groupId === activeGroupId);
        // 策略 1：placeId 精確比對（最可靠）
        if (placeId) {
            const byPlaceId = groupFavorites.find((f) => f.placeId === placeId);
            if (byPlaceId) return byPlaceId;
        }
        // 策略 2：名稱模糊比對（忽略大小寫與前後空白）
        const normalizedName = name.trim().toLowerCase();
        const byName = groupFavorites.find((f) => f.name.trim().toLowerCase() === normalizedName);
        return byName ?? null;
    },

    getActiveGroupFavorites: (): FavoriteRestaurant[] => {
        const { favorites, activeGroupId } = get();
        return favorites.filter((f) => f.groupId === activeGroupId);
    },
});
