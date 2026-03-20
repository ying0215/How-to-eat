// ============================================================================
// 📋 placeDetails.ts — Google Places 營業狀態查詢服務
// ============================================================================
//
// 💡 使用場景：
//   在「最愛抽獎」揭曉結果時，即時查詢該餐廳是否正在營業。
//   僅在使用者按下「換一家」後觸發一次查詢，避免批次呼叫產生高額費用。
//
// 🔑 所需環境變數：
//   EXPO_PUBLIC_GOOGLE_PLACES_API_KEY — Google Places API 金鑰
//
// 📖 API 文件：
//   https://developers.google.com/maps/documentation/places/web-service/place-details
//
// 💰 費用控制策略：
//   - 每次僅查詢一間餐廳（使用者觸發時）
//   - Field Mask 限制為 currentOpeningHours.openNow，使用最低計費等級
//   - 無 placeId 或 API Key 時降級預設為營業中
// ============================================================================

// ── 設定常數 ─────────────────────────────────────────────────────────────────

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

/** Google Places API (New) Place Details endpoint */
const PLACES_DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';

/** 請求逾時時間（毫秒） */
const REQUEST_TIMEOUT_MS = 8_000;

// ── 回應型別 ─────────────────────────────────────────────────────────────────

export interface PlaceOpenStatus {
    /** 是否正在營業 */
    isOpenNow: boolean;
    /** 是否成功從 API 取得結果（false 表示降級預設值） */
    isVerified: boolean;
}

// ── 內部型別 ─────────────────────────────────────────────────────────────────

interface PlaceDetailsResponse {
    currentOpeningHours?: {
        openNow?: boolean;
    };
    regularOpeningHours?: {
        openNow?: boolean;
    };
}

// ── 工具函式 ─────────────────────────────────────────────────────────────────

/** 判斷 Google Places API Key 是否已設定 */
const isPlacesApiConfigured = (): boolean => {
    return GOOGLE_PLACES_API_KEY.length > 0
        && !GOOGLE_PLACES_API_KEY.includes('your-api-key');
};

/** 帶有 timeout 的 fetch */
const fetchWithTimeout = (
    input: string,
    init?: RequestInit,
    timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return fetch(input, { ...init, signal: controller.signal })
        .then((res) => {
            clearTimeout(timer);
            return res;
        })
        .catch((err) => {
            clearTimeout(timer);
            if (err.name === 'AbortError') throw new Error('查詢逾時');
            throw err;
        });
};

// ── 快取設定 ─────────────────────────────────────────────────────────────────

/** 營業狀態快取：placeId → { result, timestamp } */
const _openStatusCache = new Map<string, { result: PlaceOpenStatus; timestamp: number }>();

/** 快取 TTL（毫秒）— 2 分鐘內同一間餐廳不重複查詢 */
const OPEN_STATUS_CACHE_TTL_MS = 2 * 60 * 1000;

// ── Service ─────────────────────────────────────────────────────────────────

export const placeDetailsService = {
    /**
     * 查詢單間餐廳的即時營業狀態。
     *
     * 內建 2 分鐘 TTL 快取：在 `skipToNextOpen()` 等迴圈場景中，
     * 避免對同一間餐廳重複發送 API 請求，大幅節省 Places API 費用。
     *
     * @param placeId - Google Places ID
     * @returns PlaceOpenStatus — 營業狀態與驗證結果
     *
     * 降級策略：
     * - placeId 為空 → 返回 { isOpenNow: true, isVerified: false }
     * - API Key 未設定 → 返回 { isOpenNow: true, isVerified: false }
     * - API 錯誤 → 返回 { isOpenNow: true, isVerified: false }（不阻斷使用者流程）
     */
    getPlaceOpenStatus: async (placeId: string): Promise<PlaceOpenStatus> => {
        // ── 降級情境：無法查詢 ──
        if (!placeId || !isPlacesApiConfigured()) {
            console.log(
                '[placeDetailsService.getPlaceOpenStatus] 降級：',
                !placeId ? 'placeId 為空' : 'API Key 未設定',
            );
            return { isOpenNow: true, isVerified: false };
        }

        // ── 快取檢查 ──
        const cached = _openStatusCache.get(placeId);
        if (cached && (Date.now() - cached.timestamp) < OPEN_STATUS_CACHE_TTL_MS) {
            console.log(
                `[placeDetailsService.getPlaceOpenStatus] 快取命中：placeId=${placeId}`,
            );
            return cached.result;
        }

        try {
            // Places API (New) 使用 RESTful URL 格式
            // GET https://places.googleapis.com/v1/places/{placeId}
            const url = `${PLACES_DETAILS_BASE_URL}/${placeId}`;

            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers: {
                    'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
                    // 最小 Field Mask — 僅查營業狀態，最低計費等級
                    'X-Goog-FieldMask': 'currentOpeningHours.openNow,regularOpeningHours.openNow',
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(
                    `[placeDetailsService.getPlaceOpenStatus] API error ${response.status}:`,
                    errorText,
                );
                // API 錯誤不阻斷使用者流程
                const fallback: PlaceOpenStatus = { isOpenNow: true, isVerified: false };
                // 不快取錯誤結果，下次重試
                return fallback;
            }

            const data: PlaceDetailsResponse = await response.json();
            const isOpen =
                data.currentOpeningHours?.openNow ??
                data.regularOpeningHours?.openNow ??
                true;

            console.log(
                `[placeDetailsService.getPlaceOpenStatus] placeId=${placeId}，營業中=${isOpen}`,
            );

            const result: PlaceOpenStatus = { isOpenNow: isOpen, isVerified: true };

            // ── 寫入快取 ──
            _openStatusCache.set(placeId, { result, timestamp: Date.now() });

            return result;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : '查詢營業狀態失敗';
            console.error('[placeDetailsService.getPlaceOpenStatus] Error:', message);
            // 網路錯誤不阻斷使用者流程，不快取錯誤結果
            return { isOpenNow: true, isVerified: false };
        }
    },

    /**
     * 清除營業狀態快取。
     *
     * 用途：
     * - 單元測試中重置模組狀態
     * - 手動強制刷新（如使用者下拉刷新）
     */
    clearOpenStatusCache: (): void => {
        _openStatusCache.clear();
    },
};

