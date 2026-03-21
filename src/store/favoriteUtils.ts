import { FavoriteGroup } from './favoriteTypes';

/** 取得今天的本地日期字串 */
export const getTodayString = (): string => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

/**
 * 產生碰撞安全的唯一 ID。
 *
 * 組合 timestamp（36 進位）+ 遞增計數器 + 密碼學隨機雜湊，
 * 在快速連續呼叫（批次匯入）或多裝置同步場景中仍能保證唯一性。
 */
let _idCounter = 0;
export const generateId = (): string => {
    const timestamp = Date.now().toString(36);
    const counter = (_idCounter++).toString(36);
    // 優先使用 crypto API（Web + 新版 RN），fallback Math.random
    let random: string;
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        const bytes = new Uint8Array(8);
        globalThis.crypto.getRandomValues(bytes);
        random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } else {
        random = Math.random().toString(36).substring(2, 10)
            + Math.random().toString(36).substring(2, 10);
    }
    return `${timestamp}-${counter}-${random}`;
};

/**
 * 孤兒 ID 清理：若 currentDailyId 不在 queue 中（資料不一致），
 * 自動重置為 queue[0] 或 null，避免幽靈 ID 永久殘留。
 */
export const sanitizeCurrentId = (currentId: string | null, queue: string[]): string | null => {
    if (currentId === null) return null;
    return queue.includes(currentId) ? currentId : (queue[0] ?? null);
};

/** 建立預設群組 */
export const createDefaultGroup = (): FavoriteGroup => {
    const now = new Date().toISOString();
    return {
        id: generateId(),
        name: '群組A',
        createdAt: now,
        updatedAt: now,
    };
};
