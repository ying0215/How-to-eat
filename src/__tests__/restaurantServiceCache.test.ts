/**
 * restaurantService 快取機制單元測試
 *
 * 💡 測試策略：
 *   - 透過 Mock 路徑（env 未設定 API Key）驗證快取邏輯
 *   - 驗證相同參數命中快取、不同參數各自獨立
 *   - 驗證 clearCache() 強制清除
 *   - 驗證 TTL 過期後重新取得資料
 */

import { restaurantService } from '../services/restaurant';

// ── 快取命中 ────────────────────────────────────────────────────────────────

describe('restaurantService cache', () => {
    const baseParams = { latitude: 22.646, longitude: 120.329 };

    beforeEach(() => {
        // 每個測試前清除快取，確保測試間不互相影響
        restaurantService.clearCache();
    });

    it('相同參數的第二次呼叫應命中快取（回傳相同 data 引用）', async () => {
        const result1 = await restaurantService.getNearest(baseParams);
        const result2 = await restaurantService.getNearest(baseParams);

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
        // 快取命中時回傳的是同一個陣列引用
        expect(result2.data).toBe(result1.data);
    });

    it('不同 category 參數應各自獨立快取', async () => {
        const result1 = await restaurantService.getNearest({
            ...baseParams,
            category: '麵類',
        });
        const result2 = await restaurantService.getNearest({
            ...baseParams,
            category: '飯類',
        });

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
        // 兩個結果應各自獨立，不會互相覆蓋
        expect(result1.data).not.toBe(result2.data);
        expect(result1.data[0].category).toBe('麵類');
        expect(result2.data[0].category).toBe('飯類');
    });

    it('不同 radius 參數應各自獨立快取', async () => {
        const result1 = await restaurantService.getNearest({
            ...baseParams,
            radius: 500,
        });
        const result2 = await restaurantService.getNearest({
            ...baseParams,
            radius: 1500,
        });

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
        // radius=500 只包含 2 家，radius=1500 包含全部 4 家
        expect(result1.data.length).toBeLessThanOrEqual(result2.data.length);
    });

    it('clearCache() 後應重新取得資料（非快取引用）', async () => {
        const result1 = await restaurantService.getNearest(baseParams);
        restaurantService.clearCache();
        const result2 = await restaurantService.getNearest(baseParams);

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
        // 清除快取後回傳的是全新的陣列引用
        expect(result2.data).not.toBe(result1.data);
        // 但內容應相同
        expect(result2.data).toHaveLength(result1.data.length);
    });

    it('座標微小漂移（< 11m）應命中相同快取', async () => {
        const result1 = await restaurantService.getNearest({
            latitude: 22.646001,
            longitude: 120.329002,
        });
        // 微小漂移：在 toFixed(4) 之下會四捨五入到相同值
        const result2 = await restaurantService.getNearest({
            latitude: 22.646049,
            longitude: 120.329049,
        });

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
        // 同一個快取引用
        expect(result2.data).toBe(result1.data);
    });

    it('座標差異超過精度範圍應產生不同快取', async () => {
        const result1 = await restaurantService.getNearest({
            latitude: 22.6460,
            longitude: 120.3290,
        });
        // 差異超過 0.0001（約 >11m）
        const result2 = await restaurantService.getNearest({
            latitude: 22.6480,
            longitude: 120.3310,
        });

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
        // 不同快取 key → 不同引用
        expect(result2.data).not.toBe(result1.data);
    });

    it('TTL 過期後應重新取得資料', async () => {
        // Mock Date.now 來模擬時間流逝
        const originalNow = Date.now;

        try {
            let mockTime = 1000000;
            Date.now = () => mockTime;

            const result1 = await restaurantService.getNearest(baseParams);

            // 推進 6 分鐘（超過 5 分鐘 TTL）
            mockTime += 6 * 60 * 1000;

            const result2 = await restaurantService.getNearest(baseParams);

            expect(result1.success).toBe(true);
            expect(result2.success).toBe(true);
            // TTL 過期 → 應產生新的引用
            expect(result2.data).not.toBe(result1.data);
        } finally {
            Date.now = originalNow;
        }
    });

    it('TTL 未過期應命中快取', async () => {
        const originalNow = Date.now;

        try {
            let mockTime = 1000000;
            Date.now = () => mockTime;

            const result1 = await restaurantService.getNearest(baseParams);

            // 推進 3 分鐘（未超過 5 分鐘 TTL）
            mockTime += 3 * 60 * 1000;

            const result2 = await restaurantService.getNearest(baseParams);

            expect(result1.success).toBe(true);
            expect(result2.success).toBe(true);
            // TTL 未過期 → 應命中快取
            expect(result2.data).toBe(result1.data);
        } finally {
            Date.now = originalNow;
        }
    });
});
