// 將分鐘轉換為易讀的時間格式 (例如: 65 -> 1小時 5分鐘)
export const formatTimeMins = (mins: number): string => {
    if (mins < 60) return `${mins} 分鐘`;
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hrs} 小時 ${remainingMins} 分鐘` : `${hrs} 小時`;
};

// 距離格式化 (例如: 1200 -> 1.2 km)
export const formatDistance = (meters: number): string => {
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
};
