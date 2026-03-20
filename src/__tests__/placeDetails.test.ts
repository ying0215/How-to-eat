/**
 * placeDetails 服務 單元測試
 * 驗證：Place Details 營業狀態查詢、降級、錯誤處理
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

const originalEnv = process.env;

beforeEach(() => {
    jest.resetModules();
    mockFetch.mockReset();
    process.env = { ...originalEnv };
});

afterAll(() => {
    process.env = originalEnv;
});

describe('placeDetailsService.getPlaceOpenStatus', () => {
    it('placeId 為空應降級回傳 isVerified=false', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeDetailsService } = require('../services/placeDetails');
        const result = await placeDetailsService.getPlaceOpenStatus('');
        expect(result).toEqual({ isOpenNow: true, isVerified: false });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('API Key 未設定應降級回傳 isVerified=false', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = '';
        const { placeDetailsService } = require('../services/placeDetails');
        const result = await placeDetailsService.getPlaceOpenStatus('place-123');
        expect(result).toEqual({ isOpenNow: true, isVerified: false });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('正常回應 openNow=true 應回傳 isOpenNow=true, isVerified=true', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeDetailsService } = require('../services/placeDetails');

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                currentOpeningHours: { openNow: true },
            }),
        });

        const result = await placeDetailsService.getPlaceOpenStatus('place-123');
        expect(result).toEqual({ isOpenNow: true, isVerified: true });
    });

    it('正常回應 openNow=false 應回傳 isOpenNow=false, isVerified=true', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeDetailsService } = require('../services/placeDetails');

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                currentOpeningHours: { openNow: false },
            }),
        });

        const result = await placeDetailsService.getPlaceOpenStatus('place-123');
        expect(result).toEqual({ isOpenNow: false, isVerified: true });
    });

    it('API 錯誤應降級回傳 isVerified=false（不阻斷使用者流程）', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeDetailsService } = require('../services/placeDetails');

        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error'),
        });

        const result = await placeDetailsService.getPlaceOpenStatus('place-123');
        expect(result).toEqual({ isOpenNow: true, isVerified: false });
    });

    it('網路錯誤應降級回傳 isVerified=false', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeDetailsService } = require('../services/placeDetails');

        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await placeDetailsService.getPlaceOpenStatus('place-123');
        expect(result).toEqual({ isOpenNow: true, isVerified: false });
    });
});

// ── 營業狀態快取測試 ──────────────────────────────────────────────────────────

describe('placeDetailsService cache', () => {
    it('相同 placeId 第二次查詢應命中快取（不呼叫 fetch）', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeDetailsService } = require('../services/placeDetails');
        placeDetailsService.clearOpenStatusCache();

        // 第一次查詢
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ currentOpeningHours: { openNow: true } }),
        });

        const result1 = await placeDetailsService.getPlaceOpenStatus('place-cache-1');
        expect(result1).toEqual({ isOpenNow: true, isVerified: true });
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // 第二次查詢：應命中快取
        mockFetch.mockClear();
        const result2 = await placeDetailsService.getPlaceOpenStatus('place-cache-1');
        expect(result2).toEqual({ isOpenNow: true, isVerified: true });
        // 不應有新的 fetch 呼叫
        expect(mockFetch).not.toHaveBeenCalled();

        placeDetailsService.clearOpenStatusCache();
    });

    it('快取 TTL 過期後應重新查詢 API', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeDetailsService } = require('../services/placeDetails');
        placeDetailsService.clearOpenStatusCache();

        const originalDateNow = Date.now;

        try {
            let mockTime = 1_000_000;
            Date.now = () => mockTime;

            // 第一次查詢
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ currentOpeningHours: { openNow: true } }),
            });
            await placeDetailsService.getPlaceOpenStatus('place-ttl-1');
            expect(mockFetch).toHaveBeenCalledTimes(1);

            // 推進 3 分鐘（超過 2 分鐘 TTL）
            mockTime += 3 * 60 * 1000;
            mockFetch.mockClear();

            // 第二次查詢：TTL 過期 → 應重新呼叫 API
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ currentOpeningHours: { openNow: false } }),
            });
            const result = await placeDetailsService.getPlaceOpenStatus('place-ttl-1');
            expect(result).toEqual({ isOpenNow: false, isVerified: true });
            expect(mockFetch).toHaveBeenCalledTimes(1);
        } finally {
            Date.now = originalDateNow;
            placeDetailsService.clearOpenStatusCache();
        }
    });

    it('clearOpenStatusCache 後應重新查詢', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'test-key';
        const { placeDetailsService } = require('../services/placeDetails');
        placeDetailsService.clearOpenStatusCache();

        // 第一次查詢
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ currentOpeningHours: { openNow: true } }),
        });
        await placeDetailsService.getPlaceOpenStatus('place-clear-1');
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // 清除快取
        placeDetailsService.clearOpenStatusCache();
        mockFetch.mockClear();

        // 第二次查詢：快取已清除 → 應重新呼叫 API
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ currentOpeningHours: { openNow: false } }),
        });
        const result = await placeDetailsService.getPlaceOpenStatus('place-clear-1');
        expect(result).toEqual({ isOpenNow: false, isVerified: true });
        expect(mockFetch).toHaveBeenCalledTimes(1);

        placeDetailsService.clearOpenStatusCache();
    });
});
