/**
 * restaurantService 單元測試
 * 驗證 Mock 資料服務的篩選邏輯與回應格式
 *
 * 💡 測試策略：
 *   - isPlacesApiConfigured() 預設回傳 false（因 env 未設定），走 Mock 路徑
 *   - 驗證 category / radius 篩選組合
 *   - 驗證 getRandom 只回傳營業中的餐廳
 *   - 驗證無匹配時的空結果處理
 */

import { restaurantService } from '../services/restaurant';

// ── getNearest ──────────────────────────────────────────────────────────────

describe('restaurantService.getNearest', () => {
    const baseParams = { latitude: 22.646, longitude: 120.329 };

    it('不帶篩選條件時，應回傳所有 4 家 Mock 餐廳', async () => {
        const result = await restaurantService.getNearest(baseParams);
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(4);
    });

    it('篩選 category="麵類" 時，應只回傳匹配的餐廳', async () => {
        const result = await restaurantService.getNearest({
            ...baseParams,
            category: '麵類',
        });
        expect(result.success).toBe(true);
        expect(result.data.every((r) => r.category === '麵類')).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data[0].name).toBe('老王牛肉麵');
    });

    it('category="全部" 時，應回傳所有餐廳（不過濾）', async () => {
        const result = await restaurantService.getNearest({
            ...baseParams,
            category: '全部',
        });
        expect(result.data).toHaveLength(4);
    });

    it('radius=500 時，應只回傳距離 ≤ 500m 的餐廳', async () => {
        const result = await restaurantService.getNearest({
            ...baseParams,
            radius: 500,
        });
        expect(result.success).toBe(true);
        expect(result.data.every((r) => r.distanceMeter <= 500)).toBe(true);
        // Mock 資料中 350m + 150m = 2 家
        expect(result.data).toHaveLength(2);
    });

    it('category + radius 同時篩選，應套用兩個條件', async () => {
        const result = await restaurantService.getNearest({
            ...baseParams,
            category: '飯類',
            radius: 200,
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data[0].name).toBe('阿美便當');
    });

    it('條件無匹配時，應回傳空陣列', async () => {
        const result = await restaurantService.getNearest({
            ...baseParams,
            category: '壽司',
        });
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(0);
    });

    it('回傳的每筆餐廳資料都包含必要欄位', async () => {
        const result = await restaurantService.getNearest(baseParams);
        for (const restaurant of result.data) {
            expect(restaurant).toHaveProperty('id');
            expect(restaurant).toHaveProperty('name');
            expect(restaurant).toHaveProperty('category');
            expect(typeof restaurant.rating).toBe('number');
            expect(typeof restaurant.isOpenNow).toBe('boolean');
            expect(typeof restaurant.distanceMeter).toBe('number');
            expect(typeof restaurant.estimatedTimeMins).toBe('number');
        }
    });
});

// ── getRandom ───────────────────────────────────────────────────────────────

describe('restaurantService.getRandom', () => {
    const baseParams = { latitude: 22.646, longitude: 120.329 };

    it('不帶 category 時，應從「營業中」的餐廳隨機回傳一家', async () => {
        const result = await restaurantService.getRandom(baseParams);
        expect(result.success).toBe(true);
        expect(result.data).not.toBeNull();
        expect(result.data!.isOpenNow).toBe(true);
    });

    it('篩選 category="麵類" 且店家開著，應回傳該分類', async () => {
        const result = await restaurantService.getRandom({
            ...baseParams,
            category: '麵類',
        });
        expect(result.success).toBe(true);
        expect(result.data!.category).toBe('麵類');
    });

    it('category="全部" 應不過濾類別，從所有營業中的店家抽取', async () => {
        const result = await restaurantService.getRandom({
            ...baseParams,
            category: '全部',
        });
        expect(result.success).toBe(true);
        expect(result.data!.isOpenNow).toBe(true);
    });

    it('目標分類全部休息中，應回傳 success=false 並帶有 message，且 data 為 null', async () => {
        // 「天天火鍋」的 isOpenNow=false，且它是 mock 中唯一的火鍋店
        const result = await restaurantService.getRandom({
            ...baseParams,
            category: '火鍋',
        });
        expect(result.success).toBe(false);
        expect(result.message).toBeTruthy();
        expect(result.data).toBeNull();
    });

    it('不存在的分類應回傳 success=false 且 data 為 null', async () => {
        const result = await restaurantService.getRandom({
            ...baseParams,
            category: '泰式料理',
        });
        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
    });
});
