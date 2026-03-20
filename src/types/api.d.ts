import { Restaurant, Category } from './models';

export interface BaseResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

/**
 * 資料可能為 null 的回應型別，用於「查無結果」的情境。
 * 例如：getRandom 在無符合條件的餐廳時，success=false 且 data=null。
 */
export interface NullableBaseResponse<T> {
    success: boolean;
    data: T | null;
    message?: string;
}

export interface GetNearestRestaurantsParams {
    latitude: number;
    longitude: number;
    radius?: number; // meters
    category?: string;
    limit?: number;
}

export interface GetNearestRestaurantsResponse extends BaseResponse<Restaurant[]> { }

export interface GetRandomRestaurantParams {
    latitude: number;
    longitude: number;
    category?: string; // 可選，如果有篩選特定分類來抽盲盒
}

/** getRandom 失敗時 data 為 null，使用 NullableBaseResponse 確保型別安全 */
export interface GetRandomRestaurantResponse extends NullableBaseResponse<Restaurant> { }

export interface GetCategoriesResponse extends BaseResponse<Category[]> { }
