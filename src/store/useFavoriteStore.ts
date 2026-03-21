import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { FavoriteState } from './favoriteTypes';
import { createDefaultGroup } from './favoriteUtils';
import { migrateIfNeeded, migrateDeletedRecords, LegacyState } from './favoriteMigrations';

import { createGroupSlice } from './slices/createGroupSlice';
import { createFavoriteSlice } from './slices/createFavoriteSlice';
import { createQueueSlice } from './slices/createQueueSlice';

// 匯出型別供其他元件呼叫
export * from './favoriteTypes';
export * from './favoriteUtils';

// ============================================================================
// 🏪 Zustand Store (Combined Slices)
// ============================================================================

export const useFavoriteStore = create<FavoriteState>()(
    persist(
        (set, get, api) => {
            // 初始建立預設群組
            const initialGroup = createDefaultGroup();

            return {
                // ── Initial State ──
                favorites: [],
                groups: [initialGroup],
                activeGroupId: initialGroup.id,
                groupQueues: { [initialGroup.id]: [] },
                groupCurrentDailyIds: { [initialGroup.id]: null },
                lastUpdateDate: '',
                _deletedGroupIds: [],
                _deletedFavoriteIds: [],

                // ── 結合 Slices ──
                ...createGroupSlice(set, get, api),
                ...createFavoriteSlice(set, get, api),
                ...createQueueSlice(set, get, api),
            };
        },
        {
            name: 'favorite-restaurant-storage',
            storage: createJSONStorage(() => AsyncStorage),
            // 遷移舊版資料
            onRehydrateStorage: () => {
                return (state, error) => {
                    if (error) {
                        console.error('[useFavoriteStore] Rehydration error:', error);
                        return;
                    }
                    if (!state) return;

                    // 遷移 1：偵測舊版資料（無 groups 欄位或 groups 為空）並遷移
                    const raw = state as unknown as LegacyState;
                    if (!raw.groups || raw.groups.length === 0) {
                        const migrated = migrateIfNeeded(raw);
                        useFavoriteStore.setState(migrated);
                        console.info('[useFavoriteStore] 舊版資料已遷移至群組結構');
                    }

                    // 遷移 2：偵測舊版已刪除記錄 string[] 並轉換為 DeletedItemRecord[]
                    const rawRecord = state as unknown as Record<string, unknown>;
                    const deletedMigration = migrateDeletedRecords(rawRecord);
                    if (Object.keys(deletedMigration).length > 0) {
                        useFavoriteStore.setState(deletedMigration);
                    }
                };
            },
            // partialize: 排除 functions，只持久化資料
            partialize: (state) => ({
                favorites: state.favorites,
                groups: state.groups,
                activeGroupId: state.activeGroupId,
                groupQueues: state.groupQueues,
                groupCurrentDailyIds: state.groupCurrentDailyIds,
                lastUpdateDate: state.lastUpdateDate,
                _deletedGroupIds: state._deletedGroupIds,
                _deletedFavoriteIds: state._deletedFavoriteIds,
            }),
        }
    )
);
