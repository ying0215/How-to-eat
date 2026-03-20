// ============================================================================
// 🔗 googleMapsUrlParser.ts — Google Maps 分享 URL 解析服務
// ============================================================================
//
// 💡 使用場景：
//   使用者從 Google Maps App「分享」餐廳連結，或手動貼上 URL，
//   自動解析出餐廳名稱、地址、分類等資訊並加入最愛。
//
// 📖 支援的 URL 格式：
//   1. 短連結：https://maps.app.goo.gl/xxxxx
//   2. 長連結：https://www.google.com/maps/place/餐廳名稱/@lat,lng,...
//   3. 搜尋連結：https://www.google.com/maps/search/餐廳名稱/...
//   4. Place ID 連結：https://www.google.com/maps/place/?q=place_id:ChIJ...
//
// 🔑 依賴：
//   - placeSearchService.searchPlaces()（用於將解析出的名稱/座標搜尋完整資料）
//   - EXPO_PUBLIC_GOOGLE_PLACES_API_KEY（placeSearch 內部使用）
// ============================================================================

import { PlaceSearchResult } from '../types/models';
import { placeSearchService } from './placeSearch';

// ── 常數 ─────────────────────────────────────────────────────────────────────

/** 短連結 redirect 的請求逾時（毫秒） */
const REDIRECT_TIMEOUT_MS = 8_000;

/** CORS 代理失敗後的冷卻時間（毫秒）— 避免 429 rate limit */
const PROXY_COOLDOWN_MS = 30_000;

/** 上次 CORS 代理全部失敗的時間戳 */
let _lastProxyFailureTime = 0;

// ── URL 格式辨識正則 ─────────────────────────────────────────────────────────

/** Google Maps 短連結 */
const SHORT_LINK_PATTERN = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\/.+/i;

/** Google Maps 標準連結（含 /place/、/search/、/dir/ 等） */
const STANDARD_LINK_PATTERN = /^https?:\/\/(www\.)?(google\.\w+(\.\w+)?\/maps|maps\.google\.\w+(\.\w+)?)\/.*/i;

/** 從 /place/ URL path 中提取餐廳名稱 */
const PLACE_NAME_PATTERN = /\/place\/([^/@]+)/;

/** 從 /search/ URL path 中提取搜尋關鍵字 */
const SEARCH_QUERY_PATTERN = /\/search\/([^/@]+)/;

/** 從 URL 提取座標（@lat,lng 格式） */
const COORDINATES_PATTERN = /@(-?\d+\.?\d*),(-?\d+\.?\d*)/;

/** 從 URL 查詢參數中提取 Place ID */
const PLACE_ID_QUERY_PATTERN = /[?&](?:query_place_id|ftid)=([^&]+)/;

/** 從 URL path 中提取 place_id: 格式 */
const PLACE_ID_IN_QUERY_PATTERN = /place_id:([A-Za-z0-9_-]+)/;

// ── 內部型別 ─────────────────────────────────────────────────────────────────

/** URL 解析中間結果 */
interface ParsedUrlInfo {
    /** 提取的餐廳名稱或搜尋關鍵字 */
    placeName: string | null;
    /** 經度 */
    latitude: number | null;
    /** 緯度 */
    longitude: number | null;
    /** Google Places ID */
    placeId: string | null;
}

/** 解析結果（包含額外 metadata） */
export interface ParseResult {
    /** 解析出的餐廳資訊（null 表示解析失敗） */
    restaurant: PlaceSearchResult | null;
    /** 解析錯誤訊息（null 表示成功或無資訊） */
    error: string | null;
    /** 解析來源說明 */
    source: 'place_id' | 'name_search' | 'coordinates_search' | 'failed';
}

// ── 工具函式 ─────────────────────────────────────────────────────────────────

/**
 * 判斷給定文字是否為 Google Maps URL。
 *
 * @param text - 要檢查的文字
 * @returns true 如果文字是 Google Maps URL
 */
export function isGoogleMapsUrl(text: string): boolean {
    const trimmed = text.trim();
    return SHORT_LINK_PATTERN.test(trimmed) || STANDARD_LINK_PATTERN.test(trimmed);
}

/**
 * 解碼 URL 中的百分比編碼和加號空格。
 *
 * Google Maps URL path 中的中文/特殊字元會被編碼，
 * 加號（+）在 URL 慣例中可代表空格。
 *
 * @param encoded - 編碼後的字串
 * @returns 解碼後的可讀字串
 */
function decodeUrlComponent(encoded: string): string {
    try {
        // 先把 + 替換成 %20，再做完整 URI 解碼
        return decodeURIComponent(encoded.replace(/\+/g, '%20'));
    } catch {
        // URI 格式不合法時原樣返回
        return encoded.replace(/\+/g, ' ');
    }
}

/**
 * 解析長連結中的結構化資訊。
 *
 * 支援的模式：
 * - /place/Name/@lat,lng,... → 名稱 + 座標
 * - /search/Query/@lat,lng,... → 搜尋關鍵字 + 座標
 * - ?query_place_id=ChIJ... → Place ID
 * - ?q=place_id:ChIJ... → Place ID
 *
 * @param url - 完整的 Google Maps URL
 * @returns ParsedUrlInfo 結構化解析結果
 */
export function extractInfoFromUrl(url: string): ParsedUrlInfo {
    const result: ParsedUrlInfo = {
        placeName: null,
        latitude: null,
        longitude: null,
        placeId: null,
    };

    // 1. 嘗試提取 Place ID（最精確）
    const placeIdFromQuery = url.match(PLACE_ID_QUERY_PATTERN);
    if (placeIdFromQuery) {
        result.placeId = placeIdFromQuery[1];
    }
    const placeIdInQ = url.match(PLACE_ID_IN_QUERY_PATTERN);
    if (placeIdInQ) {
        result.placeId = placeIdInQ[1];
    }

    // 2. 嘗試提取餐廳名稱
    const placeNameMatch = url.match(PLACE_NAME_PATTERN);
    if (placeNameMatch) {
        result.placeName = decodeUrlComponent(placeNameMatch[1]);
    } else {
        const searchMatch = url.match(SEARCH_QUERY_PATTERN);
        if (searchMatch) {
            result.placeName = decodeUrlComponent(searchMatch[1]);
        }
    }

    // 3. 嘗試提取座標
    const coordsMatch = url.match(COORDINATES_PATTERN);
    if (coordsMatch) {
        const lat = parseFloat(coordsMatch[1]);
        const lng = parseFloat(coordsMatch[2]);
        // 基本合法性驗證
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            result.latitude = lat;
            result.longitude = lng;
        }
    }

    return result;
}

/**
 * 重置 CORS 代理冷卻計時器。
 *
 * 用途：單元測試中重置模組狀態，避免測試間互相干擾。
 */
export function resetProxyCooldown(): void {
    _lastProxyFailureTime = 0;
}

/**
 * 展開 Google Maps 短連結，取得 redirect 後的完整 URL。
 *
 * 利用 HTTP GET redirect 追蹤，fetch 自動 follow redirect 後取 response.url。
 *
 * ⚠️ Web 平台注意：
 *   瀏覽器 CORS 政策會阻擋對 maps.app.goo.gl 的跨域請求。
 *   Web 端嘗試一次 CORS 代理展開（帶 30 秒冷卻保護），
 *   若失敗則回傳 null 並在 parseGoogleMapsUrl 中顯示友善提示。
 *
 * @param shortUrl - Google Maps 短連結（maps.app.goo.gl/xxx）
 * @returns 展開後的完整 URL，失敗時回傳 null
 */
async function expandShortUrl(shortUrl: string): Promise<string | null> {
    const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';

    // ── 策略 1：直接 fetch（原生端可用，Web 端因 CORS 通常會失敗）──
    if (!isWeb) {
        return expandShortUrlDirect(shortUrl);
    }

    // ── 策略 2：Web 端使用 CORS 代理（帶冷卻保護）──
    return expandShortUrlViaProxy(shortUrl);
}

/** 原生端：直接 fetch follow redirect */
async function expandShortUrlDirect(shortUrl: string): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REDIRECT_TIMEOUT_MS);

        const response = await fetch(shortUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
        });
        clearTimeout(timer);

        const finalUrl = response.url;
        if (finalUrl && finalUrl !== shortUrl) {
            return finalUrl;
        }

        // 嘗試從 HTML 提取 redirect target
        const html = await response.text();
        const metaRefresh = html.match(/content="\d+;\s*url=([^"]+)"/i);
        if (metaRefresh) return metaRefresh[1];
        const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
        if (canonical) return canonical[1];

        if (STANDARD_LINK_PATTERN.test(finalUrl)) return finalUrl;
        return null;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '展開短連結失敗';
        console.error('[googleMapsUrlParser.expandShortUrl] Error:', message);
        return null;
    }
}

/**
 * Web 端：透過 CORS 代理解析短網址。
 *
 * 使用 corsproxy.io 等公共代理服務做中繼。
 * 內建 30 秒冷卻機制，避免代理失敗後頻繁重試觸發 429 rate limit。
 * 若代理失敗也回傳 null，上層會給出友善提示。
 */
async function expandShortUrlViaProxy(shortUrl: string): Promise<string | null> {
    // ── 冷卻期檢查：避免 429 rate limit ──
    const elapsed = Date.now() - _lastProxyFailureTime;
    if (_lastProxyFailureTime > 0 && elapsed < PROXY_COOLDOWN_MS) {
        const remainSec = Math.ceil((PROXY_COOLDOWN_MS - elapsed) / 1000);
        console.info(
            `[googleMapsUrlParser] CORS 代理冷卻中（剩餘 ${remainSec}s），跳過短連結解析`,
        );
        return null;
    }

    // 嘗試多個公共 CORS 代理（按優先順序）
    const proxyUrls = [
        `https://corsproxy.io/?${encodeURIComponent(shortUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(shortUrl)}`,
    ];

    for (const proxyUrl of proxyUrls) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), REDIRECT_TIMEOUT_MS);

            const response = await fetch(proxyUrl, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
            });
            clearTimeout(timer);

            // 代理成功時：response.url 可能是代理的 URL，需從 body 或 redirect chain 取真實 URL
            const finalUrl = response.url;

            // 如果代理直接 follow 到了 Google Maps 完整 URL
            if (finalUrl && STANDARD_LINK_PATTERN.test(finalUrl)) {
                // 代理成功，重置冷卻計時器
                _lastProxyFailureTime = 0;
                return finalUrl;
            }

            // 否則嘗試從回應內容中提取完整 URL
            const body = await response.text();

            // 嘗試 meta refresh
            const metaRefresh = body.match(/content="\d+;\s*url=([^"]+)"/i);
            if (metaRefresh && STANDARD_LINK_PATTERN.test(metaRefresh[1])) {
                _lastProxyFailureTime = 0;
                return metaRefresh[1];
            }

            // 嘗試 canonical link
            const canonical = body.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
            if (canonical && STANDARD_LINK_PATTERN.test(canonical[1])) {
                _lastProxyFailureTime = 0;
                return canonical[1];
            }

            // 嘗試從 body 中任何 Google Maps URL
            const mapsUrlMatch = body.match(/https?:\/\/(www\.)?google\.\w+(\.\w+)?\/maps\/place\/[^\s"'<>]+/i);
            if (mapsUrlMatch) {
                _lastProxyFailureTime = 0;
                return mapsUrlMatch[0];
            }

            // 這個代理沒有回傳有用結果，嘗試下一個
            continue;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'proxy error';
            console.warn(`[googleMapsUrlParser.expandShortUrl] Proxy failed: ${message}`);
            continue;
        }
    }

    // 所有代理都失敗 → 啟動冷卻計時器
    _lastProxyFailureTime = Date.now();
    console.error(
        '[googleMapsUrlParser.expandShortUrl] All CORS proxies failed for:',
        shortUrl,
        `| 冷卻 ${PROXY_COOLDOWN_MS / 1000}s 後可重試`,
    );
    return null;
}

// ── 主要 Service ─────────────────────────────────────────────────────────────

/**
 * 解析 Google Maps URL 並回傳餐廳資訊。
 *
 * 解析策略（依精確度排序）：
 * 1. 若提取到 Place ID → 用 Place ID 名稱搜尋確認
 * 2. 若提取到名稱 + 座標 → 用名稱搜尋（座標作為 locationBias）
 * 3. 若僅提取到名稱 + 使用者位置 → 用名稱搜尋（使用者位置作為 fallback locationBias）
 * 4. 若僅提取到名稱（無座標） → 用名稱搜尋（無偏向）
 * 5. 以上皆無 → 回傳失敗
 *
 * @param url - Google Maps URL（短連結或長連結）
 * @param userLocation - （可選）使用者當前 GPS 位置，作為搜尋偏向的 fallback
 * @returns ParseResult — 解析結果與 metadata
 */
export async function parseGoogleMapsUrl(
    url: string,
    userLocation?: { lat: number; lng: number } | null,
): Promise<ParseResult> {
    const trimmedUrl = url.trim();

    // ── 驗證基本格式 ──
    if (!isGoogleMapsUrl(trimmedUrl)) {
        return {
            restaurant: null,
            error: '不是有效的 Google Maps 連結',
            source: 'failed',
        };
    }

    // ── 展開短連結 ──
    let fullUrl = trimmedUrl;
    if (SHORT_LINK_PATTERN.test(trimmedUrl)) {
        const expanded = await expandShortUrl(trimmedUrl);
        if (!expanded) {
            const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';
            return {
                restaurant: null,
                error: isWeb
                    ? '短連結無法在瀏覽器中直接解析（CORS 限制）。\n\n' +
                      '請先在瀏覽器新分頁開啟這個短連結，等 Google Maps 載入完成後，' +
                      '從網址列複製完整的 URL（google.com/maps/place/...）再貼上。'
                    : '無法展開短連結，請檢查網路連線或改用完整連結',
                source: 'failed',
            };
        }
        fullUrl = expanded;
    }

    // ── 從 URL 提取結構化資訊 ──
    const info = extractInfoFromUrl(fullUrl);

    // ── 策略 1：有名稱 → 用名稱搜尋（帶座標偏向） ──
    if (info.placeName) {
        try {
            // 優先使用 URL 中的座標，其次使用使用者的 GPS 位置作為 fallback
            const locationBias = (info.latitude && info.longitude)
                ? { lat: info.latitude, lng: info.longitude }
                : (userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined);

            const results = await placeSearchService.searchPlaces(
                info.placeName,
                locationBias,
                3, // 只要前 3 筆就夠了
            );

            if (results.length > 0) {
                return {
                    restaurant: results[0],
                    error: null,
                    source: 'name_search',
                };
            }
        } catch (err: unknown) {
            console.error('[parseGoogleMapsUrl] 名稱搜尋失敗:', err);
            // 繼續嘗試其他策略
        }
    }

    // ── 策略 2：有座標但沒有名稱 → 座標反向搜尋 ──
    if (info.latitude && info.longitude && !info.placeName) {
        try {
            const results = await placeSearchService.searchPlaces(
                '餐廳', // 通用搜尋詞
                { lat: info.latitude, lng: info.longitude },
                1,
            );
            if (results.length > 0) {
                return {
                    restaurant: results[0],
                    error: null,
                    source: 'coordinates_search',
                };
            }
        } catch (err: unknown) {
            console.error('[parseGoogleMapsUrl] 座標搜尋失敗:', err);
        }
    }

    // ── 全部策略失敗 ──
    return {
        restaurant: null,
        error: info.placeName
            ? `無法找到「${info.placeName}」的餐廳資訊，請嘗試手動搜尋`
            : '無法從連結中提取餐廳資訊，請嘗試手動搜尋',
        source: 'failed',
    };
}

// ── 批量解析 ─────────────────────────────────────────────────────────────────

/** 批量解析結果 */
export interface BatchParseResult {
    /** 每個 URL 的個別解析結果 */
    results: ParseResult[];
    /** 成功解析的數量 */
    successCount: number;
    /** 失敗的數量 */
    failedCount: number;
}

/** 最大並行解析數（避免 API Rate Limit） */
const MAX_CONCURRENCY = 3;

/**
 * 批量解析多個 Google Maps URL。
 *
 * 輸入為換行分隔的多個 URL 字串，逐一解析並彙整結果。
 * 使用 semaphore 控制並行度，避免同時發出過多 API 請求。
 *
 * @param input - 換行分隔的多個 URL 字串
 * @returns 彙整後的批量解析結果
 */
export async function batchParseGoogleMapsUrls(
    input: string,
    userLocation?: { lat: number; lng: number } | null,
): Promise<BatchParseResult> {
    // 1. 分割並過濾
    const lines = input
        .split(/[\n\r]+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const validUrls = lines.filter((line) => isGoogleMapsUrl(line));

    if (validUrls.length === 0) {
        return { results: [], successCount: 0, failedCount: 0 };
    }

    // 2. Semaphore-based 並行控制
    let running = 0;
    const waiting: Array<() => void> = [];

    const acquire = (): Promise<void> => {
        if (running < MAX_CONCURRENCY) {
            running++;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            waiting.push(() => {
                running++;
                resolve();
            });
        });
    };

    const release = (): void => {
        running--;
        const next = waiting.shift();
        if (next) next();
    };

    // 3. 並行解析（受 semaphore 限制）
    const promises = validUrls.map(async (url): Promise<ParseResult> => {
        await acquire();
        try {
            return await parseGoogleMapsUrl(url, userLocation);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : '解析失敗';
            return { restaurant: null, error: msg, source: 'failed' };
        } finally {
            release();
        }
    });

    const settled = await Promise.allSettled(promises);
    const results: ParseResult[] = settled.map((s) =>
        s.status === 'fulfilled'
            ? s.value
            : { restaurant: null, error: String(s.reason), source: 'failed' as const },
    );

    const successCount = results.filter((r) => r.restaurant !== null).length;
    const failedCount = results.length - successCount;

    return { results, successCount, failedCount };
}
