/**
 * placeSearch 服務 單元測試
 * 驗證：Text Search API 呼叫、回應解析、降級、錯誤處理
 */

// Mock AsyncStorage 避免 native module 錯誤
jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock 環境變數（設定 API Key）
const originalEnv = process.env;

beforeEach(() => {
    jest.resetModules();
    mockFetch.mockReset();
    process.env = { ...originalEnv };
});

afterAll(() => {
    process.env = originalEnv;
});

describe('placeSearchService.searchPlaces', () => {
    it('空查詢字串應回傳空陣列', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeSearchService } = require('../services/placeSearch');
        const result = await placeSearchService.searchPlaces('   ');
        expect(result).toEqual([]);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('API Key 未設定應回傳空陣列', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = '';
        const { placeSearchService } = require('../services/placeSearch');
        const result = await placeSearchService.searchPlaces('鼎泰豐');
        expect(result).toEqual([]);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('正常回應應正確解析為 PlaceSearchResult[]', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeSearchService } = require('../services/placeSearch');

        const mockResponse = {
            places: [
                {
                    id: 'place-123',
                    displayName: { text: '鼎泰豐 信義店' },
                    primaryTypeDisplayName: { text: '餐廳' },
                    rating: 4.5,
                    shortFormattedAddress: '台北市信義區信義路五段7號',
                    currentOpeningHours: { openNow: true },
                },
            ],
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockResponse),
        });

        const result = await placeSearchService.searchPlaces('鼎泰豐');

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            placeId: 'place-123',
            name: '鼎泰豐 信義店',
            address: '台北市信義區信義路五段7號',
            category: '餐廳',
            rating: 4.5,
            isOpenNow: true,
        });
    });

    it('API 回傳空 places 應回傳空陣列', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeSearchService } = require('../services/placeSearch');

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ places: [] }),
        });

        const result = await placeSearchService.searchPlaces('不存在的餐廳');
        expect(result).toEqual([]);
    });

    it('API 回傳錯誤應拋出例外', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeSearchService } = require('../services/placeSearch');

        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 403,
            text: () => Promise.resolve('Forbidden'),
        });

        await expect(
            placeSearchService.searchPlaces('test'),
        ).rejects.toThrow('Places API 錯誤：403');
    });
});
