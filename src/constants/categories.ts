// ============================================================================
// 🍽️ categories.ts — 餐廳分類集中設定
// ============================================================================
//
// 💡 單一來源 (Single Source of Truth)：
//   所有分類資料集中在這裡管理。新增分類只需在 FOOD_CATEGORIES 加一行。
//   以下模組自動同步：
//     - nearest.tsx       → 分類 Chip 列
//     - FilterModal.tsx   → 篩選 Modal 分類選項
//     - restaurant.ts     → 分類 → Google Places type 對照
//
// 📖 Google Places API 支援的餐廳類型參考：
//   https://developers.google.com/maps/documentation/places/web-service/place-types
//
// ⚡ 新增分類範例：
//   在 FOOD_CATEGORIES 陣列加一行即可：
//   { label: '拉麵', placesType: 'ramen_restaurant' },
// ============================================================================

export interface FoodCategory {
    /** 使用者看到的顯示名稱 */
    label: string;
    /** 對應 Google Places API (New) 的 includedTypes 值 */
    placesType: string;
}

/**
 * 所有可用的餐廳分類。
 *
 * 要新增分類？在這裡加一行就完成了！
 * placesType 參考：https://developers.google.com/maps/documentation/places/web-service/place-types
 *
 * 常用 placesType：
 *   restaurant          — 一般餐廳（通用）
 *   ramen_restaurant    — 拉麵店
 *   brunch_restaurant   — 早午餐
 *   fast_food_restaurant — 速食
 *   cafe                — 咖啡廳
 *   bakery              — 烘焙坊 / 甜點
 *   barbecue_restaurant — 燒烤
 *   chinese_restaurant  — 中式餐廳
 *   japanese_restaurant — 日式餐廳
 *   korean_restaurant   — 韓式餐廳
 *   indian_restaurant   — 印度餐廳
 *   italian_restaurant  — 義式餐廳
 *   mexican_restaurant  — 墨西哥餐廳
 *   thai_restaurant     — 泰式餐廳
 *   vietnamese_restaurant — 越南餐廳
 *   seafood_restaurant  — 海鮮
 *   steak_house         — 牛排館
 *   sushi_restaurant    — 壽司
 *   vegan_restaurant    — 素食
 *   pizza_restaurant    — 披薩
 *   ice_cream_shop      — 冰淇淋
 *   sandwich_shop       — 三明治
 */
export const FOOD_CATEGORIES: readonly FoodCategory[] = [
    { label: '飯類',     placesType: 'restaurant' },
    { label: '麵類',     placesType: 'ramen_restaurant' },
    { label: '早午餐',   placesType: 'brunch_restaurant' },
    { label: '速食',     placesType: 'fast_food_restaurant' },
    { label: '火鍋',     placesType: 'restaurant' },
    { label: '咖啡廳',   placesType: 'cafe' },
];

// ── 衍生常數（其他模組直接使用，不需各自硬編碼）──

/** Chip / FilterModal 用的標籤陣列（含「全部」） */
export const CATEGORY_LABELS: readonly string[] = [
    '全部',
    ...FOOD_CATEGORIES.map((c) => c.label),
];

/** restaurant.ts 用的分類 → placesType 對照表 */
export const CATEGORY_TO_PLACES_TYPE: Record<string, string> = Object.fromEntries(
    FOOD_CATEGORIES.map((c) => [c.label, c.placesType]),
);

/**
 * placesType → label 逆向查表
 *
 * 用於將 Google Places API 回傳的 primaryType（如 "ramen_restaurant"）
 * 轉換為 App 內部的分類標籤（如 "麵類"）。
 *
 * ⚠️ 注意：多個標籤可能映射到相同的 placesType（如 "飯類" 和 "火鍋" 都用 "restaurant"），
 *         此表選取第一個匹配的標籤。
 */
export const PLACES_TYPE_TO_LABEL: Record<string, string> = Object.fromEntries(
    // 反轉 FOOD_CATEGORIES；後出現的不會覆蓋先出現的（Object.fromEntries 以最後一個為準）
    // 因此先反轉陣列再建表，確保第一個定義的標籤優先
    [...FOOD_CATEGORIES].reverse().map((c) => [c.placesType, c.label]),
);

/**
 * 將 Google Places API 回傳的 primaryType / primaryTypeDisplayName 解析為 App 標籤。
 *
 * 匹配優先序：
 *   1. primaryType 精確匹配 PLACES_TYPE_TO_LABEL
 *   2. primaryTypeDisplayName 精確匹配 CATEGORY_LABELS（已經是中文標籤）
 *   3. 回退到 primaryTypeDisplayName 原始值
 *   4. 將 primaryType 的底線轉空格作為 fallback
 *   5. 預設 '餐廳'
 *
 * @param primaryType - Google Places API 的 primaryType（如 "ramen_restaurant"）
 * @param displayName - Google Places API 的 primaryTypeDisplayName.text（如 "拉麵店"）
 * @returns App 內部分類標籤（如 "麵類"）
 */
export const resolveCategory = (
    primaryType?: string,
    displayName?: string,
): string => {
    // 1. primaryType → label 直接匹配
    if (primaryType && PLACES_TYPE_TO_LABEL[primaryType]) {
        return PLACES_TYPE_TO_LABEL[primaryType];
    }

    // 2. displayName 是否已經是我們的標籤之一
    if (displayName && CATEGORY_LABELS.includes(displayName)) {
        return displayName;
    }

    // 3. 使用 displayName 原始值（如 "拉麵店"）
    if (displayName) return displayName;

    // 4. 底線轉空格
    if (primaryType) return primaryType.replace(/_/g, ' ');

    return '餐廳';
};
