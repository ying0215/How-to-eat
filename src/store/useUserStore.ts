import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemeMode } from '../constants/theme';

/** 使用者偏好設定 Store
 *  職責：管理交通方式偏好、最高交通時間限制、外觀主題。
 *  最愛餐廳清單請使用 useFavoriteStore。
 *
 *  🔧 持久化至 AsyncStorage（key: "user-preferences-storage"），
 *     App 重啟後偏好設定不會遺失。
 */
interface UserState {
    transportMode: 'walk' | 'drive' | 'transit';
    maxTimeMins: number;
    themeMode: ThemeMode;
    setTransportMode: (mode: 'walk' | 'drive' | 'transit') => void;
    setMaxTimeMins: (mins: number) => void;
    setThemeMode: (mode: ThemeMode) => void;
}

export const useUserStore = create<UserState>()(
    persist(
        (set) => ({
            transportMode: 'walk',
            maxTimeMins: 30,
            themeMode: 'light' as ThemeMode,
            setTransportMode: (mode) => set({ transportMode: mode }),
            setMaxTimeMins: (mins) => set({ maxTimeMins: mins }),
            setThemeMode: (mode) => set({ themeMode: mode }),
        }),
        {
            name: 'user-preferences-storage',
            storage: createJSONStorage(() => AsyncStorage),
        },
    ),
);
