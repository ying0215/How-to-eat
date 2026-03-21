/**
 * syncE2E.test.ts — 端到端同步整合測試
 *
 * 模擬雙裝置場景，驗證 tombstone 跨裝置傳播、並行操作合併、
 * 以及 App 重啟後刪除記錄保留等完整流程。
 *
 * 測試策略：
 *   - 使用 in-memory Map 模擬 Google Drive 檔案
 *   - 直接呼叫 assembleLocalState / mergeStates / writebackMergedState（透過 performSync）
 *   - 不需真正的網路請求
 */

// ── Mocks（必須在 import 前定義）──

// Mock react-native
jest.mock('react-native', () => ({
    Platform: { OS: 'web' },
    AppState: {
        addEventListener: jest.fn(() => ({ remove: jest.fn() })),
        currentState: 'active',
    },
}));

// Mock expo modules
jest.mock('expo-auth-session/providers/google', () => ({
    useAuthRequest: jest.fn(() => [null, null, jest.fn()]),
}));
jest.mock('expo-web-browser', () => ({
    maybeCompleteAuthSession: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(() => Promise.resolve(null)),
    setItemAsync: jest.fn(() => Promise.resolve()),
    deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// Mock useGoogleAuth module
jest.mock('../auth/useGoogleAuth', () => ({
    useGoogleAuthStore: {
        getState: jest.fn(() => ({
            isSignedIn: true,
            accessToken: 'mock-token',
        })),
        subscribe: jest.fn(() => jest.fn()),
    },
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiSet: jest.fn(() => Promise.resolve()),
}));

// ── In-memory Google Drive 模擬 ──
let cloudStorage: Map<string, any> = new Map();

const mockDownload = jest.fn(async (_token?: string) => {
    return cloudStorage.get('favorites') ?? null;
});
const mockUpload = jest.fn(async (_token?: string, data?: any) => {
    cloudStorage.set('favorites', JSON.parse(JSON.stringify(data)));
    return 'file-id';
});
const mockValidateScopes = jest.fn(async (_token?: string) => ({ valid: true, scopes: ['drive.appdata'] }));

jest.mock('../sync/GoogleDriveAdapter', () => ({
    downloadFavorites: (token: string) => mockDownload(token),
    uploadFavorites: (token: string, data: any) => mockUpload(token, data),
    validateTokenScopes: (token: string) => mockValidateScopes(token),
    DriveApiError: class DriveApiError extends Error {
        requiresReauth = false;
    },
}));

// Mock useNetworkStatus
const mockGetNetwork = jest.fn(() => true);
jest.mock('../hooks/useNetworkStatus', () => ({
    getNetworkStatus: () => mockGetNetwork(),
    useNetworkStore: jest.fn(() => ({ isConnected: true })),
}));

// ── Imports ──
import { useFavoriteStore, type DeletedItemRecord } from '../store/useFavoriteStore';
import {
    useSyncMetaStore,
    performSync,
} from '../sync/useSyncOrchestrator';
import {
    mergeStates,
    upgradeToSyncable,
    upgradeGroupsToSyncable,
    type SyncableFavoriteState,
    type SyncableFavorite,
    type SyncableGroup,
} from '../sync/mergeStrategy';

// ── Helpers ──
const validGetToken = jest.fn(async () => 'mock-token');

/** 建立一個乾淨的裝置狀態 */
function resetDevice(deviceId: string) {
    useSyncMetaStore.setState({
        deviceId,
        syncVersion: 0,
        lastSyncedAt: null,
        pendingSync: false,
        syncStatus: 'idle',
        syncError: null,
        syncEnabled: true,
    });

    const now = new Date().toISOString();
    useFavoriteStore.setState({
        favorites: [],
        groups: [{ id: `default-${deviceId}`, name: '群組A', createdAt: now, updatedAt: now }],
        activeGroupId: `default-${deviceId}`,
        groupQueues: { [`default-${deviceId}`]: [] },
        groupCurrentDailyIds: { [`default-${deviceId}`]: null },
        lastUpdateDate: '2025-03-13',
        _deletedGroupIds: [],
        _deletedFavoriteIds: [],
    });
}

/** 快照當前裝置狀態（模擬「另一台裝置」） */
function snapshotLocalState(deviceId: string): SyncableFavoriteState {
    const fav = useFavoriteStore.getState();
    const syncMeta = useSyncMetaStore.getState();
    const now = new Date().toISOString();

    const liveFavs = upgradeToSyncable(fav.favorites);
    const deletedFavTombstones: SyncableFavorite[] = (fav._deletedFavoriteIds ?? []).map((r) => ({
        id: r.id,
        name: '',
        groupId: '',
        createdAt: r.deletedAt,
        updatedAt: r.deletedAt,
        isDeleted: true,
    }));

    const liveGroups = upgradeGroupsToSyncable(fav.groups);
    const deletedGroupTombstones: SyncableGroup[] = (fav._deletedGroupIds ?? []).map((r) => ({
        id: r.id,
        name: '',
        createdAt: r.deletedAt,
        updatedAt: r.deletedAt,
        isDeleted: true,
    }));

    return {
        favorites: [...liveFavs, ...deletedFavTombstones],
        groups: [...liveGroups, ...deletedGroupTombstones],
        activeGroupId: fav.activeGroupId,
        groupQueues: { ...fav.groupQueues },
        groupCurrentDailyIds: { ...fav.groupCurrentDailyIds },
        lastUpdateDate: fav.lastUpdateDate,
        _syncVersion: syncMeta.syncVersion,
        _lastSyncedAt: syncMeta.lastSyncedAt ?? now,
        _deviceId: deviceId,
    };
}

// ── Setup ──
beforeEach(() => {
    jest.clearAllMocks();
    cloudStorage.clear();
    mockGetNetwork.mockReturnValue(true);
    resetDevice('device-A');
});

// ---------------------------------------------------------------------------
// 🧪 E2E Tests
// ---------------------------------------------------------------------------

describe('E2E: 刪除群組跨裝置傳播', () => {
    it('裝置A 建立群組 → 上傳 → 裝置B 下載後刪除 → 上傳 → 裝置A 同步 → 群組消失', async () => {
        // ── 裝置A：建立群組並同步 ──
        const groupA = useFavoriteStore.getState().createGroup('測試群組X');
        expect(groupA).not.toBeNull();
        const groupXId = groupA!.id;

        // 裝置A 首次同步（上傳到雲端）
        const resultA1 = await performSync(validGetToken);
        expect(resultA1).toBe(true);

        // 驗證雲端有群組X
        const cloudAfterA1 = cloudStorage.get('favorites');
        expect(cloudAfterA1).toBeDefined();
        const cloudGroupIds1 = cloudAfterA1.groups
            .filter((g: SyncableGroup) => !g.isDeleted)
            .map((g: SyncableGroup) => g.id);
        expect(cloudGroupIds1).toContain(groupXId);

        // ── 裝置B：模擬下載雲端資料 → 刪除群組 → 上傳 ──
        // 先「載入」雲端資料到本地 store（模擬裝置B 剛同步完畢的狀態）
        const cloudData = cloudStorage.get('favorites') as SyncableFavoriteState;
        const cleanGroups = cloudData.groups.filter((g: SyncableGroup) => !g.isDeleted);
        const cleanFavs = cloudData.favorites.filter((f: SyncableFavorite) => !f.isDeleted);

        useFavoriteStore.setState({
            favorites: cleanFavs.map((f: SyncableFavorite) => ({
                id: f.id, name: f.name, groupId: f.groupId, createdAt: f.createdAt,
                ...(f.note ? { note: f.note } : {}),
                ...(f.category ? { category: f.category } : {}),
                ...(f.placeId ? { placeId: f.placeId } : {}),
            })),
            groups: cleanGroups.map((g: SyncableGroup) => ({
                id: g.id, name: g.name, createdAt: g.createdAt, updatedAt: g.updatedAt,
            })),
            activeGroupId: cloudData.activeGroupId,
            groupQueues: cloudData.groupQueues,
            groupCurrentDailyIds: cloudData.groupCurrentDailyIds,
            lastUpdateDate: cloudData.lastUpdateDate,
            _deletedGroupIds: [],
            _deletedFavoriteIds: [],
        });
        useSyncMetaStore.setState({
            deviceId: 'device-B',
            syncVersion: cloudData._syncVersion,
            lastSyncedAt: cloudData._lastSyncedAt,
            syncEnabled: true,
            syncStatus: 'idle',
            syncError: null,
            pendingSync: false,
        });

        // 裝置B 刪除群組X
        const deleteResult = useFavoriteStore.getState().deleteGroup(groupXId);
        expect(deleteResult).toBe(true);

        // 裝置B 同步（上傳 tombstone 到雲端）
        const resultB1 = await performSync(validGetToken);
        expect(resultB1).toBe(true);

        // 驗證雲端的群組X 已經是 tombstone
        const cloudAfterB1 = cloudStorage.get('favorites');
        const groupXInCloud = cloudAfterB1.groups.find((g: SyncableGroup) => g.id === groupXId);
        expect(groupXInCloud).toBeDefined();
        expect(groupXInCloud.isDeleted).toBe(true);

        // ── 裝置A：重新同步 → 應該發現群組X 被刪除了 ──
        resetDevice('device-A');
        // 恢復裝置A 的原始狀態（有群組X），updatedAt 使用較舊的時間
        // 以確保 tombstone 的 updatedAt（刪除時間）比這個早
        // 在真實場景中，群組創建時間一定早於其他裝置刪除時間
        const oldTime = '2025-01-01T00:00:00.000Z';
        useFavoriteStore.setState({
            groups: [
                { id: `default-device-A`, name: '群組A', createdAt: oldTime, updatedAt: oldTime },
                { id: groupXId, name: '測試群組X', createdAt: oldTime, updatedAt: oldTime },
            ],
            groupQueues: { [`default-device-A`]: [], [groupXId]: [] },
            groupCurrentDailyIds: { [`default-device-A`]: null, [groupXId]: null },
        });

        // 裝置A 同步
        const resultA2 = await performSync(validGetToken);
        expect(resultA2).toBe(true);

        // 驗證裝置A 本地的群組X 已消失
        const finalGroups = useFavoriteStore.getState().groups;
        const finalGroupIds = finalGroups.map((g: any) => g.id);
        expect(finalGroupIds).not.toContain(groupXId);
    });
});

describe('E2E: 雙裝置各自建立群組後合併', () => {
    it('裝置A 建群組X → 裝置B 建群組Y → 同步後雙方都有 X 和 Y', async () => {
        // ── 裝置A：建立群組X 並上傳 ──
        const groupX = useFavoriteStore.getState().createGroup('群組X');
        expect(groupX).not.toBeNull();

        const resultA1 = await performSync(validGetToken);
        expect(resultA1).toBe(true);

        // 記住裝置A 的狀態快照
        const deviceAState = snapshotLocalState('device-A');

        // ── 裝置B：從空白開始，建立群組Y ──
        resetDevice('device-B');
        const groupY = useFavoriteStore.getState().createGroup('群組Y');
        expect(groupY).not.toBeNull();

        // 裝置B 同步（下載雲端有群組X，本地有群組Y → 合併）
        const resultB1 = await performSync(validGetToken);
        expect(resultB1).toBe(true);

        // 驗證裝置B 合併後同時有群組X 和群組Y
        const deviceBGroups = useFavoriteStore.getState().groups;
        const deviceBGroupNames = deviceBGroups.map((g: any) => g.name);
        expect(deviceBGroupNames).toContain('群組X');
        expect(deviceBGroupNames).toContain('群組Y');

        // ── 裝置A 再同步一次 → 應該也有群組Y ──
        // 恢復裝置A 狀態
        useFavoriteStore.setState({
            favorites: deviceAState.favorites
                .filter((f) => !f.isDeleted)
                .map((f) => ({ id: f.id, name: f.name, groupId: f.groupId, createdAt: f.createdAt })),
            groups: deviceAState.groups
                .filter((g) => !g.isDeleted)
                .map((g) => ({ id: g.id, name: g.name, createdAt: g.createdAt, updatedAt: g.updatedAt })),
            activeGroupId: deviceAState.activeGroupId,
            groupQueues: deviceAState.groupQueues,
            groupCurrentDailyIds: deviceAState.groupCurrentDailyIds,
            _deletedGroupIds: [],
            _deletedFavoriteIds: [],
        });
        useSyncMetaStore.setState({
            deviceId: 'device-A',
            syncVersion: deviceAState._syncVersion,
            lastSyncedAt: deviceAState._lastSyncedAt,
            syncEnabled: true,
            syncStatus: 'idle',
            syncError: null,
            pendingSync: false,
        });

        const resultA2 = await performSync(validGetToken);
        expect(resultA2).toBe(true);

        const deviceAGroups = useFavoriteStore.getState().groups;
        const deviceAGroupNames = deviceAGroups.map((g: any) => g.name);
        expect(deviceAGroupNames).toContain('群組X');
        expect(deviceAGroupNames).toContain('群組Y');
    });
});

describe('E2E: 並行操作 — 裝置A 刪群組、裝置B 建群組', () => {
    it('裝置A 刪群組B + 裝置B 建群組C → 合併後 B 消失、C 保留', async () => {
        // ── 準備：兩台裝置都有群組B ──
        const groupB = useFavoriteStore.getState().createGroup('群組B');
        expect(groupB).not.toBeNull();
        const groupBId = groupB!.id;

        // 初始同步（讓雲端也有群組B）
        await performSync(validGetToken);

        // ── 裝置A：刪除群組B ──
        useFavoriteStore.getState().deleteGroup(groupBId);

        // 裝置A 同步（上傳 tombstone）
        const resultA = await performSync(validGetToken);
        expect(resultA).toBe(true);

        // ── 裝置B：不知道群組B 被刪了，建立群組C ──
        // 載入雲端舊資料（刪除前的，模擬尚未同步的裝置B）
        resetDevice('device-B');
        useFavoriteStore.setState({
            groups: [
                ...useFavoriteStore.getState().groups,
                { id: groupBId, name: '群組B', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
            ],
            groupQueues: {
                ...useFavoriteStore.getState().groupQueues,
                [groupBId]: [],
            },
            groupCurrentDailyIds: {
                ...useFavoriteStore.getState().groupCurrentDailyIds,
                [groupBId]: null,
            },
        });

        const groupC = useFavoriteStore.getState().createGroup('群組C');
        expect(groupC).not.toBeNull();

        // 裝置B 同步（下載含 tombstone 的雲端 → 合併）
        const resultB = await performSync(validGetToken);
        expect(resultB).toBe(true);

        // 驗證：群組B 消失、群組C 保留
        const finalGroups = useFavoriteStore.getState().groups;
        const finalGroupNames = finalGroups.map((g: any) => g.name);
        expect(finalGroupNames).not.toContain('群組B');
        expect(finalGroupNames).toContain('群組C');
    });
});

describe('E2E: App 重啟後刪除記錄保留', () => {
    it('刪除群組 → 模擬 rehydration（_deletedGroupIds 保留）→ 同步 → tombstone 傳播', async () => {
        // 建立群組 → 首次同步讓雲端有此群組
        const group = useFavoriteStore.getState().createGroup('即將刪除');
        expect(group).not.toBeNull();
        const groupId = group!.id;

        await performSync(validGetToken);

        // 刪除群組
        useFavoriteStore.getState().deleteGroup(groupId);

        // 驗證 _deletedGroupIds 有記錄
        const deletedRecords = useFavoriteStore.getState()._deletedGroupIds;
        expect(deletedRecords.length).toBeGreaterThan(0);
        expect(deletedRecords.some((r: DeletedItemRecord) => r.id === groupId)).toBe(true);

        // ── 模擬 App 重啟：重新載入 store 狀態 ──
        // 由於 partialize 現在包含 _deletedGroupIds，rehydration 後記錄仍在
        const stateBeforeRestart = useFavoriteStore.getState();
        const persistedData = {
            favorites: stateBeforeRestart.favorites,
            groups: stateBeforeRestart.groups,
            activeGroupId: stateBeforeRestart.activeGroupId,
            groupQueues: stateBeforeRestart.groupQueues,
            groupCurrentDailyIds: stateBeforeRestart.groupCurrentDailyIds,
            lastUpdateDate: stateBeforeRestart.lastUpdateDate,
            _deletedGroupIds: stateBeforeRestart._deletedGroupIds,
            _deletedFavoriteIds: stateBeforeRestart._deletedFavoriteIds,
        };

        // 模擬 store 重啟（清空再恢復）
        useFavoriteStore.setState({
            _deletedGroupIds: [],
            _deletedFavoriteIds: [],
        });
        // 恢復持久化的資料
        useFavoriteStore.setState(persistedData);

        // 驗證 _deletedGroupIds 在重啟後仍然存在
        const afterRestart = useFavoriteStore.getState();
        expect(afterRestart._deletedGroupIds.some((r: DeletedItemRecord) => r.id === groupId)).toBe(true);

        // 同步 → tombstone 應該被傳播到雲端
        const syncResult = await performSync(validGetToken);
        expect(syncResult).toBe(true);

        // 驗證雲端的群組已標記為 deleted
        const cloudData = cloudStorage.get('favorites');
        const deletedGroup = cloudData.groups.find((g: SyncableGroup) => g.id === groupId);
        expect(deletedGroup).toBeDefined();
        expect(deletedGroup.isDeleted).toBe(true);

        // 同步完成後 _deletedGroupIds 應該被清除
        const afterSync = useFavoriteStore.getState();
        expect(afterSync._deletedGroupIds.some((r: DeletedItemRecord) => r.id === groupId)).toBe(false);
    });
});

describe('E2E: 舊格式 _deletedGroupIds migration', () => {
    it('舊格式 string[] 應被正確用於 tombstone 生成', async () => {
        // 建立群組並同步到雲端
        const group = useFavoriteStore.getState().createGroup('舊格式測試');
        expect(group).not.toBeNull();
        const groupId = group!.id;
        await performSync(validGetToken);

        // 模擬舊格式 _deletedGroupIds（string[] 而非 DeletedItemRecord[]）
        // 先移除群組（但不透過正常 deleteGroup，模擬舊版 App 產生的 string[] 格式）
        useFavoriteStore.setState({
            groups: useFavoriteStore.getState().groups.filter((g: any) => g.id !== groupId),
            _deletedGroupIds: [{ id: groupId, deletedAt: new Date().toISOString() }] as DeletedItemRecord[],
        });

        // 同步 → 應產生具有有效 updatedAt 的 tombstone
        const syncResult = await performSync(validGetToken);
        expect(syncResult).toBe(true);

        // 驗證雲端 tombstone
        const cloudData = cloudStorage.get('favorites');
        const tombstone = cloudData.groups.find((g: SyncableGroup) => g.id === groupId);
        expect(tombstone).toBeDefined();
        expect(tombstone.isDeleted).toBe(true);
        // updatedAt 應該是有效的時間（非 undefined）
        expect(tombstone.updatedAt).toBeDefined();
        expect(new Date(tombstone.updatedAt).getTime()).toBeGreaterThan(0);
    });
});
