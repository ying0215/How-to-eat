/**
 * 測試 restaurantService 在 API Key 存在，但 API 請求失敗（如 Timeout 或 500）時，
 * 是否能正確降級 (Fallback) 至 Mock 資料，不拋出錯誤。
 */

// 必須在 import 前設定環境變數，確保模組載入時 isPlacesApiConfigured 回傳 true
process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'valid-test-key-12345';

import { restaurantService } from '../services/restaurant';

describe('restaurantService API Fallback', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        // 每次測試前清除 cache
        restaurantService.clearCache();
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it('當 Places API 發生網路錯誤時，應捕捉錯誤並降級回 Mock 資料', async () => {
        // Mock fetch 拋出錯誤（模擬請求失敗如 timeout 或斷網）
        global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

        // 雖然 isPlacesApiConfigured 為 true，但 fetch 失敗，應收到 Mock 資料
        const result = await restaurantService.getNearest({
            latitude: 22.646,
            longitude: 120.329,
        });

        // 應該成功回傳
        expect(result.success).toBe(true);
        // 應該降級拿到 Mock 資料（4 筆）
        expect(result.data).toHaveLength(4);
        expect(result.data[0].name).toBe('老王牛肉麵'); // 確保是 mock data
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('當 Places API 回傳 500 狀態碼時，也應捕捉錯誤並降級', async () => {
        // Mock fetch 回傳 500
        global.fetch = jest.fn(() => Promise.resolve({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error'),
        } as Response));

        const result = await restaurantService.getNearest({
            latitude: 22.646,
            longitude: 120.329,
        });

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(4);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
