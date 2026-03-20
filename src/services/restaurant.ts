// ============================================================================
// 🍽️ restaurantService — 附近餐廳搜尋服務
// ============================================================================
//
// 💡 架構決策（方案 A）：
//   採用 Google Places API (New) 直接從 client 端搜尋附近餐廳。
//   不自建後端、不使用 Supabase。零維運、零伺服器。
//
//   - 已設定 API Key → 呼叫 Google Places API (Nearby Search)
//   - 未設定 API Key → 降級為 Mock 資料（開發 / CI 環境）
//
// 🔑 所需環境變數：
//   EXPO_PUBLIC_GOOGLE_PLACES_API_KEY — Google Places API 金鑰
//
// 📖 API 文件：
//   https://developers.google.com/maps/documentation/places/web-service/nearby-search
// ============================================================================

import { Restaurant } from '../types/models';
import {
    GetNearestRestaurantsParams,
    GetNearestRestaurantsResponse,
    GetRandomRestaurantParams,
    GetRandomRestaurantResponse,
} from '../types/api';
import { CATEGORY_TO_PLACES_TYPE, resolveCategory } from '../constants/categories';

// ── 設定常數 ─────────────────────────────────────────────────────────────────

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

/** Google Places API (New) Nearby Search endpoint */
const PLACES_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';

/** 預設搜尋半徑（公尺） */
const DEFAULT_RADIUS_M = 1000;

/** 請求逾時時間（毫秒） */
const REQUEST_TIMEOUT_MS = 10_000;

/** 快取存活時間（毫秒）— 5 分鐘 */
const CACHE_TTL_MS = 5 * 60 * 1_000;

/** 座標精度（小數位數）— 4 位 ≈ 11m 精度，避免微小漂移產生不同 key */
const COORD_PRECISION = 4;

// ── 快取層 ─────────────────────────────────────────────────────────────────

interface CacheEntry {
    data: Restaurant[];
    timestamp: number;
}

/** 以 Map 儲存的 in-memory 快取，key = 座標+半徑+分類組合 */
const nearbyCache = new Map<string, CacheEntry>();

/**
 * 產生快取 key。
 * 將座標四捨五入到指定精度，避免 GPS 微小漂移造成 cache miss。
 */
const buildCacheKey = (params: GetNearestRestaurantsParams): string => {
    const lat = params.latitude.toFixed(COORD_PRECISION);
    const lng = params.longitude.toFixed(COORD_PRECISION);
    const radius = params.radius ?? DEFAULT_RADIUS_M;
    const category = params.category ?? 'all';
    return `${lat}|${lng}|${radius}|${category}`;
};

/**
 * 嘗試從快取取得資料。
 * @returns 命中時回傳 Restaurant[]，未命中或過期回傳 null。
 */
const getCachedResult = (key: string): Restaurant[] | null => {
    const entry = nearbyCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        nearbyCache.delete(key);
        return null;
    }
    return entry.data;
};

/** 寫入快取 */
const setCacheResult = (key: string, data: Restaurant[]): void => {
    nearbyCache.set(key, { data, timestamp: Date.now() });
};

/** Google Places 餐廳類型對照表（Places API New 使用 includedTypes） */


// ── Mock 資料（API Key 未設定時作為 Fallback）───────────────────────────────

const MOCK_RESTAURANTS: Restaurant[] = [
    {
        id: 'mock-1',
        name: '老王牛肉麵',
        category: '麵類',
        rating: 4.5,
        isOpenNow: true,
        distanceMeter: 350,
        estimatedTimeMins: 5,
        address: '高雄市前金區自強一路',
    },
    {
        id: 'mock-2',
        name: '美好早午餐',
        category: '早午餐',
        rating: 4.2,
        isOpenNow: true,
        distanceMeter: 800,
        estimatedTimeMins: 10,
        address: '高雄市新興區中山一路',
    },
    {
        id: 'mock-3',
        name: '天天火鍋',
        category: '火鍋',
        rating: 4.8,
        isOpenNow: false,
        distanceMeter: 1200,
        estimatedTimeMins: 15,
        address: '高雄市苓雅區四維三路',
    },
    {
        id: 'mock-4',
        name: '阿美便當',
        category: '飯類',
        rating: 3.9,
        isOpenNow: true,
        distanceMeter: 150,
        estimatedTimeMins: 2,
        address: '高雄市前鎮區中華五路',
    },
];

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
            if (err.name === 'AbortError') throw new Error('Request timeout');
            throw err;
        });
};

/**
 * 根據兩點經緯度計算距離（Haversine 公式）
 * @returns 距離（公尺）
 */
const haversineDistance = (
    lat1: number, lng1: number,
    lat2: number, lng2: number,
): number => {
    const R = 6371_000; // 地球半徑（公尺）
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
};

/**
 * 根據距離估算步行 / 騎車 / 開車的交通時間（分鐘）
 * 保守估計：假設平均步行速度 ~80m/min
 */
const estimateTimeMins = (distanceMeter: number): number => {
    return Math.max(1, Math.round(distanceMeter / 80));
};

// ── Google Places API 回應型別 ──────────────────────────────────────────────

interface PlaceResult {
    id: string;
    displayName?: { text?: string; languageCode?: string };
    primaryType?: string;
    primaryTypeDisplayName?: { text?: string };
    rating?: number;
    formattedAddress?: string;
    shortFormattedAddress?: string;
    location?: { latitude: number; longitude: number };
    currentOpeningHours?: { openNow?: boolean };
    regularOpeningHours?: { openNow?: boolean };
}

interface NearbySearchResponse {
    places?: PlaceResult[];
}

/**
 * 將 Google Places API 的回應轉換為 App 內部的 Restaurant 模型
 */
const placeToRestaurant = (
    place: PlaceResult,
    userLat: number,
    userLng: number,
): Restaurant => {
    const lat = place.location?.latitude ?? 0;
    const lng = place.location?.longitude ?? 0;
    const distance = haversineDistance(userLat, userLng, lat, lng);

    // 使用集中管理的 resolveCategory 確保分類標籤與篩選器同步
    const category = resolveCategory(
        place.primaryType ?? undefined,
        place.primaryTypeDisplayName?.text ?? undefined,
    );

    return {
        id: place.id,
        name: place.displayName?.text ?? '未知餐廳',
        category,
        rating: place.rating ?? 0,
        isOpenNow:
            place.currentOpeningHours?.openNow ??
            place.regularOpeningHours?.openNow ??
            true, // 無資料時預設為營業中
        distanceMeter: distance,
        estimatedTimeMins: estimateTimeMins(distance),
        address: place.shortFormattedAddress ?? place.formattedAddress ?? undefined,
    };
};

// ── Service ─────────────────────────────────────────────────────────────────

export const restaurantService = {
    /**
     * 清除所有附近餐廳的快取。
     * 用於下拉刷新等需要強制重新取得最新資料的場景。
     */
    clearCache: (): void => {
        const count = nearbyCache.size;
        nearbyCache.clear();
        console.log(`[restaurantService.clearCache] Cleared ${count} cached entries.`);
    },

    /**
     * 取得附近餐廳清單。
     *
     * 快取策略：
     *   相同座標（±11m）+ 相同篩選條件在 5 分鐘內回傳快取結果，不呼叫 API。
     *
     * - 若 Google Places API Key 已設定：
     *   呼叫 Places API (New) Nearby Search
     * - 否則：
     *   降級為 Mock 資料（開發 / CI 環境）
     */
    getNearest: async (
        params: GetNearestRestaurantsParams,
    ): Promise<GetNearestRestaurantsResponse> => {
        // ── 快取檢查 ──
        const cacheKey = buildCacheKey(params);
        const cached = getCachedResult(cacheKey);
        if (cached) {
            console.log(`[restaurantService.getNearest] Cache HIT (key=${cacheKey}, ${cached.length} items)`);
            return { success: true, data: cached };
        }
        console.log(`[restaurantService.getNearest] Cache MISS (key=${cacheKey})`);

        const configured = isPlacesApiConfigured();
        console.log('[restaurantService.getNearest] isPlacesApiConfigured:', configured);
        console.log('[restaurantService.getNearest] params:', JSON.stringify(params));

        if (configured) {
            try {
                const radius = params.radius ?? DEFAULT_RADIUS_M;

                // 建構 Nearby Search (New) 請求 body
                const requestBody: Record<string, unknown> = {
                    locationRestriction: {
                        circle: {
                            center: {
                                latitude: params.latitude,
                                longitude: params.longitude,
                            },
                            radius: radius,
                        },
                    },
                    // 搜尋結果數量上限
                    maxResultCount: params.limit ?? 20,
                    // 語系偏好
                    languageCode: 'zh-TW',
                };

                // 若有分類篩選，加入 includedTypes
                if (params.category && params.category !== '全部') {
                    const placeType = CATEGORY_TO_PLACES_TYPE[params.category] ?? 'restaurant';
                    requestBody.includedTypes = [placeType];
                } else {
                    // 預設搜尋所有餐飲場所
                    requestBody.includedTypes = ['restaurant'];
                }

                // 呼叫 Places API (New)
                const response = await fetchWithTimeout(PLACES_NEARBY_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
                        // 指定需要的欄位（Field Mask），控制費用 & 回應大小
                        'X-Goog-FieldMask': [
                            'places.id',
                            'places.displayName',
                            'places.primaryType',
                            'places.primaryTypeDisplayName',
                            'places.rating',
                            'places.formattedAddress',
                            'places.shortFormattedAddress',
                            'places.location',
                            'places.currentOpeningHours',
                            'places.regularOpeningHours',
                        ].join(','),
                    },
                    body: JSON.stringify(requestBody),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(
                        `[restaurantService.getNearest] Places API error ${response.status}:`,
                        errorText,
                    );
                    throw new Error(`Places API Error: ${response.status}`);
                }

                const data: NearbySearchResponse = await response.json();
                const places = data.places ?? [];

                console.log(
                    `[restaurantService.getNearest] Places API returned ${places.length} results`,
                );

                // 轉換為 App 內部模型，按距離排序
                const restaurants = places
                    .map((p) =>
                        placeToRestaurant(p, params.latitude, params.longitude),
                    )
                    .sort((a, b) => a.distanceMeter - b.distanceMeter);

                // 寫入快取
                setCacheResult(cacheKey, restaurants);
                return { success: true, data: restaurants };
            } catch (err: unknown) {
                const message =
                    err instanceof Error ? err.message : '無法取得附近餐廳';
                console.error(
                    '[restaurantService.getNearest] Error:',
                    message,
                );
                throw new Error(message);
            }
        }

        // ── Mock fallback ────────────────────────────────────────────────────
        console.log('[restaurantService.getNearest] Using MOCK fallback data');

        // 根據使用者位置動態調整 Mock 資料的距離
        // （讓 Mock 在任何位置都看起來合理）
        let filtered = MOCK_RESTAURANTS.map((r) => ({ ...r }));

        if (params.category && params.category !== '全部') {
            filtered = filtered.filter((r) => r.category === params.category);
        }
        if (params.radius) {
            filtered = filtered.filter(
                (r) => r.distanceMeter <= params.radius!,
            );
        }

        console.log(
            `[restaurantService.getNearest] Returning ${filtered.length} mock restaurants`,
        );
        // Mock 也寫入快取（與 API 行為一致）
        setCacheResult(cacheKey, filtered);
        return { success: true, data: filtered };
    },

    /**
     * 從符合條件的「營業中」餐廳隨機抽取一家。
     *
     * 先呼叫 getNearest 取得候選清單，再 client-side 隨機抽取。
     */
    getRandom: async (
        params: GetRandomRestaurantParams,
    ): Promise<GetRandomRestaurantResponse> => {
        const nearestResult = await restaurantService.getNearest({
            ...params,
            radius: DEFAULT_RADIUS_M,
        });

        const candidates = nearestResult.data.filter((r) => r.isOpenNow);

        if (candidates.length === 0) {
            return {
                success: false,
                data: null,
                message: '找不到符合條件且營業中的餐廳',
            };
        }

        const randomIndex = Math.floor(Math.random() * candidates.length);
        return {
            success: true,
            data: candidates[randomIndex],
        };
    },
};
