/**
 * GoogleDriveAdapter 單元測試
 *
 * 使用 jest.fn() mock fetch 驗證：
 *   - findFavoritesFile 搜尋邏輯
 *   - downloadFavorites 下載 + JSON parse
 *   - uploadFavorites 新建 vs 更新路徑
 *   - deleteFavoritesFile 刪除邏輯
 *   - checkDriveConnectivity 連通性偵測
 *   - DriveApiError 錯誤類別屬性
 *   - fetchWithRetry 重試邏輯（5xx 重試、4xx 不重試）
 */

// Mock fetch globally
const mockFetch = jest.fn();
(globalThis as unknown as Record<string, unknown>).fetch = mockFetch;

import {
    findFavoritesFile,
    downloadFavorites,
    uploadFavorites,
    deleteFavoritesFile,
    checkDriveConnectivity,
    DriveApiError,
    validateTokenScopes,
} from '../sync/GoogleDriveAdapter';

import type { SyncableFavoriteState } from '../sync/mergeStrategy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = 'test-access-token-abc123';

function makeSuccessResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(body),
        text: jest.fn().mockResolvedValue(JSON.stringify(body)),
        type: 'basic',
    } as unknown as Response;
}

function makeErrorResponse(status: number, body: string): Response {
    return {
        ok: false,
        status,
        json: jest.fn().mockResolvedValue({ error: body }),
        text: jest.fn().mockResolvedValue(body),
        type: 'basic',
    } as unknown as Response;
}

function makeSyncState(): SyncableFavoriteState {
    return {
        favorites: [
            {
                id: 'r1',
                name: '測試餐廳',
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-03-13T00:00:00Z',
                isDeleted: false,
            },
        ],
        queue: ['r1'],
        currentDailyId: 'r1',
        lastUpdateDate: '2025-03-13',
        _syncVersion: 5,
        _lastSyncedAt: '2025-03-13T12:00:00Z',
        _deviceId: 'test-device',
    };
}

beforeEach(() => {
    mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DriveApiError', () => {
    it('攜帶 statusCode 和 retryable 屬性', () => {
        const err = new DriveApiError('test error', 429, true);
        expect(err.name).toBe('DriveApiError');
        expect(err.statusCode).toBe(429);
        expect(err.retryable).toBe(true);
        expect(err.message).toBe('test error');
    });

    it('不可重試的錯誤', () => {
        const err = new DriveApiError('unauthorized', 401, false);
        expect(err.retryable).toBe(false);
    });

    it('403 錯誤應自動設置 requiresReauth = true', () => {
        const err = new DriveApiError('forbidden', 403, false);
        expect(err.requiresReauth).toBe(true);
        expect(err.retryable).toBe(false);
    });

    it('非 403 錯誤的 requiresReauth 預設為 false', () => {
        const err401 = new DriveApiError('unauthorized', 401, false);
        expect(err401.requiresReauth).toBe(false);

        const err500 = new DriveApiError('server error', 500, true);
        expect(err500.requiresReauth).toBe(false);

        const errNetwork = new DriveApiError('network', 0, true);
        expect(errNetwork.requiresReauth).toBe(false);
    });
});

describe('findFavoritesFile', () => {
    it('找到檔案時回傳 file metadata', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                files: [{ id: 'file-123', name: 'how-to-eat-favorites.json', modifiedTime: '2025-03-13T00:00:00Z' }],
            }),
        );

        const result = await findFavoritesFile(TOKEN);

        expect(result).not.toBeNull();
        expect(result!.id).toBe('file-123');
        expect(mockFetch).toHaveBeenCalledTimes(1);
        // 確認 URL 包含 appDataFolder scope
        expect(mockFetch.mock.calls[0][0]).toContain('spaces=appDataFolder');
    });

    it('找不到檔案時回傳 null', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({ files: [] }),
        );

        const result = await findFavoritesFile(TOKEN);
        expect(result).toBeNull();
    });
});

describe('downloadFavorites', () => {
    it('正常下載並解析 JSON', async () => {
        const state = makeSyncState();

        // findFavoritesFile 的 call
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                files: [{ id: 'file-123', name: 'how-to-eat-favorites.json', modifiedTime: '2025-03-13T00:00:00Z' }],
            }),
        );
        // 第二個 call = 下載檔案內容
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse(state),
        );

        const result = await downloadFavorites(TOKEN);

        expect(result).not.toBeNull();
        expect(result!.favorites).toHaveLength(1);
        expect(result!.favorites[0].name).toBe('測試餐廳');
    });

    it('檔案不存在時回傳 null', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({ files: [] }),
        );

        const result = await downloadFavorites(TOKEN);
        expect(result).toBeNull();
    });

    it('JSON 格式錯誤時回傳 null', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                files: [{ id: 'file-123', name: 'test.json', modifiedTime: '2025-01-01T00:00:00Z' }],
            }),
        );
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: jest.fn().mockResolvedValue('this is not valid JSON {{{'),
            type: 'basic',
        } as unknown as Response);

        const result = await downloadFavorites(TOKEN);
        expect(result).toBeNull();
    });

    it('資料結構不正確時（缺少 favorites 陣列）回傳 null', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                files: [{ id: 'file-123', name: 'test.json', modifiedTime: '2025-01-01T00:00:00Z' }],
            }),
        );
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: jest.fn().mockResolvedValue(JSON.stringify({ notFavorites: true })),
            type: 'basic',
        } as unknown as Response);

        const result = await downloadFavorites(TOKEN);
        expect(result).toBeNull();
    });
});

describe('uploadFavorites', () => {
    it('檔案已存在時使用 PATCH 更新', async () => {
        const state = makeSyncState();

        // findFavoritesFile
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                files: [{ id: 'existing-file', name: 'test.json', modifiedTime: '2025-01-01T00:00:00Z' }],
            }),
        );
        // PATCH call
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({ id: 'existing-file' }),
        );

        const fileId = await uploadFavorites(TOKEN, state);

        expect(fileId).toBe('existing-file');
        // 第二個 call 應該是 PATCH
        expect(mockFetch.mock.calls[1][1].method).toBe('PATCH');
        expect(mockFetch.mock.calls[1][0]).toContain('existing-file');
    });

    it('檔案不存在時使用 POST 新建（multipart）', async () => {
        const state = makeSyncState();

        // findFavoritesFile → 空
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({ files: [] }),
        );
        // POST call
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({ id: 'new-file-id' }),
        );

        const fileId = await uploadFavorites(TOKEN, state);

        expect(fileId).toBe('new-file-id');
        // 第二個 call 應該是 POST + multipart
        expect(mockFetch.mock.calls[1][1].method).toBe('POST');
        expect(mockFetch.mock.calls[1][0]).toContain('uploadType=multipart');
    });
});

describe('deleteFavoritesFile', () => {
    it('檔案存在時呼叫 DELETE', async () => {
        // findFavoritesFile
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                files: [{ id: 'to-delete', name: 'test.json', modifiedTime: '2025-01-01T00:00:00Z' }],
            }),
        );
        // DELETE call
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({}),
        );

        const result = await deleteFavoritesFile(TOKEN);
        expect(result).toBe(true);
        expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
    });

    it('檔案不存在時直接回傳 true', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({ files: [] }),
        );

        const result = await deleteFavoritesFile(TOKEN);
        expect(result).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1); // 只呼叫了一次（search）
    });
});

describe('checkDriveConnectivity', () => {
    it('API 回應正常時回傳 true', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({ user: { emailAddress: 'test@gmail.com' } }),
        );

        const result = await checkDriveConnectivity(TOKEN);
        expect(result).toBe(true);
    });

    it('網路錯誤時回傳 false', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        // fetchWithRetry 會重試，所以需要 mock 多次
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await checkDriveConnectivity(TOKEN);
        expect(result).toBe(false);
    });
});

describe('fetchWithRetry — 4xx 不重試', () => {
    it('401 錯誤直接拋出，不重試', async () => {
        mockFetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));

        await expect(findFavoritesFile(TOKEN)).rejects.toThrow(DriveApiError);

        // 只應該呼叫一次（不重試）
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Tests: validateTokenScopes — Token Scope 診斷
// ---------------------------------------------------------------------------

describe('validateTokenScopes', () => {
    it('token 包含 drive.appdata scope 時回傳 valid=true', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                scope: 'openid email profile https://www.googleapis.com/auth/drive.appdata',
                expires_in: '3598',
                azp: 'test-client-id.apps.googleusercontent.com',
            }),
        );

        const result = await validateTokenScopes(TOKEN);

        expect(result.valid).toBe(true);
        expect(result.scopes).toContain('https://www.googleapis.com/auth/drive.appdata');
        expect(result.scopes).toContain('openid');
        expect(result.error).toBeUndefined();

        // 確認 URL 包含 tokeninfo 和 access_token
        expect(mockFetch.mock.calls[0][0]).toContain('tokeninfo');
        expect(mockFetch.mock.calls[0][0]).toContain('access_token=');
    });

    it('token 缺少 drive.appdata scope 時回傳 valid=false', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                scope: 'openid email profile',
                expires_in: '3598',
                azp: 'test-client-id.apps.googleusercontent.com',
            }),
        );

        const result = await validateTokenScopes(TOKEN);

        expect(result.valid).toBe(false);
        expect(result.scopes).toContain('openid');
        expect(result.scopes).not.toContain('https://www.googleapis.com/auth/drive.appdata');
        expect(result.error).toBeUndefined();
    });

    it('token 只有 drive.appdata scope（無其他 scope）時回傳 valid=true', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                scope: 'https://www.googleapis.com/auth/drive.appdata',
            }),
        );

        const result = await validateTokenScopes(TOKEN);

        expect(result.valid).toBe(true);
        expect(result.scopes).toHaveLength(1);
    });

    it('TokenInfo API 回傳錯誤時 graceful fallback', async () => {
        mockFetch.mockResolvedValueOnce(
            makeErrorResponse(400, 'Invalid token'),
        );

        const result = await validateTokenScopes(TOKEN);

        expect(result.valid).toBe(false);
        expect(result.scopes).toEqual([]);
        expect(result.error).toContain('TokenInfo API');
    });

    it('TokenInfo API 網路錯誤時 graceful fallback', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network failure'));

        const result = await validateTokenScopes(TOKEN);

        expect(result.valid).toBe(false);
        expect(result.scopes).toEqual([]);
        expect(result.error).toContain('Network failure');
    });

    it('TokenInfo API 回傳空 scope 欄位時回傳 valid=false', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                scope: '',
                expires_in: '3598',
            }),
        );

        const result = await validateTokenScopes(TOKEN);

        expect(result.valid).toBe(false);
        expect(result.scopes).toEqual([]);
    });

    it('TokenInfo API 回傳無 scope 欄位時回傳 valid=false', async () => {
        mockFetch.mockResolvedValueOnce(
            makeSuccessResponse({
                expires_in: '3598',
            }),
        );

        const result = await validateTokenScopes(TOKEN);

        expect(result.valid).toBe(false);
        expect(result.scopes).toEqual([]);
    });
});
