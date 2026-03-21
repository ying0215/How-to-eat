import { StateCreator } from 'zustand';
import { FavoriteState } from '../favoriteTypes';
import { getTodayString, sanitizeCurrentId } from '../favoriteUtils';

type QueueSlice = Pick<FavoriteState, 'reorderQueue' | 'skipCurrent' | 'checkDaily' | 'getActiveGroupQueue' | 'getActiveGroupCurrentDailyId'>;

export const createQueueSlice: StateCreator<FavoriteState, [], [], QueueSlice> = (set, get) => ({
    reorderQueue: (newOrder: string[]) => {
        set((state) => {
            const { activeGroupId } = state;
            // 確保新排序只包含合法的群組內 ID
            const groupFavIds = new Set(
                state.favorites.filter((f) => f.groupId === activeGroupId).map((f) => f.id),
            );
            const sanitized = newOrder.filter((id) => groupFavIds.has(id));
            const currentId = state.groupCurrentDailyIds[activeGroupId];
            return {
                groupQueues: {
                    ...state.groupQueues,
                    [activeGroupId]: sanitized,
                },
                groupCurrentDailyIds: {
                    ...state.groupCurrentDailyIds,
                    [activeGroupId]: sanitizeCurrentId(currentId ?? null, sanitized),
                },
            };
        });
    },

    skipCurrent: () => {
        set((state) => {
            const { activeGroupId } = state;
            const queue = state.groupQueues[activeGroupId] ?? [];
            const currentId = state.groupCurrentDailyIds[activeGroupId];

            if (!currentId || queue.length <= 1) return state;

            // 把目前這個移到佇列最後面，前進到下一個
            const newQueue = [...queue];
            const currentIndex = newQueue.indexOf(currentId);
            if (currentIndex !== -1) {
                const [skipped] = newQueue.splice(currentIndex, 1);
                newQueue.push(skipped);
            }

            return {
                groupQueues: {
                    ...state.groupQueues,
                    [activeGroupId]: newQueue,
                },
                groupCurrentDailyIds: {
                    ...state.groupCurrentDailyIds,
                    [activeGroupId]: newQueue[0],
                },
            };
        });
    },

    checkDaily: () => {
        const today = getTodayString();
        const state = get();

        if (state.lastUpdateDate === today) return; // 今天已更新過

        // 遍歷所有群組，各自跨日輪替
        const newGroupQueues = { ...state.groupQueues };
        const newGroupCurrentDailyIds = { ...state.groupCurrentDailyIds };

        for (const group of state.groups) {
            const gid = group.id;
            const queue = newGroupQueues[gid] ?? [];
            if (queue.length === 0) continue;

            const currentId = newGroupCurrentDailyIds[gid];
            // 先清理孤兒
            const sanitized = sanitizeCurrentId(currentId ?? null, queue);

            // 跨日：把昨天的推到佇列底部，推進到下一個
            const newQueue = [...queue];
            if (sanitized) {
                const idx = newQueue.indexOf(sanitized);
                if (idx !== -1) {
                    const [yesterday] = newQueue.splice(idx, 1);
                    newQueue.push(yesterday);
                }
            }

            newGroupQueues[gid] = newQueue;
            newGroupCurrentDailyIds[gid] = newQueue[0] ?? null;
        }

        set({
            groupQueues: newGroupQueues,
            groupCurrentDailyIds: newGroupCurrentDailyIds,
            lastUpdateDate: today,
        });
    },

    getActiveGroupQueue: (): string[] => {
        const { groupQueues, activeGroupId } = get();
        return groupQueues[activeGroupId] ?? [];
    },

    getActiveGroupCurrentDailyId: (): string | null => {
        const { groupCurrentDailyIds, activeGroupId } = get();
        return groupCurrentDailyIds[activeGroupId] ?? null;
    },
});
