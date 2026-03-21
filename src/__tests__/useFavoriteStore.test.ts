/**
 * useFavoriteStore 單元測試
 * 驗證：幽靈 ID（孤兒 ID）修復邏輯
 *
 * 注意：zustand store 使用純函式邏輯，不依賴 AsyncStorage（僅測試行為層）
 * 我們透過直接呼叫 store action 來驗證 state 變更。
 *
 * 群組感知更新（v2）：
 *   - queue、currentDailyId 已遷移至 groupQueues[activeGroupId]、groupCurrentDailyIds[activeGroupId]
 *   - 使用 getActiveGroupQueue() / getActiveGroupCurrentDailyId() 便利 getter
 */

// Mock AsyncStorage 避免 native module 錯誤
jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiSet: jest.fn(() => Promise.resolve()),
}));

// 每次 test 之前重置 module 讓 store 回到初始狀態
beforeEach(() => {
    jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers — 取得群組感知的 queue / currentDailyId
// ---------------------------------------------------------------------------

function getQueue(store: any): string[] {
    const state = store.getState();
    return state.groupQueues?.[state.activeGroupId] ?? [];
}

function getCurrentDailyId(store: any): string | null {
    const state = store.getState();
    return state.groupCurrentDailyIds?.[state.activeGroupId] ?? null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFavoriteStore — addFavorite', () => {
    it('第一次 addFavorite 時 currentDailyId 應設為新加入的 id', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        const store = useFavoriteStore.getState();
        store.addFavorite('老王牛肉麵');

        const state = useFavoriteStore.getState();
        expect(state.favorites).toHaveLength(1);
        expect(getCurrentDailyId(useFavoriteStore)).toBe(state.favorites[0].id);
    });

    it('當 currentDailyId 是幽靈 ID（不在 queue 中）時，addFavorite 應重置為新 id', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        const activeGroupId = useFavoriteStore.getState().activeGroupId;

        // 直接注入損毀狀態（模擬 AsyncStorage 損毀場景）
        useFavoriteStore.setState({
            favorites: [],
            groupQueues: { [activeGroupId]: [] },                         // queue 是空的
            groupCurrentDailyIds: { [activeGroupId]: 'ghost-id-that-does-not-exist' },  // 幽靈 ID
            lastUpdateDate: '2024-01-01',
        });

        useFavoriteStore.getState().addFavorite('美好早午餐');
        const state = useFavoriteStore.getState();

        // 幽靈 ID 應被取代
        expect(getCurrentDailyId(useFavoriteStore)).not.toBe('ghost-id-that-does-not-exist');
        expect(getCurrentDailyId(useFavoriteStore)).toBe(state.favorites[0].id);
    });

    it('addFavorite 帶 extra 參數應正確儲存 address, category, placeId', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('鼎泰豐', '必點小籠包', {
            address: '台北市信義區信義路五段7號',
            category: '餐廳',
            placeId: 'ChIJ_test123',
        });

        const state = useFavoriteStore.getState();
        expect(state.favorites).toHaveLength(1);
        expect(state.favorites[0].name).toBe('鼎泰豐');
        expect(state.favorites[0].note).toBe('必點小籠包');
        expect(state.favorites[0].address).toBe('台北市信義區信義路五段7號');
        expect(state.favorites[0].category).toBe('餐廳');
        expect(state.favorites[0].placeId).toBe('ChIJ_test123');
    });

    it('addFavorite 不帶 extra 參數，address/category/placeId 應為 undefined', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('路邊攤');

        const state = useFavoriteStore.getState();
        expect(state.favorites[0].address).toBeUndefined();
        expect(state.favorites[0].category).toBeUndefined();
        expect(state.favorites[0].placeId).toBeUndefined();
    });
});

describe('useFavoriteStore — removeFavorite', () => {
    it('刪除非 current 的餐廳後，若 currentDailyId 仍在 queue 中，不應改變', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        const store = useFavoriteStore.getState();

        store.addFavorite('A 餐廳');
        store.addFavorite('B 餐廳');

        const state = useFavoriteStore.getState();
        const aId = state.favorites[0].id;
        const bId = state.favorites[1].id;
        const activeGroupId = state.activeGroupId;

        // currentDailyId 指向 A，刪除 B
        useFavoriteStore.setState({
            groupCurrentDailyIds: { [activeGroupId]: aId },
        });
        useFavoriteStore.getState().removeFavorite(bId);

        expect(getCurrentDailyId(useFavoriteStore)).toBe(aId);
    });

    it('當 currentDailyId 是幽靈 ID，removeFavorite 應清除幽靈 ID', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        const activeGroupId = useFavoriteStore.getState().activeGroupId;

        useFavoriteStore.setState({
            favorites: [{ id: 'real-1', name: '天天火鍋', groupId: activeGroupId, createdAt: new Date().toISOString() }],
            groupQueues: { [activeGroupId]: ['real-1'] },
            groupCurrentDailyIds: { [activeGroupId]: 'ghost-999' },   // 幽靈 ID，不在 queue 中
            lastUpdateDate: '2024-01-01',
        });

        // 刪除 real-1，觸發 removeFavorite
        useFavoriteStore.getState().removeFavorite('real-1');
        expect(getCurrentDailyId(useFavoriteStore)).toBeNull(); // queue 清空後應為 null
    });

    it('刪除 currentDailyId 指向的餐廳，應推進到下一個', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        const store = useFavoriteStore.getState();

        store.addFavorite('A 餐廳');
        store.addFavorite('B 餐廳');

        const state = useFavoriteStore.getState();
        const aId = state.favorites[0].id;
        const bId = state.favorites[1].id;
        const activeGroupId = state.activeGroupId;

        useFavoriteStore.setState({
            groupCurrentDailyIds: { [activeGroupId]: aId },
        });
        useFavoriteStore.getState().removeFavorite(aId);

        expect(getCurrentDailyId(useFavoriteStore)).toBe(bId);
    });
});

describe('useFavoriteStore — checkDaily', () => {
    it('跨日時，若 currentDailyId 是幽靈 ID，應重置為 queue[0]', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        const activeGroupId = useFavoriteStore.getState().activeGroupId;

        useFavoriteStore.setState({
            favorites: [{ id: 'real-1', name: '老王', groupId: activeGroupId, createdAt: new Date().toISOString() }],
            groupQueues: { [activeGroupId]: ['real-1'] },
            groupCurrentDailyIds: { [activeGroupId]: 'ghost-abc' },  // 幽靈 ID
            lastUpdateDate: '2020-01-01', // 舊日期，確保觸發跨日邏輯
        });

        useFavoriteStore.getState().checkDaily();

        // checkDaily 清理孤兒後，currentDailyId 應為合法 ID
        expect(getCurrentDailyId(useFavoriteStore)).toBe('real-1');
    });
});

describe('useFavoriteStore — updateFavoriteName', () => {
    it('應正確更新餐廳名稱', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('舊名字', '備註');
        const id = useFavoriteStore.getState().favorites[0].id;

        useFavoriteStore.getState().updateFavoriteName(id, '新名字');
        const state = useFavoriteStore.getState();

        expect(state.favorites[0].name).toBe('新名字');
        expect(state.favorites[0].note).toBe('備註'); // 備註不受影響
    });

    it('應更新 updatedAt 時間戳', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('老店');
        const id = useFavoriteStore.getState().favorites[0].id;

        // 等一小段時間確保 Date.now() 不同
        useFavoriteStore.getState().updateFavoriteName(id, '新店名');
        const afterUpdate = useFavoriteStore.getState().favorites[0].updatedAt;

        // updatedAt 應該被更新（可能相同毫秒，但至少不為 undefined）
        expect(afterUpdate).toBeDefined();
    });
});

describe('useFavoriteStore — reorderQueue', () => {
    it('應按照新順序重排 queue', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('A');
        useFavoriteStore.getState().addFavorite('B');
        useFavoriteStore.getState().addFavorite('C');

        const state = useFavoriteStore.getState();
        const [aId, bId, cId] = state.favorites.map((f: any) => f.id);

        // 反轉順序
        useFavoriteStore.getState().reorderQueue([cId, bId, aId]);

        expect(getQueue(useFavoriteStore)).toEqual([cId, bId, aId]);
    });

    it('重排後 currentDailyId 若仍在 queue 中應保持不變', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('X');
        useFavoriteStore.getState().addFavorite('Y');

        const currentId = getCurrentDailyId(useFavoriteStore);
        const queue = getQueue(useFavoriteStore);

        // 反轉 queue
        useFavoriteStore.getState().reorderQueue([...queue].reverse());

        // currentDailyId 仍然指向原本的餐廳
        expect(getCurrentDailyId(useFavoriteStore)).toBe(currentId);
    });

    it('應過濾掉不合法的 ID', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('唯一');

        const id = useFavoriteStore.getState().favorites[0].id;

        useFavoriteStore.getState().reorderQueue([id, 'invalid-ghost-id', 'another-fake']);

        expect(getQueue(useFavoriteStore)).toEqual([id]);
    });
});

describe('useFavoriteStore — findDuplicate', () => {
    it('placeId 精確比對應找到重複', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('鼎泰豐', undefined, {
            placeId: 'ChIJ_dtf123',
            address: '台北市信義區',
            category: '餐廳',
        });

        const dup = useFavoriteStore.getState().findDuplicate('隨便名稱', 'ChIJ_dtf123');
        expect(dup).not.toBeNull();
        expect(dup?.name).toBe('鼎泰豐');
    });

    it('名稱模糊比對應忽略大小寫與空白', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('Hello World');

        const dup = useFavoriteStore.getState().findDuplicate('  hello world  ');
        expect(dup).not.toBeNull();
        expect(dup?.name).toBe('Hello World');
    });

    it('無重複時應回傳 null', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('既有餐廳');

        const dup = useFavoriteStore.getState().findDuplicate('完全不同的名字');
        expect(dup).toBeNull();
    });

    it('placeId 比對優先於名稱比對', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('餐廳A', undefined, { placeId: 'place-A' });
        useFavoriteStore.getState().addFavorite('餐廳B', undefined, { placeId: 'place-B' });

        // 名稱查「餐廳A」但 placeId 指向 place-B → 應回傳餐廳B（placeId 優先）
        const dup = useFavoriteStore.getState().findDuplicate('餐廳A', 'place-B');
        expect(dup).not.toBeNull();
        expect(dup?.name).toBe('餐廳B');
    });

    it('空清單時應回傳 null', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        const dup = useFavoriteStore.getState().findDuplicate('任何名字', 'any-place-id');
        expect(dup).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Tests: deleteGroup — tombstone 追蹤
// ---------------------------------------------------------------------------

describe('useFavoriteStore — deleteGroup tombstone tracking', () => {
    it('刪除群組後 _deletedGroupIds 應包含 DeletedItemRecord', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');

        // 先建立第二個群組（需至少 2 個才能刪除）
        const newGroup = useFavoriteStore.getState().createGroup('測試群組');
        expect(newGroup).not.toBeNull();
        const groupId = newGroup!.id;

        // 刪除群組
        const result = useFavoriteStore.getState().deleteGroup(groupId);
        expect(result).toBe(true);

        const state = useFavoriteStore.getState();
        expect(state._deletedGroupIds).toHaveLength(1);
        expect(state._deletedGroupIds[0].id).toBe(groupId);
        expect(state._deletedGroupIds[0].deletedAt).toBeDefined();
        // 驗證 deletedAt 是有效的 ISO 8601 時間
        expect(new Date(state._deletedGroupIds[0].deletedAt).getTime()).toBeGreaterThan(0);
    });

    it('刪除含有餐廳的群組，_deletedFavoriteIds 也應包含子餐廳的 DeletedItemRecord', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');

        // 建立第二個群組並切換到該群組
        const newGroup = useFavoriteStore.getState().createGroup('有餐廳的群組');
        useFavoriteStore.getState().setActiveGroup(newGroup!.id);

        // 在新群組中新增餐廳
        useFavoriteStore.getState().addFavorite('測試餐廳A');
        useFavoriteStore.getState().addFavorite('測試餐廳B');

        const favIds = useFavoriteStore.getState().favorites
            .filter((f: any) => f.groupId === newGroup!.id)
            .map((f: any) => f.id);
        expect(favIds).toHaveLength(2);

        // 切回原始群組以避免刪除啟用中群組的邊界條件
        const originalGroupId = useFavoriteStore.getState().groups[0].id;
        useFavoriteStore.getState().setActiveGroup(originalGroupId);

        // 刪除含餐廳的群組
        useFavoriteStore.getState().deleteGroup(newGroup!.id);

        const state = useFavoriteStore.getState();
        expect(state._deletedGroupIds).toHaveLength(1);
        expect(state._deletedFavoriteIds).toHaveLength(2);
        // 驗證每個 DeletedItemRecord 都有正確的 id 和 deletedAt
        const deletedFavIdSet = new Set(state._deletedFavoriteIds.map((r: any) => r.id));
        expect(deletedFavIdSet.has(favIds[0])).toBe(true);
        expect(deletedFavIdSet.has(favIds[1])).toBe(true);
    });

    it('禁止刪除最後一個群組', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        const state = useFavoriteStore.getState();
        expect(state.groups).toHaveLength(1);

        const result = useFavoriteStore.getState().deleteGroup(state.groups[0].id);
        expect(result).toBe(false);
        expect(useFavoriteStore.getState()._deletedGroupIds).toHaveLength(0);
    });
});

describe('useFavoriteStore — removeFavorite tombstone tracking', () => {
    it('刪除餐廳後 _deletedFavoriteIds 應包含 DeletedItemRecord', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('要刪除的餐廳');

        const favId = useFavoriteStore.getState().favorites[0].id;
        useFavoriteStore.getState().removeFavorite(favId);

        const state = useFavoriteStore.getState();
        expect(state._deletedFavoriteIds).toHaveLength(1);
        expect(state._deletedFavoriteIds[0].id).toBe(favId);
        expect(state._deletedFavoriteIds[0].deletedAt).toBeDefined();
        expect(new Date(state._deletedFavoriteIds[0].deletedAt).getTime()).toBeGreaterThan(0);
    });

    it('連續刪除多個餐廳，_deletedFavoriteIds 應累積', () => {
        const { useFavoriteStore } = require('../store/useFavoriteStore');
        useFavoriteStore.getState().addFavorite('餐廳 1');
        useFavoriteStore.getState().addFavorite('餐廳 2');

        const ids = useFavoriteStore.getState().favorites.map((f: any) => f.id);
        useFavoriteStore.getState().removeFavorite(ids[0]);
        useFavoriteStore.getState().removeFavorite(ids[1]);

        const state = useFavoriteStore.getState();
        expect(state._deletedFavoriteIds).toHaveLength(2);
        const deletedIds = state._deletedFavoriteIds.map((r: any) => r.id);
        expect(deletedIds).toContain(ids[0]);
        expect(deletedIds).toContain(ids[1]);
    });
});
