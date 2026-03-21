// ============================================================================
// 🔍 placeSearch.ts — Google Places Text Search 服務
// ============================================================================
//
// 💡 架構決策：
//   使用 Google Places API (New) Text Search 搜尋餐廳。
//   使用者在「新增最愛」流程中輸入關鍵字，呼叫此 API 取得精確的餐廳清單。
//
// 🔑 所需環境變數：
//   EXPO_PUBLIC_GOOGLE_PLACES_API_KEY — Google Places API 金鑰
//
// 📖 API 文件：
//   https://developers.google.com/maps/documentation/places/web-service/text-search
//
// 💰 費用控制策略：
//   - 僅在使用者主動搜尋時觸發（非即時自動補全），大幅降低呼叫頻率
//   - Field Mask 限制最小回傳欄位集合
//   - 預設 maxResultCount = 5 限制結果數量
// ============================================================================

import { PlaceSearchResult } from '../types/models';
import { resolveCategory } from '../constants/categories';
import { fetchWithResilience } from '../utils/fetchWithResilience';

// ── 設定常數 ─────────────────────────────────────────────────────────────────

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

/** Google Places API (New) Text Search endpoint */
const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

/** 請求逾時時間（毫秒） */
const REQUEST_TIMEOUT_MS = 10_000;

/** 預設搜尋結果上限 */
const DEFAULT_MAX_RESULTS = 5;

// ── 內部型別 ─────────────────────────────────────────────────────────────────

interface TextSearchPlaceResult {
    id: string;
    displayName?: { text?: string; languageCode?: string };
    primaryType?: string;
    primaryTypeDisplayName?: { text?: string };
    rating?: number;
    formattedAddress?: string;
    shortFormattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    currentOpeningHours?: { openNow?: boolean };
    regularOpeningHours?: { openNow?: boolean };
}

interface TextSearchResponse {
    places?: TextSearchPlaceResult[];
}

// ── 工具函式 ─────────────────────────────────────────────────────────────────

/** 判斷 Google Places API Key 是否已設定 */
const isPlacesApiConfigured = (): boolean => {
    return GOOGLE_PLACES_API_KEY.length > 0
        && !GOOGLE_PLACES_API_KEY.includes('your-api-key');
};



/**
 * 將 Google Places Text Search 回應轉換為 App 內部的 PlaceSearchResult 模型
 */
const placeToSearchResult = (place: TextSearchPlaceResult): PlaceSearchResult => {
    const category = resolveCategory(
        place.primaryType ?? undefined,
        place.primaryTypeDisplayName?.text ?? undefined,
    );

    return {
        placeId: place.id,
        name: place.displayName?.text ?? '未知餐廳',
        address: place.shortFormattedAddress ?? place.formattedAddress ?? '地址不詳',
        category,
        rating: place.rating ?? 0,
        isOpenNow:
            place.currentOpeningHours?.openNow ??
            place.regularOpeningHours?.openNow ??
            true, // 無資料時預設為營業中
        latitude: place.location?.latitude,
        longitude: place.location?.longitude,
    };
};

// ── Service ─────────────────────────────────────────────────────────────────

export const placeSearchService = {
    /**
     * 依關鍵字搜尋餐廳。
     *
     * 使用 Google Places Text Search (New) API，搜尋範圍自動偏向使用者位置。
     *
     * @param query - 搜尋關鍵字（如「鼎泰豐」「星巴克 信義區」）
     * @param locationBias - 可選，使用者當前位置（提升搜近結果排序）
     * @param maxResults - 可選，最大結果數量（預設 5）
     * @returns PlaceSearchResult[] — 搜尋結果清單
     *
     * @throws Error 當 API 回應非 200 或網路錯誤時
     */
    searchPlaces: async (
        query: string,
        locationBias?: { lat: number; lng: number },
        maxResults: number = DEFAULT_MAX_RESULTS,
    ): Promise<PlaceSearchResult[]> => {
        if (!isPlacesApiConfigured()) {
            console.warn('[placeSearchService.searchPlaces] API Key 未設定，回傳空結果');
            return [];
        }

        if (!query.trim()) {
            return [];
        }

        try {
            // 建構 Text Search (New) 請求 body
            const requestBody: Record<string, unknown> = {
                textQuery: query,
                // 語系偏好
                languageCode: 'zh-TW',
                // 限制搜尋結果數量
                maxResultCount: maxResults,
                // 限制搜尋類型為餐飲相關
                includedType: 'restaurant',
            };

            // 若有位置偏向，加入 locationBias
            if (locationBias) {
                requestBody.locationBias = {
                    circle: {
                        center: {
                            latitude: locationBias.lat,
                            longitude: locationBias.lng,
                        },
                        radius: 5000, // 5km 偏向半徑
                    },
                };
            }

            const response = await fetchWithResilience(PLACES_TEXT_SEARCH_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
                    // Field Mask：限制回傳欄位，控制費用
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
            }, { endpointId: 'placeSearch.searchPlaces', maxRetries: 2, timeoutMs: REQUEST_TIMEOUT_MS });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(
                    `[placeSearchService.searchPlaces] API error ${response.status}:`,
                    errorText,
                );
                throw new Error(`Places API 錯誤：${response.status}`);
            }

            const data: TextSearchResponse = await response.json();
            const places = data.places ?? [];

            console.log(
                `[placeSearchService.searchPlaces] 搜尋 "${query}" 回傳 ${places.length} 筆結果`,
            );

            return places.map(placeToSearchResult);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : '搜尋餐廳時發生未知錯誤';
            console.error('[placeSearchService.searchPlaces] Error:', message);
            throw new Error(message);
        }
    },
};
