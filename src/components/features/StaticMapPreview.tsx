// ============================================================================
// 🗺️ StaticMapPreview.tsx — 靜態地圖預覽元件
// ============================================================================
//
// 💡 使用場景：
//   在搜尋結果或分享匯入的餐廳預覽中，顯示一張帶有 Pin 的靜態地圖截圖，
//   讓使用者一眼確認餐廳位置是否正確。
//
// 🔑 依賴：
//   - Google Static Maps API（使用 EXPO_PUBLIC_GOOGLE_PLACES_API_KEY）
//   - 零額外套件：僅用 Image + View 渲染
//
// 💰 費用：
//   - Static Maps API 每月免費額度 28,500 次載入
//   - 每次顯示僅消耗 1 次 API 呼叫（圖片快取後不重複計費）
// ============================================================================

import React, { useState, useCallback } from 'react';
import { View, Image, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';

// ── 設定常數 ─────────────────────────────────────────────────────────────────

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

/** 預設地圖尺寸 */
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 150;

/** 預設縮放等級（16 大約是街道等級） */
const DEFAULT_ZOOM = 16;

/** Google Static Maps API base URL */
const STATIC_MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api/staticmap';

// ── Props ───────────────────────────────────────────────────────────────────

export interface StaticMapPreviewProps {
    /** 緯度 */
    latitude: number;
    /** 經度 */
    longitude: number;
    /** 地圖寬度（像素），預設 300 */
    width?: number;
    /** 地圖高度（像素），預設 150 */
    height?: number;
    /** 縮放等級（1~20），預設 16 */
    zoom?: number;
    /** Pin 標籤文字（單一字元或短文字） */
    label?: string;
    /** 無法載入地圖時顯示的替代地址文字 */
    fallbackAddress?: string;
}

// ── 工具函式 ─────────────────────────────────────────────────────────────────

/**
 * 產生 Google Static Maps API 圖片 URL。
 *
 * @returns 完整的 Static Maps URL，包含 Pin 和縮放等級
 */
function buildStaticMapUrl(
    latitude: number,
    longitude: number,
    width: number,
    height: number,
    zoom: number,
    label?: string,
): string {
    const center = `${latitude},${longitude}`;
    // 高 DPI 裝置使用 scale=2 確保清晰度
    const scale = Platform.OS === 'web' ? 1 : 2;
    const markerLabel = label ? `|label:${label.charAt(0).toUpperCase()}` : '';
    const marker = `color:red${markerLabel}|${center}`;

    const params = new URLSearchParams({
        center,
        zoom: String(zoom),
        size: `${width}x${height}`,
        scale: String(scale),
        maptype: 'roadmap',
        markers: marker,
        key: GOOGLE_PLACES_API_KEY,
        language: 'zh-TW',
    });

    return `${STATIC_MAPS_BASE_URL}?${params.toString()}`;
}

/**
 * 判斷 API Key 是否已設定。
 */
function isApiKeyConfigured(): boolean {
    return GOOGLE_PLACES_API_KEY.length > 0
        && !GOOGLE_PLACES_API_KEY.includes('your-api-key');
}

// ── 元件 ────────────────────────────────────────────────────────────────────

/**
 * 靜態地圖預覽元件。
 *
 * 使用 Google Static Maps API 顯示一張帶有紅色 Pin 的地圖截圖。
 * API Key 未設定或載入失敗時會降級顯示文字地址。
 *
 * @example
 * ```tsx
 * <StaticMapPreview
 *     latitude={25.033}
 *     longitude={121.565}
 *     fallbackAddress="台北市信義區信義路五段7號"
 * />
 * ```
 */
export const StaticMapPreview: React.FC<StaticMapPreviewProps> = ({
    latitude,
    longitude,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    zoom = DEFAULT_ZOOM,
    label,
    fallbackAddress,
}) => {
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<boolean>(false);

    const handleLoad = useCallback(() => {
        setLoading(false);
        setError(false);
    }, []);

    const handleError = useCallback(() => {
        setLoading(false);
        setError(true);
    }, []);

    // ── API Key 未設定 → 顯示 fallback ──
    if (!isApiKeyConfigured()) {
        return (
            <View style={[styles.container, styles.fallbackContainer, { width, height }]}>
                <Text style={styles.fallbackIcon}>📍</Text>
                <Text style={styles.fallbackText} numberOfLines={2}>
                    {fallbackAddress || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
                </Text>
                <Text style={styles.fallbackHint}>地圖預覽需要 API Key</Text>
            </View>
        );
    }

    const mapUrl = buildStaticMapUrl(latitude, longitude, width, height, zoom, label);

    // ── 載入失敗 → 顯示 fallback ──
    if (error) {
        return (
            <View style={[styles.container, styles.fallbackContainer, { width, height }]}>
                <Text style={styles.fallbackIcon}>🗺️</Text>
                <Text style={styles.fallbackText} numberOfLines={2}>
                    {fallbackAddress || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
                </Text>
                <Text style={styles.fallbackHint}>地圖載入失敗</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { width, height }]}>
            {loading && (
                <View style={[styles.loadingOverlay, { width, height }]}>
                    <ActivityIndicator size="small" color="#666" />
                    <Text style={styles.loadingText}>載入地圖...</Text>
                </View>
            )}
            <Image
                source={{ uri: mapUrl }}
                style={[styles.mapImage, { width, height }]}
                resizeMode="cover"
                onLoad={handleLoad}
                onError={handleError}
                accessibilityLabel={`${fallbackAddress ?? '餐廳位置'}的地圖預覽`}
            />
        </View>
    );
};

// ── 樣式 ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#f0f0f0',
        position: 'relative',
    },
    mapImage: {
        borderRadius: 12,
    },
    loadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f0f0f0',
        zIndex: 1,
        borderRadius: 12,
    },
    loadingText: {
        marginTop: 6,
        fontSize: 12,
        color: '#888',
    },
    fallbackContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
        borderWidth: 1,
        borderColor: '#e0e0e0',
        borderStyle: 'dashed',
        paddingHorizontal: 16,
    },
    fallbackIcon: {
        fontSize: 24,
        marginBottom: 6,
    },
    fallbackText: {
        fontSize: 13,
        color: '#555',
        textAlign: 'center',
        lineHeight: 18,
    },
    fallbackHint: {
        fontSize: 11,
        color: '#aaa',
        marginTop: 4,
    },
});
