// ============================================================================
// 📍 useLocation — 取得使用者目前位置
// ============================================================================
//
// 💡 設計決策：
//   - Native（iOS/Android）：使用 expo-location（處理權限 + GPS）
//   - Web：直接使用瀏覽器原生 navigator.geolocation API
//     原因：expo-location 在 Web 端是對 navigator.geolocation 的封裝，
//     但在某些 Expo 版本中封裝層有 Bug（Permission API 不一致、timeout 處理異常），
//     直接呼叫原生 API 更可靠，也跟 Google Maps 網頁版使用相同的定位管道。
//   - 若權限被拒、定位失敗或逾時，自動回退到預設座標（高雄市中心）
//
// 🗺️ Fallback 座標：高雄美麗島站附近（22.6273, 120.3014）
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

// ── 型別定義 ──
interface LocationData {
    latitude: number | null;
    longitude: number | null;
    error: string | null;
    loading: boolean;
    /** 是否正在使用 Fallback 預設座標（非真實定位） */
    isFallback: boolean;
}

/** 高雄市中心假座標（開發用 Fallback / 權限被拒時的預設值） */
const FALLBACK_COORDS = { latitude: 22.6273, longitude: 120.3014 };

/** 定位取得的最大等待時間（毫秒） */
const LOCATION_TIMEOUT_MS = 10_000;

// ── Hook 本體 ──

export const useLocation = () => {
    const [location, setLocation] = useState<LocationData>({
        latitude: null,
        longitude: null,
        error: null,
        loading: true,
        isFallback: false,
    });

    const cancelledRef = useRef(false);

    const safeSetLocation = (data: LocationData) => {
        if (!cancelledRef.current) {
            setLocation(data);
        }
    };

    const applyFallback = (reason: string) => {
        console.warn(`[useLocation] ${reason}, using fallback coordinates.`);
        safeSetLocation({
            ...FALLBACK_COORDS,
            error: `${reason}（使用預設位置：高雄市中心）`,
            loading: false,
            isFallback: true,
        });
    };

    // ─────────────────────────────────────────────────────────────────────
    // 🌐 Web 專用：直接使用瀏覽器 navigator.geolocation
    // ─────────────────────────────────────────────────────────────────────
    const getLocationWeb = () => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            applyFallback('瀏覽器不支援 Geolocation API');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            // ── 成功回調 ──
            (position) => {
                const { latitude, longitude } = position.coords;
                console.log(`[useLocation][Web] Got position: ${latitude}, ${longitude}`);
                safeSetLocation({
                    latitude,
                    longitude,
                    error: null,
                    loading: false,
                    isFallback: false,
                });
            },
            // ── 失敗回調 ──
            (geoError) => {
                // GeolocationPositionError.code:
                //   1 = PERMISSION_DENIED
                //   2 = POSITION_UNAVAILABLE
                //   3 = TIMEOUT
                const messages: Record<number, string> = {
                    1: '定位權限被拒絕（請在瀏覽器網址列允許定位）',
                    2: '無法取得位置資訊',
                    3: `定位逾時（超過 ${LOCATION_TIMEOUT_MS / 1000} 秒）`,
                };
                const reason = messages[geoError.code] ?? `定位錯誤：${geoError.message}`;
                applyFallback(reason);
            },
            // ── 選項 ──
            {
                enableHighAccuracy: false,  // 桌機不需高精度，加速回應
                timeout: LOCATION_TIMEOUT_MS,
                maximumAge: 60_000,         // 接受 1 分鐘內的快取位置
            },
        );
    };

    // ─────────────────────────────────────────────────────────────────────
    // 📱 Native 專用：使用 expo-location
    // ─────────────────────────────────────────────────────────────────────
    const getLocationNative = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                applyFallback('定位權限未授權');
                return;
            }

            // 使用 Promise.race 確保不會無限等待
            const locationPromise = Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
            });
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('定位逾時')), LOCATION_TIMEOUT_MS),
            );

            const loc = await Promise.race([locationPromise, timeoutPromise]);

            const { latitude, longitude } = loc.coords;
            if (latitude === 0 && longitude === 0) {
                applyFallback('取得無效座標 (0, 0)');
                return;
            }

            safeSetLocation({
                latitude,
                longitude,
                error: null,
                loading: false,
                isFallback: false,
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : '無法獲取定位';
            applyFallback(message);
        }
    };

    // ─────────────────────────────────────────────────────────────────────
    // 🚀 統一入口
    // ─────────────────────────────────────────────────────────────────────
    const getLocationAsync = () => {
        safeSetLocation({
            latitude: null,
            longitude: null,
            error: null,
            loading: true,
            isFallback: false,
        });

        if (Platform.OS === 'web') {
            getLocationWeb();
        } else {
            getLocationNative();
        }
    };

    useEffect(() => {
        cancelledRef.current = false;
        getLocationAsync();

        return () => {
            cancelledRef.current = true;
        };
    }, []);

    return { location, refetchLocation: getLocationAsync };
};
