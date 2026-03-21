import { StateCreator } from 'zustand';
import { FavoriteState, FavoriteGroup, MAX_GROUPS, GROUP_LETTERS, DeletedItemRecord } from '../favoriteTypes';
import { generateId } from '../favoriteUtils';

type GroupSlice = Pick<FavoriteState, 'getNextGroupName' | 'createGroup' | 'renameGroup' | 'deleteGroup' | 'setActiveGroup'>;

export const createGroupSlice: StateCreator<FavoriteState, [], [], GroupSlice> = (set, get) => ({
    getNextGroupName: (): string => {
        const { groups } = get();
        const usedNames = new Set(groups.map((g) => g.name));
        for (const letter of GROUP_LETTERS) {
            const candidate = `群組${letter}`;
            if (!usedNames.has(candidate)) return candidate;
        }
        // 所有字母都用過了 → 加數字
        let counter = 1;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const candidate = `群組${counter}`;
            if (!usedNames.has(candidate)) return candidate;
            counter++;
        }
    },

    createGroup: (name?: string): FavoriteGroup | null => {
        const { groups } = get();
        if (groups.length >= MAX_GROUPS) return null;

        const now = new Date().toISOString();
        const groupName = name?.trim() || get().getNextGroupName();
        const newGroup: FavoriteGroup = {
            id: generateId(),
            name: groupName,
            createdAt: now,
            updatedAt: now,
        };

        set((state) => ({
            groups: [...state.groups, newGroup],
            groupQueues: { ...state.groupQueues, [newGroup.id]: [] },
            groupCurrentDailyIds: { ...state.groupCurrentDailyIds, [newGroup.id]: null },
        }));

        return newGroup;
    },

    renameGroup: (id: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const now = new Date().toISOString();
        set((state) => ({
            groups: state.groups.map((g) =>
                g.id === id ? { ...g, name: trimmed, updatedAt: now } : g,
            ),
        }));
    },

    deleteGroup: (id: string): boolean => {
        const { groups } = get();
        if (groups.length <= 1) return false; // 禁止刪除最後一個

        set((state) => {
            const now = new Date().toISOString();
            const newGroups = state.groups.filter((g) => g.id !== id);
            // 記錄被刪除的群組內的餐廳 ID（供 sync tombstone），攜帶刪除時間戳
            const childFavRecords: DeletedItemRecord[] = state.favorites
                .filter((f) => f.groupId === id)
                .map((f) => ({ id: f.id, deletedAt: now }));
            const newFavorites = state.favorites.filter((f) => f.groupId !== id);
            const newGroupQueues = { ...state.groupQueues };
            delete newGroupQueues[id];
            const newGroupCurrentDailyIds = { ...state.groupCurrentDailyIds };
            delete newGroupCurrentDailyIds[id];

            // 若刪除的是啟用中群組 → 切換到第一個存活群組
            const newActiveGroupId = state.activeGroupId === id
                ? newGroups[0].id
                : state.activeGroupId;

            return {
                groups: newGroups,
                favorites: newFavorites,
                groupQueues: newGroupQueues,
                groupCurrentDailyIds: newGroupCurrentDailyIds,
                activeGroupId: newActiveGroupId,
                // 追蹤已刪除的 ID + 時間戳，供 sync 產生 tombstone
                _deletedGroupIds: [...state._deletedGroupIds, { id, deletedAt: now }],
                _deletedFavoriteIds: [...state._deletedFavoriteIds, ...childFavRecords],
            };
        });

        return true;
    },

    setActiveGroup: (id: string) => {
        const { groups } = get();
        if (!groups.some((g) => g.id === id)) return; // 群組不存在 → 忽略
        set({ activeGroupId: id });
    },
});
