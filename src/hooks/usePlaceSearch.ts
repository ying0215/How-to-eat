// ============================================================================
// 🔍 usePlaceSearch — 餐廳搜尋 Hook
// ============================================================================
//
// 封裝 placeSearchService.searchPlaces() 的非同步狀態管理。
// 用於「新增最愛餐廳」Modal 中的搜尋功能。
//
// 提供 debounce 機制避免使用者快速輸入時過度呼叫 API。
// ============================================================================

import { useState, useCallback, useRef } from 'react';
import { PlaceSearchResult } from '../types/models';
import { placeSearchService } from '../services/placeSearch';

/** 搜尋 debounce 延遲（毫秒） */
const DEBOUNCE_MS = 300;

export function usePlaceSearch() {
    const [results, setResults] = useState<PlaceSearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // debounce timer ref
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 追蹤最後一次搜尋的 ID，避免舊結果覆蓋新結果（race condition 防護）
    const lastSearchId = useRef(0);

    /**
     * 觸發搜尋（帶 debounce）。
     *
     * @param query - 搜尋關鍵字
     * @param locationBias - 可選，使用者當前位置
     */
    const search = useCallback(
        (query: string, locationBias?: { lat: number; lng: number }) => {
            // 清除前一次的 debounce timer
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
            }

            // 空白查詢 → 清空結果
            if (!query.trim()) {
                setResults([]);
                setError(null);
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);

            debounceTimer.current = setTimeout(async () => {
                const searchId = ++lastSearchId.current;

                try {
                    const data = await placeSearchService.searchPlaces(
                        query,
                        locationBias,
                    );

                    // 只接受最新一次搜尋的結果
                    if (searchId === lastSearchId.current) {
                        setResults(data);
                        setError(null);
                    }
                } catch (err: unknown) {
                    if (searchId === lastSearchId.current) {
                        setError(
                            err instanceof Error
                                ? err.message
                                : '搜尋時發生未知錯誤',
                        );
                        setResults([]);
                    }
                } finally {
                    if (searchId === lastSearchId.current) {
                        setLoading(false);
                    }
                }
            }, DEBOUNCE_MS);
        },
        [],
    );

    /**
     * 立即搜尋（不 debounce）。
     * 用於使用者按下「搜尋」按鈕時。
     */
    const searchImmediate = useCallback(
        async (query: string, locationBias?: { lat: number; lng: number }) => {
            // 清除前一次的 debounce timer
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
            }

            if (!query.trim()) {
                setResults([]);
                setError(null);
                return;
            }

            const searchId = ++lastSearchId.current;
            setLoading(true);
            setError(null);

            try {
                const data = await placeSearchService.searchPlaces(
                    query,
                    locationBias,
                );

                if (searchId === lastSearchId.current) {
                    setResults(data);
                    setError(null);
                }
            } catch (err: unknown) {
                if (searchId === lastSearchId.current) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : '搜尋時發生未知錯誤',
                    );
                    setResults([]);
                }
            } finally {
                if (searchId === lastSearchId.current) {
                    setLoading(false);
                }
            }
        },
        [],
    );

    /**
     * 清除搜尋結果與錯誤狀態。
     */
    const clearResults = useCallback(() => {
        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
        }
        setResults([]);
        setError(null);
        setLoading(false);
    }, []);

    return {
        /** 搜尋結果清單 */
        results,
        /** 是否正在搜尋 */
        loading,
        /** 搜尋錯誤訊息 */
        error,
        /** 觸發 debounced 搜尋 */
        search,
        /** 立即搜尋（不 debounce） */
        searchImmediate,
        /** 清除搜尋結果 */
        clearResults,
    };
}
