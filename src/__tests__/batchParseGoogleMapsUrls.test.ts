/**
 * batchParseGoogleMapsUrls 單元測試
 * 驗證：批量 URL 解析、並行控制、空輸入、混合有效/無效 URL
 */

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock 環境變數
const originalEnv = process.env;

beforeEach(() => {
    jest.resetModules();
    mockFetch.mockReset();
    process.env = { ...originalEnv, EXPO_PUBLIC_GOOGLE_PLACES_API_KEY: 'test-key' };
});

afterAll(() => {
    process.env = originalEnv;
});

// ── 輔助：建立 mock Place 回應 ──────────────────────────────────────────

function createMockPlaceResponse(name: string, placeId: string) {
    return {
        ok: true,
        json: () => Promise.resolve({
            places: [{
                id: placeId,
                displayName: { text: name },
                primaryTypeDisplayName: { text: '餐廳' },
                rating: 4.2,
                shortFormattedAddress: `${name}地址`,
                location: { latitude: 25.033, longitude: 121.565 },
                currentOpeningHours: { openNow: true },
            }],
        }),
    };
}

// ── batchParseGoogleMapsUrls 測試 ────────────────────────────────────────

describe('batchParseGoogleMapsUrls', () => {
    it('空輸入應回傳零結果', async () => {
        const { batchParseGoogleMapsUrls } = require('../services/googleMapsUrlParser');
        const result = await batchParseGoogleMapsUrls('');
        expect(result.results).toHaveLength(0);
        expect(result.successCount).toBe(0);
        expect(result.failedCount).toBe(0);
    });

    it('純文字（非 URL）應回傳零結果', async () => {
        const { batchParseGoogleMapsUrls } = require('../services/googleMapsUrlParser');
        const result = await batchParseGoogleMapsUrls('hello world\nfoo bar');
        expect(result.results).toHaveLength(0);
    });

    it('單一有效 URL 應回傳一個結果', async () => {
        const { batchParseGoogleMapsUrls } = require('../services/googleMapsUrlParser');

        mockFetch.mockResolvedValueOnce(createMockPlaceResponse('鼎泰豐', 'ChIJ-1'));

        const result = await batchParseGoogleMapsUrls(
            'https://www.google.com/maps/place/鼎泰豐/@25.033,121.565,17z'
        );
        expect(result.results).toHaveLength(1);
        expect(result.successCount).toBe(1);
        expect(result.failedCount).toBe(0);
        expect(result.results[0].restaurant?.name).toBe('鼎泰豐');
    });

    it('多個有效 URL 應全部成功', async () => {
        const { batchParseGoogleMapsUrls } = require('../services/googleMapsUrlParser');

        mockFetch
            .mockResolvedValueOnce(createMockPlaceResponse('餐廳A', 'ChIJ-A'))
            .mockResolvedValueOnce(createMockPlaceResponse('餐廳B', 'ChIJ-B'));

        const input = [
            'https://www.google.com/maps/place/餐廳A/@25.033,121.565,17z',
            'https://www.google.com/maps/place/餐廳B/@25.040,121.570,17z',
        ].join('\n');

        const result = await batchParseGoogleMapsUrls(input);
        expect(result.results).toHaveLength(2);
        expect(result.successCount).toBe(2);
        expect(result.failedCount).toBe(0);
    });

    it('混合有效/無效行應只處理有效 URL', async () => {
        const { batchParseGoogleMapsUrls } = require('../services/googleMapsUrlParser');

        mockFetch.mockResolvedValueOnce(createMockPlaceResponse('OK餐廳', 'ChIJ-OK'));

        const input = [
            'https://www.google.com/maps/place/OK餐廳/@25.033,121.565,17z',
            '這不是一個URL',
            'https://example.com/not-maps',
        ].join('\n');

        const result = await batchParseGoogleMapsUrls(input);
        // 只有第一個是有效的 Google Maps URL
        expect(result.results).toHaveLength(1);
        expect(result.successCount).toBe(1);
    });

    it('搜尋無結果時應標記為失敗', async () => {
        const { batchParseGoogleMapsUrls } = require('../services/googleMapsUrlParser');

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ places: [] }),
        });

        const result = await batchParseGoogleMapsUrls(
            'https://www.google.com/maps/place/完全不存在/@25.0,121.5,17z'
        );
        expect(result.results).toHaveLength(1);
        expect(result.successCount).toBe(0);
        expect(result.failedCount).toBe(1);
        expect(result.results[0].error).not.toBeNull();
    });

    it('應忽略空行', async () => {
        const { batchParseGoogleMapsUrls } = require('../services/googleMapsUrlParser');

        mockFetch.mockResolvedValueOnce(createMockPlaceResponse('唯一餐廳', 'ChIJ-only'));

        const input = '\n\nhttps://www.google.com/maps/place/唯一餐廳/@25.0,121.5,17z\n\n';
        const result = await batchParseGoogleMapsUrls(input);
        expect(result.results).toHaveLength(1);
        expect(result.successCount).toBe(1);
    });
});
