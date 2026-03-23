/**
 * favoriteExportImport 單元測試
 *
 * 驗證匯出入核心邏輯：
 *   1. buildExportData() 匯出 JSON 結構正確性
 *   2. parseAndValidateImport() 驗證邏輯完整性
 *   3. applyImportToStore() 正確覆蓋 store 狀態
 *
 * 注意：使用直接 require() 配合 jest.resetModules() 確保每個測試的 store 獨立
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiSet: jest.fn(() => Promise.resolve()),
}));

beforeEach(() => {
    jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
    const { useFavoriteStore } = require('../store/useFavoriteStore');
    return useFavoriteStore;
}

function getExportImport() {
    return require('../services/favoriteExportImport') as typeof import('../services/favoriteExportImport');
}

/** 建立一個包含測試資料的 store，回傳 store + exportImport */
function setupStoreWithData() {
    const store = getStore();
    const exportImport = getExportImport();

    // 新增測試餐廳
    store.getState().addFavorite('老王牛肉麵', '推薦紅燒', {
        address: '台北市中正區忠孝東路一段1號',
        category: '餐廳',
        placeId: 'ChIJ_test_001',
    });
    store.getState().addFavorite('美好咖啡', '拿鐵好喝');

    return { store, exportImport };
}

// ---------------------------------------------------------------------------
// Tests: buildExportData
// ---------------------------------------------------------------------------

describe('favoriteExportImport — buildExportData', () => {
    it('匯出 JSON 應包含所有必要欄位', () => {
        const { exportImport } = setupStoreWithData();

        const json = exportImport.buildExportData();
        const data = JSON.parse(json);

        expect(data._exportVersion).toBe(1);
        expect(data._exportedAt).toBeDefined();
        expect(Array.isArray(data.favorites)).toBe(true);
        expect(Array.isArray(data.groups)).toBe(true);
        expect(typeof data.activeGroupId).toBe('string');
        expect(typeof data.groupQueues).toBe('object');
        expect(typeof data.groupCurrentDailyIds).toBe('object');
        expect(data.lastUpdateDate).toBeDefined();
    });

    it('匯出的 favorites 應包含正確的餐廳資料', () => {
        const { exportImport } = setupStoreWithData();

        const json = exportImport.buildExportData();
        const data = JSON.parse(json);

        expect(data.favorites).toHaveLength(2);
        expect(data.favorites[0].name).toBe('老王牛肉麵');
        expect(data.favorites[0].note).toBe('推薦紅燒');
        expect(data.favorites[0].address).toBe('台北市中正區忠孝東路一段1號');
        expect(data.favorites[0].placeId).toBe('ChIJ_test_001');
        expect(data.favorites[1].name).toBe('美好咖啡');
    });

    it('匯出不應包含 sync metadata', () => {
        const { exportImport } = setupStoreWithData();

        const json = exportImport.buildExportData();
        const data = JSON.parse(json);

        expect(data._syncVersion).toBeUndefined();
        expect(data._deviceId).toBeUndefined();
        expect(data._lastSyncedAt).toBeUndefined();
        expect(data._deletedGroupIds).toBeUndefined();
        expect(data._deletedFavoriteIds).toBeUndefined();
    });

    it('匯出應包含至少一個群組', () => {
        const { exportImport } = setupStoreWithData();

        const json = exportImport.buildExportData();
        const data = JSON.parse(json);

        expect(data.groups.length).toBeGreaterThanOrEqual(1);
        expect(data.groups[0].id).toBeDefined();
        expect(data.groups[0].name).toBeDefined();
    });

    it('空餐廳清單時仍應正常匯出', () => {
        const exportImport = getExportImport();

        const json = exportImport.buildExportData();
        const data = JSON.parse(json);

        expect(data._exportVersion).toBe(1);
        expect(data.favorites).toHaveLength(0);
        expect(data.groups.length).toBeGreaterThanOrEqual(1); // 預設群組
    });
});

// ---------------------------------------------------------------------------
// Tests: buildExportFilename
// ---------------------------------------------------------------------------

describe('favoriteExportImport — buildExportFilename', () => {
    it('檔案名稱格式應為 how-to-eat-favorites-YYYY-MM-DD.json', () => {
        const exportImport = getExportImport();
        const filename = exportImport.buildExportFilename();

        expect(filename).toMatch(/^how-to-eat-favorites-\d{4}-\d{2}-\d{2}\.json$/);
    });
});

// ---------------------------------------------------------------------------
// Tests: parseAndValidateImport
// ---------------------------------------------------------------------------

describe('favoriteExportImport — parseAndValidateImport', () => {
    /** 產生合法的匯入 JSON 字串 */
    function buildValidJson(overrides: Record<string, unknown> = {}): string {
        return JSON.stringify({
            _exportVersion: 1,
            _exportedAt: new Date().toISOString(),
            favorites: [
                {
                    id: 'fav-1',
                    name: '測試餐廳',
                    groupId: 'grp-1',
                    createdAt: new Date().toISOString(),
                },
            ],
            groups: [
                {
                    id: 'grp-1',
                    name: '群組A',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
            activeGroupId: 'grp-1',
            groupQueues: { 'grp-1': ['fav-1'] },
            groupCurrentDailyIds: { 'grp-1': 'fav-1' },
            lastUpdateDate: '2026-03-23',
            ...overrides,
        });
    }

    it('應正確解析合法 JSON', () => {
        const exportImport = getExportImport();
        const result = exportImport.parseAndValidateImport(buildValidJson());

        expect(result._exportVersion).toBe(1);
        expect(result.favorites).toHaveLength(1);
        expect(result.groups).toHaveLength(1);
        expect(result.activeGroupId).toBe('grp-1');
    });

    it('應拒絕非 JSON 格式', () => {
        const exportImport = getExportImport();

        expect(() => exportImport.parseAndValidateImport('這不是 JSON'))
            .toThrow('不是有效的 JSON');
    });

    it('應拒絕 JSON array（預期 object）', () => {
        const exportImport = getExportImport();

        expect(() => exportImport.parseAndValidateImport('[1, 2, 3]'))
            .toThrow('預期為 JSON 物件');
    });

    it('應拒絕版本號不符', () => {
        const exportImport = getExportImport();

        expect(() => exportImport.parseAndValidateImport(buildValidJson({ _exportVersion: 99 })))
            .toThrow('版本不相容');
    });

    it('應拒絕缺少 _exportVersion', () => {
        const exportImport = getExportImport();
        const json = buildValidJson();
        const data = JSON.parse(json);
        delete data._exportVersion;

        expect(() => exportImport.parseAndValidateImport(JSON.stringify(data)))
            .toThrow('版本不相容');
    });

    it('應拒絕 favorites 非 array', () => {
        const exportImport = getExportImport();

        expect(() => exportImport.parseAndValidateImport(buildValidJson({ favorites: 'not-array' })))
            .toThrow('favorites');
    });

    it('應拒絕 groups 為空陣列', () => {
        const exportImport = getExportImport();

        expect(() => exportImport.parseAndValidateImport(buildValidJson({ groups: [] })))
            .toThrow('groups');
    });

    it('應拒絕餐廳缺少 id', () => {
        const exportImport = getExportImport();
        const json = buildValidJson({
            favorites: [{ name: '無ID餐廳', groupId: 'grp-1', createdAt: new Date().toISOString() }],
        });

        expect(() => exportImport.parseAndValidateImport(json))
            .toThrow('id');
    });

    it('應拒絕餐廳缺少 name', () => {
        const exportImport = getExportImport();
        const json = buildValidJson({
            favorites: [{ id: 'f-1', groupId: 'grp-1', createdAt: new Date().toISOString() }],
        });

        expect(() => exportImport.parseAndValidateImport(json))
            .toThrow('name');
    });

    it('應拒絕群組缺少 updatedAt', () => {
        const exportImport = getExportImport();
        const json = buildValidJson({
            groups: [{ id: 'g-1', name: '群組', createdAt: new Date().toISOString() }],
        });

        expect(() => exportImport.parseAndValidateImport(json))
            .toThrow('updatedAt');
    });

    it('空 favorites 陣列應通過驗證', () => {
        const exportImport = getExportImport();
        const result = exportImport.parseAndValidateImport(
            buildValidJson({ favorites: [] }),
        );

        expect(result.favorites).toHaveLength(0);
    });

    it('缺少 groupId 的餐廳應自動指派到第一個群組', () => {
        const exportImport = getExportImport();
        const json = buildValidJson({
            favorites: [
                {
                    id: 'orphan-1',
                    name: '孤兒餐廳A',
                    createdAt: new Date().toISOString(),
                    // 刻意不帶 groupId
                },
                {
                    id: 'orphan-2',
                    name: '孤兒餐廳B',
                    createdAt: new Date().toISOString(),
                },
                {
                    id: 'normal-1',
                    name: '正常餐廳',
                    groupId: 'grp-1',
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        const result = exportImport.parseAndValidateImport(json);

        // 孤兒餐廳應自動被指派到 grp-1（第一個群組）
        expect(result.favorites[0].groupId).toBe('grp-1');
        expect(result.favorites[1].groupId).toBe('grp-1');
        expect(result.favorites[2].groupId).toBe('grp-1');
    });

    it('孤兒餐廳應自動加入第一個群組的 queue', () => {
        const exportImport = getExportImport();
        const json = buildValidJson({
            favorites: [
                {
                    id: 'orphan-1',
                    name: '無群組餐廳',
                    createdAt: new Date().toISOString(),
                    // 無 groupId
                },
            ],
            groupQueues: { 'grp-1': ['fav-1'] },
        });

        const result = exportImport.parseAndValidateImport(json);

        // 原本 queue 有 fav-1，加上孤兒 orphan-1
        expect(result.groupQueues['grp-1']).toContain('fav-1');
        expect(result.groupQueues['grp-1']).toContain('orphan-1');
    });

    it('孤兒餐廳指派後，若群組缺少 currentDailyId 應自動設置', () => {
        const exportImport = getExportImport();
        const secondGroup = {
            id: 'grp-2',
            name: '群組B',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const json = buildValidJson({
            groups: [
                {
                    id: 'grp-1',
                    name: '群組A',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
                secondGroup,
            ],
            groupQueues: { 'grp-1': ['fav-1'] },
            groupCurrentDailyIds: { 'grp-1': 'fav-1' },
            // grp-2 沒有 queue 和 currentDailyId
        });

        const result = exportImport.parseAndValidateImport(json);

        // grp-2 應自動獲得空 queue 和 null currentDailyId
        expect(result.groupQueues['grp-2']).toEqual([]);
        expect(result.groupCurrentDailyIds['grp-2']).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Tests: applyImportToStore
// ---------------------------------------------------------------------------

describe('favoriteExportImport — applyImportToStore', () => {
    it('匯入後 store 應完全反映匯入資料', () => {
        const store = getStore();
        const exportImport = getExportImport();

        // 先新增一些現有資料
        store.getState().addFavorite('舊餐廳');
        expect(store.getState().favorites).toHaveLength(1);

        // 匯入新資料
        const importData = {
            _exportVersion: 1 as const,
            _exportedAt: new Date().toISOString(),
            favorites: [
                {
                    id: 'imported-1',
                    name: '匯入餐廳A',
                    groupId: 'import-group-1',
                    createdAt: new Date().toISOString(),
                },
                {
                    id: 'imported-2',
                    name: '匯入餐廳B',
                    note: '特色料理',
                    groupId: 'import-group-1',
                    createdAt: new Date().toISOString(),
                },
            ],
            groups: [
                {
                    id: 'import-group-1',
                    name: '匯入群組',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
            activeGroupId: 'import-group-1',
            groupQueues: { 'import-group-1': ['imported-1', 'imported-2'] },
            groupCurrentDailyIds: { 'import-group-1': 'imported-1' },
            lastUpdateDate: '2026-03-23',
        };

        exportImport.applyImportToStore(importData);

        const state = store.getState();
        expect(state.favorites).toHaveLength(2);
        expect(state.favorites[0].name).toBe('匯入餐廳A');
        expect(state.favorites[1].name).toBe('匯入餐廳B');
        expect(state.favorites[1].note).toBe('特色料理');
        expect(state.groups).toHaveLength(1);
        expect(state.groups[0].name).toBe('匯入群組');
        expect(state.activeGroupId).toBe('import-group-1');
    });

    it('匯入後應清空 tombstone', () => {
        const store = getStore();
        const exportImport = getExportImport();

        // 建立並刪除餐廳，產生 tombstone
        store.getState().addFavorite('即將刪除');
        const favId = store.getState().favorites[0].id;
        store.getState().removeFavorite(favId);
        expect(store.getState()._deletedFavoriteIds).toHaveLength(1);

        // 匯入覆蓋
        const importData = {
            _exportVersion: 1 as const,
            _exportedAt: new Date().toISOString(),
            favorites: [],
            groups: [
                {
                    id: 'clean-group',
                    name: '乾淨群組',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
            activeGroupId: 'clean-group',
            groupQueues: { 'clean-group': [] },
            groupCurrentDailyIds: { 'clean-group': null },
            lastUpdateDate: '',
        };

        exportImport.applyImportToStore(importData);

        const state = store.getState();
        expect(state._deletedFavoriteIds).toHaveLength(0);
        expect(state._deletedGroupIds).toHaveLength(0);
    });

    it('匯出後匯入應還原完全相同的資料', () => {
        const store = getStore();
        const exportImport = getExportImport();

        // 建立測試資料
        store.getState().addFavorite('圓環邊', '蚵仔煎', {
            address: '台北市大同區寧夏路',
            placeId: 'ChIJ_round',
        });
        store.getState().addFavorite('林東芳牛肉麵');

        // 匯出
        const json = exportImport.buildExportData();
        const originalState = store.getState();

        // 清空 store（模擬另一台裝置）
        store.setState({ favorites: [], groups: originalState.groups });

        // 匯入
        const parsed = exportImport.parseAndValidateImport(json);
        exportImport.applyImportToStore(parsed);

        const restoredState = store.getState();
        expect(restoredState.favorites).toHaveLength(2);
        expect(restoredState.favorites[0].name).toBe('圓環邊');
        expect(restoredState.favorites[0].note).toBe('蚵仔煎');
        expect(restoredState.favorites[0].address).toBe('台北市大同區寧夏路');
        expect(restoredState.favorites[1].name).toBe('林東芳牛肉麵');
    });
});

// ---------------------------------------------------------------------------
// Tests: 匯出時 groupId 回填
// ---------------------------------------------------------------------------

describe('favoriteExportImport — Export groupId 回填', () => {
    it('匯出時應為缺少 groupId 的餐廳回填 activeGroupId', () => {
        const store = getStore();
        const exportImport = getExportImport();

        // 取得預設群組 ID
        const defaultGroupId = store.getState().activeGroupId;

        // 強制插入一筆沒有 groupId 的歷史資料（模擬 migration 前狀態）
        store.setState({
            favorites: [
                {
                    id: 'legacy-1',
                    name: '古老餐廳',
                    createdAt: new Date().toISOString(),
                    // 刻意不帶 groupId
                },
            ],
        });

        const json = exportImport.buildExportData();
        const data = JSON.parse(json);

        // 匯出時 groupId 應被回填
        expect(data.favorites[0].groupId).toBe(defaultGroupId);
    });

    it('匯出時回填的餐廳應出現在對應群組的 queue 中', () => {
        const store = getStore();
        const exportImport = getExportImport();

        const defaultGroupId = store.getState().activeGroupId;

        // 插入沒有 groupId 的歷史資料，且不在任何 queue 中
        store.setState({
            favorites: [
                {
                    id: 'legacy-orphan',
                    name: '孤兒歷史餐廳',
                    createdAt: new Date().toISOString(),
                },
            ],
            groupQueues: { [defaultGroupId]: [] },
        });

        const json = exportImport.buildExportData();
        const data = JSON.parse(json);

        expect(data.groupQueues[defaultGroupId]).toContain('legacy-orphan');
    });

    it('匯出含 groupId 的餐廳不受影響', () => {
        const store = getStore();
        const exportImport = getExportImport();

        // 正常新增餐廳（會自動帶 groupId）
        store.getState().addFavorite('正常餐廳');
        const fav = store.getState().favorites[0];

        const json = exportImport.buildExportData();
        const data = JSON.parse(json);

        expect(data.favorites[0].groupId).toBe(fav.groupId);
    });
});

// ---------------------------------------------------------------------------
// Tests: 完整 roundtrip（含孤兒餐廳）
// ---------------------------------------------------------------------------

describe('favoriteExportImport — Roundtrip 含孤兒餐廳', () => {
    it('含孤兒餐廳的匯出檔案應能成功匯入', () => {
        const store = getStore();
        const exportImport = getExportImport();

        const defaultGroupId = store.getState().activeGroupId;

        // 模擬含孤兒的 store 狀態
        store.setState({
            favorites: [
                {
                    id: 'orphan-rt-1',
                    name: '孤兒 Roundtrip 餐廳',
                    createdAt: new Date().toISOString(),
                    // 無 groupId
                },
                {
                    id: 'normal-rt-1',
                    name: '正常 Roundtrip 餐廳',
                    groupId: defaultGroupId,
                    createdAt: new Date().toISOString(),
                },
            ],
            groupQueues: { [defaultGroupId]: ['normal-rt-1'] },
            groupCurrentDailyIds: { [defaultGroupId]: 'normal-rt-1' },
        });

        // 匯出 → 解析 → 匯入
        const json = exportImport.buildExportData();
        const parsed = exportImport.parseAndValidateImport(json);
        exportImport.applyImportToStore(parsed);

        const state = store.getState();
        expect(state.favorites).toHaveLength(2);
        expect(state.favorites.every((f: { groupId: string }) => f.groupId === defaultGroupId)).toBe(true);
        expect(state.groupQueues[defaultGroupId]).toContain('orphan-rt-1');
        expect(state.groupQueues[defaultGroupId]).toContain('normal-rt-1');
    });
});
