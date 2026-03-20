/**
 * useSyncOrchestrator 單元測試
 *
 * 驗證核心同步邏輯 performSync 和 pullFromCloud 的行為。
 * 由於 useSyncOrchestrator 是 React Hook，此處只測試非 Hook 的核心函式。
 *
 * Mock 對象：
 *   - GoogleDriveAdapter（避免真實 API 呼叫）
 *   - useFavoriteStore（提供可控的本地狀態）
 *   - useGoogleAuthStore（提供 mock token）
 *   - AsyncStorage
 *   - react-native（避免 ESM import 錯誤）
 */

// Mock react-native to avoid ESM import errors in Jest
jest.mock('react-native', () => ({
    Platform: { OS: 'web' },
    AppState: {
        addEventListener: jest.fn(() => ({ remove: jest.fn() })),
        currentState: 'active',
    },
}));

// Mock expo modules to avoid native module errors
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

// Mock GoogleDriveAdapter
jest.mock('../sync/GoogleDriveAdapter', () => ({
    downloadFavorites: jest.fn(),
    uploadFavorites: jest.fn(),
    DriveApiError: class DriveApiError extends Error {
        constructor(
            message: string,
            public readonly statusCode: number,
            public readonly retryable: boolean,
        ) {
            super(message);
            this.name = 'DriveApiError';
        }
    },
}));

// Mock useNetworkStatus
jest.mock('../hooks/useNetworkStatus', () => ({
    getNetworkStatus: jest.fn(() => true),
    useNetworkStore: {
        getState: jest.fn(() => ({ isConnected: true })),
        subscribe: jest.fn(() => jest.fn()),
    },
}));

import { performSync, pullFromCloud, useSyncMetaStore } from '../sync/useSyncOrchestrator';
import { useFavoriteStore } from '../store/useFavoriteStore';
import { downloadFavorites, uploadFavorites, DriveApiError } from '../sync/GoogleDriveAdapter';
import { getNetworkStatus } from '../hooks/useNetworkStatus';
import type { SyncableFavoriteState } from '../sync/mergeStrategy';

const mockDownload = downloadFavorites as jest.MockedFunction<typeof downloadFavorites>;
const mockUpload = uploadFavorites as jest.MockedFunction<typeof uploadFavorites>;
const mockGetNetwork = getNetworkStatus as jest.MockedFunction<typeof getNetworkStatus>;

// ---------------------------------------------------------------------------
// 測試用的 getToken 函式
// ---------------------------------------------------------------------------

const validGetToken = jest.fn().mockResolvedValue('valid-access-token');
const nullGetToken = jest.fn().mockResolvedValue(null);

// ---------------------------------------------------------------------------
// 測試前重置
// ---------------------------------------------------------------------------

beforeEach(() => {
    jest.clearAllMocks();
    mockGetNetwork.mockReturnValue(true);

    // 重置 Zustand stores
    useSyncMetaStore.setState({
        deviceId: 'test-device',
        syncVersion: 0,
        lastSyncedAt: null,
        pendingSync: false,
        syncStatus: 'idle',
        syncError: null,
        syncEnabled: true,
    });

    useFavoriteStore.setState({
        favorites: [
            { id: 'r1', name: '老王牛肉麵', createdAt: '2025-01-01T00:00:00Z' },
        ],
        queue: ['r1'],
        currentDailyId: 'r1',
        lastUpdateDate: '2025-03-13',
    });
});

// ---------------------------------------------------------------------------
// Tests: performSync
// ---------------------------------------------------------------------------

describe('performSync — 前置檢查', () => {
    it('syncEnabled 為 false 時不執行同步', async () => {
        useSyncMetaStore.setState({ syncEnabled: false });

        const result = await performSync(validGetToken);

        expect(result).toBe(false);
        expect(validGetToken).not.toHaveBeenCalled();
    });

    it('正在同步中時不重複觸發', async () => {
        useSyncMetaStore.setState({ syncStatus: 'syncing' });

        const result = await performSync(validGetToken);

        expect(result).toBe(false);
    });

    it('離線時不執行同步，標記 pendingSync', async () => {
        mockGetNetwork.mockReturnValue(false);

        const result = await performSync(validGetToken);

        expect(result).toBe(false);
        const meta = useSyncMetaStore.getState();
        expect(meta.pendingSync).toBe(true);
        expect(meta.syncStatus).toBe('offline');
    });

    it('token 為 null 時設定錯誤訊息', async () => {
        const result = await performSync(nullGetToken);

        expect(result).toBe(false);
        expect(useSyncMetaStore.getState().syncError).toContain('Google');
    });
});

describe('performSync — 首次同步（雲端無資料）', () => {
    it('直接上傳本地資料', async () => {
        mockDownload.mockResolvedValue(null);
        mockUpload.mockResolvedValue('new-file-id');

        const result = await performSync(validGetToken);

        expect(result).toBe(true);
        expect(mockDownload).toHaveBeenCalledWith('valid-access-token');
        expect(mockUpload).toHaveBeenCalledWith('valid-access-token', expect.objectContaining({
            favorites: expect.arrayContaining([
                expect.objectContaining({ id: 'r1', name: '老王牛肉麵' }),
            ]),
        }));

        const meta = useSyncMetaStore.getState();
        expect(meta.syncStatus).toBe('success');
        expect(meta.syncVersion).toBeGreaterThan(0);
        expect(meta.pendingSync).toBe(false);
    });
});

describe('performSync — 雙向合併', () => {
    it('將遠端資料合併到本地', async () => {
        // 遠端有一筆不同的餐廳
        const remoteState: SyncableFavoriteState = {
            favorites: [
                {
                    id: 'remote-1',
                    name: '遠端餐廳',
                    createdAt: '2025-02-01T00:00:00Z',
                    updatedAt: '2025-03-13T00:00:00Z',
                    isDeleted: false,
                },
            ],
            queue: ['remote-1'],
            currentDailyId: 'remote-1',
            lastUpdateDate: '2025-03-13',
            _syncVersion: 3,
            _lastSyncedAt: '2025-03-13T12:00:00Z',
            _deviceId: 'other-device',
        };

        mockDownload.mockResolvedValue(remoteState);
        mockUpload.mockResolvedValue('file-id');

        const result = await performSync(validGetToken);

        expect(result).toBe(true);

        // 合併後本地應同時有 r1(本地) 和 remote-1(遠端)
        const favStore = useFavoriteStore.getState();
        expect(favStore.favorites).toHaveLength(2);
        expect(favStore.favorites.map(f => f.name)).toContain('老王牛肉麵');
        expect(favStore.favorites.map(f => f.name)).toContain('遠端餐廳');
    });
});

describe('performSync — 錯誤處理', () => {
    it('Drive API 可重試錯誤時保留 pendingSync', async () => {
        const retryableError = new (DriveApiError as jest.MockedClass<typeof DriveApiError>)(
            'Server error',
            500,
            true,
        );
        mockDownload.mockRejectedValue(retryableError);

        const result = await performSync(validGetToken);

        expect(result).toBe(false);
        expect(useSyncMetaStore.getState().syncError).toContain('Drive API');
        expect(useSyncMetaStore.getState().pendingSync).toBe(true);
    });

    it('Drive API 不可重試錯誤時不保留 pendingSync', async () => {
        const nonRetryableError = new (DriveApiError as jest.MockedClass<typeof DriveApiError>)(
            'Unauthorized',
            401,
            false,
        );
        mockDownload.mockRejectedValue(nonRetryableError);

        const result = await performSync(validGetToken);

        expect(result).toBe(false);
        expect(useSyncMetaStore.getState().syncError).toContain('Drive API');
        // pendingSync 不應該被設定（已經在 beforeEach 中設為 false）
        expect(useSyncMetaStore.getState().pendingSync).toBe(false);
    });

    it('非 DriveApiError 也能正確處理', async () => {
        mockDownload.mockRejectedValue(new Error('Unknown error'));

        const result = await performSync(validGetToken);

        expect(result).toBe(false);
        expect(useSyncMetaStore.getState().syncError).toBe('Unknown error');
    });
});

// ---------------------------------------------------------------------------
// Tests: pullFromCloud
// ---------------------------------------------------------------------------

describe('pullFromCloud', () => {
    it('成功從雲端拉取並覆蓋本地', async () => {
        const remoteState: SyncableFavoriteState = {
            favorites: [
                {
                    id: 'cloud-only',
                    name: '雲端餐廳',
                    createdAt: '2025-02-01T00:00:00Z',
                    updatedAt: '2025-03-13T00:00:00Z',
                    isDeleted: false,
                },
            ],
            queue: ['cloud-only'],
            currentDailyId: 'cloud-only',
            lastUpdateDate: '2025-03-13',
            _syncVersion: 10,
            _lastSyncedAt: '2025-03-13T12:00:00Z',
            _deviceId: 'cloud-device',
        };

        mockDownload.mockResolvedValue(remoteState);

        const result = await pullFromCloud(validGetToken);

        expect(result).toBe(true);

        const favStore = useFavoriteStore.getState();
        // 應該只有雲端的資料（覆蓋了本地的 r1）
        expect(favStore.favorites).toHaveLength(1);
        expect(favStore.favorites[0].name).toBe('雲端餐廳');
    });

    it('雲端無資料時回傳 false', async () => {
        mockDownload.mockResolvedValue(null);

        const result = await pullFromCloud(validGetToken);

        expect(result).toBe(false);
        expect(useSyncMetaStore.getState().syncError).toContain('雲端');
    });

    it('token 為 null 時回傳 false', async () => {
        const result = await pullFromCloud(nullGetToken);
        expect(result).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Tests: SyncMetaStore 狀態管理
// ---------------------------------------------------------------------------

describe('useSyncMetaStore — 狀態轉換', () => {
    it('_markPending 設定 pendingSync = true', () => {
        useSyncMetaStore.getState()._markPending();
        expect(useSyncMetaStore.getState().pendingSync).toBe(true);
    });

    it('_setSyncing 設定 syncStatus 為 syncing', () => {
        useSyncMetaStore.getState()._setSyncing();
        expect(useSyncMetaStore.getState().syncStatus).toBe('syncing');
        expect(useSyncMetaStore.getState().syncError).toBeNull();
    });

    it('_setSyncSuccess 更新 version + 清除 pending + 設定 success', () => {
        useSyncMetaStore.setState({ pendingSync: true });
        useSyncMetaStore.getState()._setSyncSuccess(42);

        const state = useSyncMetaStore.getState();
        expect(state.syncStatus).toBe('success');
        expect(state.syncVersion).toBe(42);
        expect(state.pendingSync).toBe(false);
        expect(state.lastSyncedAt).toBeDefined();
    });

    it('_setSyncError 設定錯誤訊息', () => {
        useSyncMetaStore.getState()._setSyncError('Something went wrong');

        const state = useSyncMetaStore.getState();
        expect(state.syncStatus).toBe('error');
        expect(state.syncError).toBe('Something went wrong');
    });

    it('_setSyncEnabled 控制同步開關', () => {
        useSyncMetaStore.getState()._setSyncEnabled(false);
        expect(useSyncMetaStore.getState().syncEnabled).toBe(false);

        useSyncMetaStore.getState()._setSyncEnabled(true);
        expect(useSyncMetaStore.getState().syncEnabled).toBe(true);
    });
});
