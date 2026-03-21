/**
 * mergeStrategy 單元測試
 *
 * 驗證 LWW per-item 合併策略的所有場景：
 *   - 單邊新增
 *   - 雙邊衝突（取 updatedAt 較新者）
 *   - Tombstone（軟刪除）傳播
 *   - Per-group Queue 合併
 *   - 格式升降級
 */

import {
    mergeStates,
    upgradeToSyncable,
    downgradeFromSyncable,
    generateDeviceId,
    createEmptySyncState,
    type SyncableFavoriteState,
    type SyncableFavorite,
} from '../sync/mergeStrategy';
import type { FavoriteRestaurant } from '../store/useFavoriteStore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_GROUP_ID = 'default-group';

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function makeFavorite(
    id: string,
    name: string,
    updatedAt: string,
    isDeleted = false,
    groupId = DEFAULT_GROUP_ID,
): SyncableFavorite {
    return {
        id,
        name,
        groupId,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt,
        isDeleted,
    };
}

/**
 * 建立測試用的 SyncableFavoriteState。
 *
 * 支援 `queue` 和 `currentDailyId` 簡寫：若提供的話，
 * 會自動填入 `groupQueues[DEFAULT_GROUP_ID]` 和
 * `groupCurrentDailyIds[DEFAULT_GROUP_ID]`。
 */
function makeState(
    overrides: Partial<SyncableFavoriteState> & {
        /** 簡寫：自動填入 groupQueues[DEFAULT_GROUP_ID] */
        queue?: string[];
        /** 簡寫：自動填入 groupCurrentDailyIds[DEFAULT_GROUP_ID] */
        currentDailyId?: string | null;
    } = {},
): SyncableFavoriteState {
    const { queue, currentDailyId, ...rest } = overrides;
    const groupQueues = rest.groupQueues ?? (queue !== undefined ? { [DEFAULT_GROUP_ID]: queue } : {});
    const groupCurrentDailyIds = rest.groupCurrentDailyIds ?? (currentDailyId !== undefined ? { [DEFAULT_GROUP_ID]: currentDailyId } : {});
    return {
        favorites: [],
        groups: [{ id: DEFAULT_GROUP_ID, name: '群組A', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }],
        activeGroupId: DEFAULT_GROUP_ID,
        groupQueues,
        groupCurrentDailyIds,
        lastUpdateDate: '2025-03-13',
        _syncVersion: 0,
        _lastSyncedAt: '2025-03-13T00:00:00.000Z',
        _deviceId: 'test-device',
        ...rest,
    };
}

/** 從 merged 結果取得 default-group 的 queue */
function getQueue(merged: SyncableFavoriteState): string[] {
    return merged.groupQueues?.[DEFAULT_GROUP_ID] ?? [];
}

/** 從 merged 結果取得 default-group 的 currentDailyId */
function getCurrentDailyId(merged: SyncableFavoriteState): string | null {
    return merged.groupCurrentDailyIds?.[DEFAULT_GROUP_ID] ?? null;
}

// ---------------------------------------------------------------------------
// Tests: mergeStates
// ---------------------------------------------------------------------------

describe('mergeStates — 基礎合併', () => {
    it('場景 1: 本地有、遠端沒有 → 保留本地新增', () => {
        const local = makeState({
            favorites: [makeFavorite('a', '老王牛肉麵', '2025-03-13T10:00:00Z')],
            queue: ['a'],
            _syncVersion: 1,
        });
        const remote = makeState({
            favorites: [],
            queue: [],
            _syncVersion: 0,
        });

        const merged = mergeStates(local, remote);

        expect(merged.favorites).toHaveLength(1);
        expect(merged.favorites[0].name).toBe('老王牛肉麵');
        expect(getQueue(merged)).toContain('a');
    });

    it('場景 2: 遠端有、本地沒有 → 合併遠端新增', () => {
        const local = makeState({
            favorites: [],
            queue: [],
            _syncVersion: 0,
        });
        const remote = makeState({
            favorites: [makeFavorite('b', '珍珠奶茶', '2025-03-13T10:00:00Z')],
            queue: ['b'],
            _syncVersion: 1,
        });

        const merged = mergeStates(local, remote);

        expect(merged.favorites).toHaveLength(1);
        expect(merged.favorites[0].name).toBe('珍珠奶茶');
        expect(getQueue(merged)).toContain('b');
    });

    it('場景 3: 雙邊都有同一筆 → 取 updatedAt 較新者', () => {
        const local = makeState({
            favorites: [makeFavorite('c', '本地版本 (舊)', '2025-03-13T08:00:00Z')],
            queue: ['c'],
            _syncVersion: 1,
        });
        const remote = makeState({
            favorites: [makeFavorite('c', '遠端版本 (新)', '2025-03-13T12:00:00Z')],
            queue: ['c'],
            _syncVersion: 2,
        });

        const merged = mergeStates(local, remote);

        expect(merged.favorites[0].name).toBe('遠端版本 (新)');
    });

    it('場景 3 (反向): 本地較新 → 保留本地', () => {
        const local = makeState({
            favorites: [makeFavorite('c', '本地版本 (新)', '2025-03-13T15:00:00Z')],
            queue: ['c'],
            _syncVersion: 2,
        });
        const remote = makeState({
            favorites: [makeFavorite('c', '遠端版本 (舊)', '2025-03-13T08:00:00Z')],
            queue: ['c'],
            _syncVersion: 1,
        });

        const merged = mergeStates(local, remote);

        expect(merged.favorites[0].name).toBe('本地版本 (新)');
    });
});

describe('mergeStates — Tombstone 軟刪除', () => {
    it('場景 4: 本地修改、遠端刪除，遠端更新 → 刪除獲勝', () => {
        // 使用相對近期的時間戳，避免被 7 天 TTL 清理掉
        const recentPast = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 小時前
        const veryRecent = new Date(Date.now() - 1000 * 60 * 5).toISOString();  // 5 分鐘前

        const local = makeState({
            favorites: [makeFavorite('d', '本地修改', recentPast, false)],
            queue: ['d'],
            _syncVersion: 1,
        });
        const remote = makeState({
            favorites: [makeFavorite('d', '本地修改', veryRecent, true)],
            queue: [],
            _syncVersion: 2,
        });

        const merged = mergeStates(local, remote);

        const item = merged.favorites.find((f) => f.id === 'd');
        // 遠端 tombstone 較新，所以 isDeleted = true
        expect(item?.isDeleted).toBe(true);
        // 已刪除的項目不應出現在 queue 中
        expect(getQueue(merged)).not.toContain('d');
    });

    it('場景 5: 本地刪除、遠端修改，遠端更新 → 修改獲勝', () => {
        const local = makeState({
            favorites: [makeFavorite('e', '已刪除', '2025-03-13T08:00:00Z', true)],
            queue: [],
            _syncVersion: 1,
        });
        const remote = makeState({
            favorites: [makeFavorite('e', '遠端重新修改', '2025-03-13T12:00:00Z', false)],
            queue: ['e'],
            _syncVersion: 2,
        });

        const merged = mergeStates(local, remote);

        const item = merged.favorites.find((f) => f.id === 'e');
        expect(item?.isDeleted).toBe(false);
        expect(item?.name).toBe('遠端重新修改');
        expect(getQueue(merged)).toContain('e');
    });
});

describe('mergeStates — Queue 合併', () => {
    it('以 _syncVersion 較高者的 queue 順序為基準', () => {
        const local = makeState({
            favorites: [
                makeFavorite('x', 'X', '2025-03-13T10:00:00Z'),
                makeFavorite('y', 'Y', '2025-03-13T10:00:00Z'),
                makeFavorite('z', 'Z', '2025-03-13T10:00:00Z'),
            ],
            queue: ['z', 'x', 'y'], // 本地順序
            _syncVersion: 1,
        });
        const remote = makeState({
            favorites: [
                makeFavorite('x', 'X', '2025-03-13T10:00:00Z'),
                makeFavorite('y', 'Y', '2025-03-13T10:00:00Z'),
                makeFavorite('z', 'Z', '2025-03-13T10:00:00Z'),
            ],
            queue: ['y', 'z', 'x'], // 遠端順序（version 較高）
            _syncVersion: 5,
        });

        const merged = mergeStates(local, remote);

        // 遠端 version 較高，所以用遠端的 queue 順序
        expect(getQueue(merged)).toEqual(['y', 'z', 'x']);
    });

    it('合併後 queue 中不包含已刪除的項目', () => {
        const local = makeState({
            favorites: [
                makeFavorite('a', 'A', '2025-03-13T10:00:00Z', false),
                makeFavorite('b', 'B', '2025-03-13T10:00:00Z', true), // 已刪除
            ],
            queue: ['a', 'b'],
            _syncVersion: 3,
        });
        const remote = makeState({
            favorites: [],
            queue: [],
            _syncVersion: 0,
        });

        const merged = mergeStates(local, remote);

        expect(getQueue(merged)).toContain('a');
        expect(getQueue(merged)).not.toContain('b');
    });
});

describe('mergeStates — _syncVersion 與 _lastSyncedAt', () => {
    it('合併後 _syncVersion 為 max(local, remote) + 1', () => {
        const local = makeState({ _syncVersion: 3 });
        const remote = makeState({ _syncVersion: 7 });

        const merged = mergeStates(local, remote);

        expect(merged._syncVersion).toBe(8);
    });

    it('合併後 _deviceId 為本地裝置', () => {
        const local = makeState({ _deviceId: 'local-device' });
        const remote = makeState({ _deviceId: 'remote-device' });

        const merged = mergeStates(local, remote);

        expect(merged._deviceId).toBe('local-device');
    });
});

// ---------------------------------------------------------------------------
// Tests: Format conversion utilities
// ---------------------------------------------------------------------------

describe('upgradeToSyncable', () => {
    it('將 FavoriteRestaurant[] 轉換為 SyncableFavorite[]', () => {
        const input: FavoriteRestaurant[] = [
            { id: '1', name: '測試餐廳', groupId: 'g1', createdAt: '2025-03-13T00:00:00Z' },
        ];

        const result = upgradeToSyncable(input);

        expect(result).toHaveLength(1);
        expect(result[0].updatedAt).toBe('2025-03-13T00:00:00Z');
        expect(result[0].isDeleted).toBe(false);
    });
});

describe('downgradeFromSyncable', () => {
    it('過濾掉 tombstone 並移除 isDeleted metadata', () => {
        const input: SyncableFavorite[] = [
            makeFavorite('1', '存活的', '2025-03-13T00:00:00Z', false),
            makeFavorite('2', '已刪除的', '2025-03-13T00:00:00Z', true),
        ];

        const result = downgradeFromSyncable(input);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('存活的');
        // 確認 isDeleted 已移除（updatedAt 保留為可選欄位）
        expect((result[0] as unknown as Record<string, unknown>).isDeleted).toBeUndefined();
    });
});

describe('generateDeviceId', () => {
    it('產生非空字串', () => {
        const id = generateDeviceId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(5);
    });

    it('每次產生不同的 ID', () => {
        const id1 = generateDeviceId();
        const id2 = generateDeviceId();
        expect(id1).not.toBe(id2);
    });
});

describe('createEmptySyncState', () => {
    it('建立空白的初始同步狀態', () => {
        const state = createEmptySyncState('test-device');

        expect(state.favorites).toEqual([]);
        expect(state.groups).toEqual([]);
        expect(state.groupQueues).toEqual({});
        expect(state.groupCurrentDailyIds).toEqual({});
        expect(state._syncVersion).toBe(0);
        expect(state._deviceId).toBe('test-device');
    });
});

// ---------------------------------------------------------------------------
// 追加測試：邊界場景與壓力測試
// ---------------------------------------------------------------------------

describe('mergeStates — Tombstone TTL 邊界', () => {
    it('超過 7 天的 tombstone 會被永久清除', () => {
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        const old = makeFavorite('old-del', '很久前刪除', eightDaysAgo, true);

        const local = makeState({ favorites: [old] });
        const remote = makeState();

        const merged = mergeStates(local, remote);
        expect(merged.favorites.find(f => f.id === 'old-del')).toBeUndefined();
    });

    it('6 天內的 tombstone 不會被清除', () => {
        const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
        const recent = makeFavorite('recent-del', '最近刪除', sixDaysAgo, true);

        const local = makeState({ favorites: [recent] });
        const remote = makeState();

        const merged = mergeStates(local, remote);
        expect(merged.favorites.find(f => f.id === 'recent-del')).toBeDefined();
    });
});

describe('mergeStates — groupCurrentDailyIds 回退邏輯', () => {
    it('若選定的 currentDailyId 指向已刪除項目，fallback 到 queue[0]', () => {
        const recentTime = new Date().toISOString();
        const alive = makeFavorite('alive', '存活', recentTime, false);
        const dead = makeFavorite('dead', '已刪', recentTime, true);

        const local = makeState({
            favorites: [alive, dead],
            queue: ['alive', 'dead'],
            currentDailyId: 'dead',
            _syncVersion: 5,
        });
        const remote = makeState({ favorites: [alive], queue: ['alive'] });

        const merged = mergeStates(local, remote);
        // dead 被刪除後不在 queue 中，currentDailyId 應 fallback
        expect(getCurrentDailyId(merged)).toBe('alive');
    });
});

describe('mergeStates — lastUpdateDate 合併', () => {
    it('取本地與遠端中較新的日期字串', () => {
        const local = makeState({ lastUpdateDate: '2025-03-15' });
        const remote = makeState({ lastUpdateDate: '2025-03-13' });

        const merged = mergeStates(local, remote);
        expect(merged.lastUpdateDate).toBe('2025-03-15');
    });

    it('遠端較新時取遠端', () => {
        const local = makeState({ lastUpdateDate: '2025-03-10' });
        const remote = makeState({ lastUpdateDate: '2025-03-18' });

        const merged = mergeStates(local, remote);
        expect(merged.lastUpdateDate).toBe('2025-03-18');
    });
});

describe('mergeStates — 100 筆壓力測試', () => {
    it('能正確合併大批量餐廳', () => {
        const localItems: SyncableFavorite[] = [];
        const remoteItems: SyncableFavorite[] = [];

        // 50 筆本地專有 + 25 筆共有 + 25 筆遠端專有
        for (let i = 0; i < 50; i++) {
            localItems.push(makeFavorite(`local-${i}`, `本地 ${i}`, '2025-03-14T00:00:00Z'));
        }
        for (let i = 0; i < 25; i++) {
            localItems.push(makeFavorite(`shared-${i}`, `共有 ${i} (本地)`, '2025-03-14T12:00:00Z'));
            remoteItems.push(makeFavorite(`shared-${i}`, `共有 ${i} (遠端)`, '2025-03-14T06:00:00Z'));
        }
        for (let i = 0; i < 25; i++) {
            remoteItems.push(makeFavorite(`remote-${i}`, `遠端 ${i}`, '2025-03-14T00:00:00Z'));
        }

        const local = makeState({
            favorites: localItems,
            queue: localItems.map(f => f.id),
        });
        const remote = makeState({
            favorites: remoteItems,
            queue: remoteItems.map(f => f.id),
        });

        const merged = mergeStates(local, remote);

        expect(merged.favorites).toHaveLength(100);

        // 共有項目應取本地版（較新）
        for (let i = 0; i < 25; i++) {
            const item = merged.favorites.find(f => f.id === `shared-${i}`);
            expect(item?.name).toBe(`共有 ${i} (本地)`);
        }
    });
});

describe('mergeStates — Queue 附加新 ID', () => {
    it('合併時不在 baseQueue 中的新項目會被附加到末尾', () => {
        const items = [
            makeFavorite('a', 'A', '2025-03-14T00:00:00Z'),
            makeFavorite('b', 'B', '2025-03-14T00:00:00Z'),
        ];

        const local = makeState({
            favorites: [items[0]],
            queue: ['a'],
            _syncVersion: 2,
        });
        const remote = makeState({
            favorites: [items[1]],
            queue: ['b'],
            _syncVersion: 1,
        });

        const merged = mergeStates(local, remote);
        const q = getQueue(merged);

        expect(q).toContain('a');
        expect(q).toContain('b');
        // 'a' 在 baseQueue（local version 較高）中，'b' 是新增的，附加在後
        expect(q.indexOf('a')).toBeLessThan(q.indexOf('b'));
    });
});
