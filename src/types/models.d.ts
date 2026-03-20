export interface Restaurant {
    id: string;
    name: string;
    category: string;
    rating: number;
    isOpenNow: boolean;
    distanceMeter: number;
    estimatedTimeMins: number; // 預估交通時間
    imageUrl?: string;
    address?: string;
}

export interface Category {
    id: string;
    name: string;
}

/**
 * Google Places Text Search 結果。
 * 用於「新增最愛」搜尋流程，使用者從搜尋結果中選取餐廳加入最愛。
 */
export interface PlaceSearchResult {
    /** Google Places ID（用於後續 Place Details 查詢） */
    placeId: string;
    /** 餐廳顯示名稱 */
    name: string;
    /** 完整地址 */
    address: string;
    /** 餐廳分類（如「餐廳」「咖啡廳」「早午餐」） */
    category: string;
    /** Google 評分 (0–5) */
    rating: number;
    /** 目前是否營業中 */
    isOpenNow: boolean;
    /** 緯度（用於靜態地圖預覽） */
    latitude?: number;
    /** 經度（用於靜態地圖預覽） */
    longitude?: number;
}
