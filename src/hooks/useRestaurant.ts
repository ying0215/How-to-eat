import { useState, useCallback } from 'react';
import { Restaurant } from '../types/models';
import { restaurantService } from '../services/restaurant';
import { GetNearestRestaurantsParams, GetRandomRestaurantParams } from '../types/api';

export function useRestaurant() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
    const [currentRandom, setCurrentRandom] = useState<Restaurant | null>(null);

    const fetchNearest = useCallback(async (params: GetNearestRestaurantsParams) => {
        setLoading(true);
        setError(null);
        try {
            const response = await restaurantService.getNearest(params);
            if (response.success) {
                setRestaurants(response.data);
            } else {
                setError(response.message || '無法取得餐廳資料');
            }
        } catch (err: any) {
            setError(err.message || '發生未知錯誤');
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchRandom = useCallback(async (params: GetRandomRestaurantParams) => {
        setLoading(true);
        setError(null);
        try {
            const response = await restaurantService.getRandom(params);
            if (response.success) {
                setCurrentRandom(response.data);
            } else {
                setError(response.message || '無法抽取餐廳');
                setCurrentRandom(null);
            }
        } catch (err: any) {
            setError(err.message || '發生未知錯誤');
            setCurrentRandom(null);
        } finally {
            setLoading(false);
        }
    }, []);

    const clearRandom = useCallback(() => {
        setCurrentRandom(null);
    }, []);

    return {
        loading,
        error,
        restaurants,
        currentRandom,
        fetchNearest,
        fetchRandom,
        clearRandom,
    };
}
