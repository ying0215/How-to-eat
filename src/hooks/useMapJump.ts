// ============================================================================
// 🗺️ useMapJump — 跳轉外部 Google Maps 進行導航
// ============================================================================
//
// 💡 設計決策（方案 B：外部跳轉 Google Maps App）：
//   使用 Google Maps Universal URL Scheme 開啟外部 Google Maps 進行導航。
//   不嵌入地圖 SDK，原因：
//     1. 餐廳推薦 App 的核心功能不是導航本身
//     2. 外部 Google Maps 提供完整的語音提示、即時路況、離線地圖
//     3. 免費且零維護（不需要 Maps SDK API Key）
//     4. App 體積不會膨脹（省下 +10~20MB）
//
// 🐛 重要修復：
//   - 移除 canOpenURL 預檢：對 https:// URL 不需要，且在 Web 環境
//     和未設定 Info.plist LSApplicationQueriesSchemes 的 iOS 上會回傳 false
//   - Web 環境使用 window.open fallback（Linking.openURL 在部分 Web 環境不穩）
//   - 新增使用者可見的 Alert 錯誤提示（取代原本的 console.warn）
// ============================================================================

import { Alert, Linking, Platform } from 'react-native';

// ── 交通方式對應表 ──
const TRAVEL_MODE_MAP: Record<'walk' | 'drive' | 'transit', string> = {
    walk: 'walking',
    drive: 'driving',
    transit: 'transit',
} as const;

/**
 * 構建 Google Maps Directions URL
 *
 * @param destination - 終點名稱、地址或經緯度（例: "台北101"、"25.033,121.565"）
 * @param travelmode - Google Maps API 的交通模式字串（walking / driving / transit）
 * @returns 完整的 Google Maps Directions URL
 *
 * @see https://developers.google.com/maps/documentation/urls/get-started#directions-action
 */
function buildGoogleMapsUrl(destination: string, travelmode: string): string {
    const query = encodeURIComponent(destination);
    return `https://www.google.com/maps/dir/?api=1&destination=${query}&travelmode=${travelmode}`;
}

/**
 * 在 Web 環境下開啟 URL
 *
 * Web 環境使用 window.open 取代 Linking.openURL，避免部分瀏覽器
 * 攔截 Linking.openURL 的行為（尤其是 Safari 的 pop-up blocker）。
 *
 * @param url - 要開啟的 URL
 * @returns 是否成功開啟（window.open 回傳 null 表示被瀏覽器阻擋）
 */
function openUrlOnWeb(url: string): boolean {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
        const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
        return newWindow !== null;
    }
    return false;
}

/**
 * 向使用者顯示導航失敗的錯誤提示
 *
 * @param destination - 原始輸入的目的地名稱，用於錯誤訊息中顯示
 * @param error - 捕捉到的錯誤物件（可能是 Error 或任意型別）
 */
function showNavigationError(destination: string, error?: unknown): void {
    const errorDetail = error instanceof Error ? `\n\n技術細節：${error.message}` : '';
    Alert.alert(
        '無法開啟導航',
        `無法開啟 Google Maps 導航至「${destination}」。\n\n請確認：\n• 裝置已安裝 Google Maps 或瀏覽器\n• 網路連線正常${errorDetail}`,
        [{ text: '知道了', style: 'default' }],
    );
}

export const useMapJump = () => {
    /**
     * 觸發外部 Google Maps 進行導航
     *
     * @param destination - 終點名稱、地址或經緯度（例: "台北101"、"25.033,121.565"）
     * @param mode - 交通方式: 'walk' | 'drive' | 'transit'
     *
     * 行為：
     * - iOS / Android：透過 Linking.openURL 開啟 Google Maps App（若未安裝則開啟瀏覽器）
     * - Web：透過 window.open 在新分頁開啟 Google Maps 網頁版
     * - 任何失敗情境：顯示 Alert 提示使用者
     */
    const jumpToMap = async (
        destination: string,
        mode: 'walk' | 'drive' | 'transit',
    ): Promise<void> => {
        const travelmode = TRAVEL_MODE_MAP[mode];
        const url = buildGoogleMapsUrl(destination, travelmode);

        // ── Web 環境 ──
        if (Platform.OS === 'web') {
            const success = openUrlOnWeb(url);
            if (!success) {
                // window.open 被瀏覽器 pop-up blocker 攔截，fallback 到 Linking
                try {
                    await Linking.openURL(url);
                } catch (err) {
                    console.error('[useMapJump] Web fallback Linking.openURL 失敗:', err);
                    showNavigationError(destination, err);
                }
            }
            return;
        }

        // ── Native 環境（iOS / Android）──
        // 直接使用 Linking.openURL，不做 canOpenURL 預檢。
        // 原因：
        //   1. https:// URL 在所有裝置上都有瀏覽器可以開啟
        //   2. canOpenURL 在 iOS 上需要 Info.plist 白名單設定，否則一律回傳 false
        //   3. 即使 canOpenURL 回傳 true，openURL 仍可能失敗（反之亦然）
        //   4. 直接 try/catch openURL 是更可靠的錯誤處理策略
        try {
            await Linking.openURL(url);
        } catch (err) {
            console.error('[useMapJump] Linking.openURL 失敗:', err);
            showNavigationError(destination, err);
        }
    };

    return { jumpToMap };
};
