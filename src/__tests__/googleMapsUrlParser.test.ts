/**
 * googleMapsUrlParser 服務 單元測試
 * 驗證：URL 辨識、長連結解析、短連結展開、搜尋 fallback
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

// ── isGoogleMapsUrl 測試 ─────────────────────────────────────────────────

describe('isGoogleMapsUrl', () => {
    it('應辨識 Google Maps 短連結', () => {
        const { isGoogleMapsUrl } = require('../services/googleMapsUrlParser');
        expect(isGoogleMapsUrl('https://maps.app.goo.gl/AbCdEf123')).toBe(true);
        expect(isGoogleMapsUrl('https://goo.gl/maps/xxxxx')).toBe(true);
    });

    it('應辨識 Google Maps 標準長連結', () => {
        const { isGoogleMapsUrl } = require('../services/googleMapsUrlParser');
        expect(isGoogleMapsUrl('https://www.google.com/maps/place/鼎泰豐/@25.033,121.565')).toBe(true);
        expect(isGoogleMapsUrl('https://www.google.com.tw/maps/search/cafe')).toBe(true);
        expect(isGoogleMapsUrl('https://maps.google.com/maps/place/test')).toBe(true);
    });

    it('應拒絕非 Google Maps URL', () => {
        const { isGoogleMapsUrl } = require('../services/googleMapsUrlParser');
        expect(isGoogleMapsUrl('https://www.google.com/search?q=test')).toBe(false);
        expect(isGoogleMapsUrl('https://example.com')).toBe(false);
        expect(isGoogleMapsUrl('not a url')).toBe(false);
        expect(isGoogleMapsUrl('')).toBe(false);
    });

    it('應處理帶有空格的 URL', () => {
        const { isGoogleMapsUrl } = require('../services/googleMapsUrlParser');
        expect(isGoogleMapsUrl('  https://maps.app.goo.gl/test  ')).toBe(true);
    });
});

// ── extractInfoFromUrl 測試 ──────────────────────────────────────────────

describe('extractInfoFromUrl', () => {
    it('應從 /place/ URL 提取餐廳名稱', () => {
        const { extractInfoFromUrl } = require('../services/googleMapsUrlParser');
        const result = extractInfoFromUrl('https://www.google.com/maps/place/鼎泰豐+信義店/@25.033,121.565,17z');
        expect(result.placeName).toBe('鼎泰豐 信義店');
    });

    it('應從 /search/ URL 提取搜尋關鍵字', () => {
        const { extractInfoFromUrl } = require('../services/googleMapsUrlParser');
        const result = extractInfoFromUrl('https://www.google.com/maps/search/coffee+shop/@25.0,121.5');
        expect(result.placeName).toBe('coffee shop');
    });

    it('應從 URL 提取座標', () => {
        const { extractInfoFromUrl } = require('../services/googleMapsUrlParser');
        const result = extractInfoFromUrl('https://www.google.com/maps/place/Test/@25.033964,121.564468,17z');
        expect(result.latitude).toBeCloseTo(25.033964, 4);
        expect(result.longitude).toBeCloseTo(121.564468, 4);
    });

    it('應從 query_place_id 參數提取 Place ID', () => {
        const { extractInfoFromUrl } = require('../services/googleMapsUrlParser');
        const result = extractInfoFromUrl('https://www.google.com/maps/place/?q=test&query_place_id=ChIJN1t_abc');
        expect(result.placeId).toBe('ChIJN1t_abc');
    });

    it('應從 place_id: 格式提取 Place ID', () => {
        const { extractInfoFromUrl } = require('../services/googleMapsUrlParser');
        const result = extractInfoFromUrl('https://www.google.com/maps/place/?q=place_id:ChIJx8j-Z_test');
        expect(result.placeId).toBe('ChIJx8j-Z_test');
    });

    it('應拒絕不合法座標', () => {
        const { extractInfoFromUrl } = require('../services/googleMapsUrlParser');
        // 緯度超出範圍
        const result = extractInfoFromUrl('https://www.google.com/maps/place/Test/@999.0,121.5');
        expect(result.latitude).toBeNull();
        expect(result.longitude).toBeNull();
    });

    it('應處理編碼的中文名稱', () => {
        const { extractInfoFromUrl } = require('../services/googleMapsUrlParser');
        const encodedName = encodeURIComponent('鼎泰豐');
        const result = extractInfoFromUrl(`https://www.google.com/maps/place/${encodedName}/@25.0,121.5`);
        expect(result.placeName).toBe('鼎泰豐');
    });

    it('無結構化資訊時應回傳全 null', () => {
        const { extractInfoFromUrl } = require('../services/googleMapsUrlParser');
        const result = extractInfoFromUrl('https://www.google.com/maps/@25.0,121.5,15z');
        expect(result.placeName).toBeNull();
        expect(result.placeId).toBeNull();
        // 座標仍可提取
        expect(result.latitude).toBeCloseTo(25.0, 1);
    });
});

// ── parseGoogleMapsUrl 測試 ──────────────────────────────────────────────

describe('parseGoogleMapsUrl', () => {
    it('非 Google Maps URL 應回傳錯誤', async () => {
        const { parseGoogleMapsUrl } = require('../services/googleMapsUrlParser');
        const result = await parseGoogleMapsUrl('https://example.com');
        expect(result.restaurant).toBeNull();
        expect(result.error).toBe('不是有效的 Google Maps 連結');
        expect(result.source).toBe('failed');
    });

    it('長連結應解析名稱並呼叫搜尋', async () => {
        const { parseGoogleMapsUrl } = require('../services/googleMapsUrlParser');

        // Mock placeSearchService 的 searchPlaces（由 fetch mock 控制）
        const mockPlaceResult = {
            places: [{
                id: 'ChIJ-test',
                displayName: { text: '鼎泰豐 信義店' },
                primaryTypeDisplayName: { text: '餐廳' },
                rating: 4.5,
                shortFormattedAddress: '台北市信義區信義路五段7號',
                location: { latitude: 25.033, longitude: 121.565 },
                currentOpeningHours: { openNow: true },
            }],
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockPlaceResult),
        });

        const result = await parseGoogleMapsUrl(
            'https://www.google.com/maps/place/鼎泰豐+信義店/@25.033,121.565,17z'
        );

        expect(result.restaurant).not.toBeNull();
        expect(result.restaurant?.name).toBe('鼎泰豐 信義店');
        expect(result.source).toBe('name_search');
        expect(result.error).toBeNull();
    });

    it('搜尋無結果時應回傳失敗', async () => {
        const { parseGoogleMapsUrl } = require('../services/googleMapsUrlParser');

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ places: [] }),
        });

        const result = await parseGoogleMapsUrl(
            'https://www.google.com/maps/place/完全不存在的餐廳/@25.0,121.5'
        );

        expect(result.restaurant).toBeNull();
        expect(result.source).toBe('failed');
        expect(result.error).toContain('完全不存在的餐廳');
    });

    it('短連結應先展開再解析', async () => {
        const { parseGoogleMapsUrl } = require('../services/googleMapsUrlParser');

        // 第一次 fetch：展開短連結（redirect follow）
        const expandedUrl = 'https://www.google.com/maps/place/Test+Restaurant/@25.033,121.565,17z';
        mockFetch.mockResolvedValueOnce({
            ok: true,
            url: expandedUrl,
            text: () => Promise.resolve(''),
        });

        // 第二次 fetch：placeSearch API 呼叫
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                places: [{
                    id: 'ChIJ-expanded',
                    displayName: { text: 'Test Restaurant' },
                    primaryTypeDisplayName: { text: '餐廳' },
                    rating: 4.0,
                    shortFormattedAddress: 'Test Address',
                    location: { latitude: 25.033, longitude: 121.565 },
                    currentOpeningHours: { openNow: true },
                }],
            }),
        });

        const result = await parseGoogleMapsUrl('https://maps.app.goo.gl/AbCd123');

        expect(result.restaurant).not.toBeNull();
        expect(result.restaurant?.name).toBe('Test Restaurant');
        expect(result.source).toBe('name_search');
    });

    it('短連結展開失敗應回傳錯誤', async () => {
        const { parseGoogleMapsUrl } = require('../services/googleMapsUrlParser');

        mockFetch.mockRejectedValueOnce(new Error('network error'));

        const result = await parseGoogleMapsUrl('https://maps.app.goo.gl/broken');

        expect(result.restaurant).toBeNull();
        expect(result.error).toContain('無法展開短連結');
        expect(result.source).toBe('failed');
    });
});

// ── CORS 代理冷卻機制測試 ────────────────────────────────────────────────────

describe('expandShortUrlViaProxy cooldown', () => {
    it('Web 端 CORS 代理冷卻期內應直接回傳 null（不呼叫 fetch）', async () => {
        // 模擬 Web 環境
        const originalWindow = global.window;
        const originalDocument = global.document;
        (global as any).window = {};
        (global as any).document = {};

        const {
            parseGoogleMapsUrl,
            resetProxyCooldown,
        } = require('../services/googleMapsUrlParser');

        // 確保冷卻已重置
        resetProxyCooldown();

        // 第一次呼叫：所有代理失敗 → 觸發冷卻
        mockFetch.mockRejectedValue(new Error('CORS 403'));
        await parseGoogleMapsUrl('https://maps.app.goo.gl/first');
        const callCountAfterFirst = mockFetch.mock.calls.length;

        // 第二次呼叫：應在冷卻期內 → 直接回傳 null，不呼叫 fetch
        mockFetch.mockClear();
        const result = await parseGoogleMapsUrl('https://maps.app.goo.gl/second');
        expect(result.restaurant).toBeNull();
        expect(result.error).toContain('CORS');
        // 冷卻期內不應有新的 fetch 呼叫
        expect(mockFetch).not.toHaveBeenCalled();

        // 清理
        resetProxyCooldown();
        (global as any).window = originalWindow;
        (global as any).document = originalDocument;
    });

    it('冷卻期過後應重新嘗試代理', async () => {
        const originalDateNow = Date.now;
        const originalWindow = global.window;
        const originalDocument = global.document;
        (global as any).window = {};
        (global as any).document = {};

        const {
            parseGoogleMapsUrl,
            resetProxyCooldown,
        } = require('../services/googleMapsUrlParser');

        resetProxyCooldown();

        try {
            let mockTime = 1_000_000;
            Date.now = () => mockTime;

            // 第一次呼叫：代理失敗 → 觸發冷卻
            mockFetch.mockRejectedValue(new Error('CORS blocked'));
            await parseGoogleMapsUrl('https://maps.app.goo.gl/test1');

            // 推進 31 秒（超過 30 秒冷卻）
            mockTime += 31_000;
            mockFetch.mockClear();

            // 代理仍會失敗，但重點是確認有嘗試 fetch
            mockFetch.mockRejectedValue(new Error('still blocked'));
            await parseGoogleMapsUrl('https://maps.app.goo.gl/test2');

            // 冷卻期過後應重新嘗試 → 有 fetch 呼叫
            expect(mockFetch).toHaveBeenCalled();
        } finally {
            Date.now = originalDateNow;
            resetProxyCooldown();
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
        }
    });
});
