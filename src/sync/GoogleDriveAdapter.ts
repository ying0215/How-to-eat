// ============================================================================
// 📁 GoogleDriveAdapter.ts — Google Drive REST API v3 封裝
// ============================================================================
//
// 職責：封裝所有 Google Drive 檔案操作，屏蔽底層 REST API 細節。
//
// 設計原則：
//   1. 每個方法都是無狀態的純函式（接收 token，回傳結果）
//   2. 所有操作限制在 appDataFolder scope 內
//   3. 完整的錯誤處理與重試邏輯
//   4. JSON 序列化/反序列化在此層處理
//
// API 參考：
//   https://developers.google.com/drive/api/v3/reference
// ============================================================================

import {
    GOOGLE_DRIVE_API_BASE,
    GOOGLE_DRIVE_UPLOAD_BASE,
    DRIVE_FAVORITES_FILENAME,
    GOOGLE_TOKEN_INFO_URL,
} from '../auth/googleConfig';
import type { SyncableFavoriteState } from './mergeStrategy';

// ---------------------------------------------------------------------------
// 🔍 Token Scope 驗證
// ---------------------------------------------------------------------------

/**
 * Token scope 驗證結果。
 *
 * 用於診斷 403 (Forbidden) 錯誤：
 *   - valid=true: token 擁有 drive.appdata scope
 *   - valid=false: token 缺少必要 scope（需要重新登入取得授權）
 */
export interface TokenScopeValidation {
    /** token 是否包含 drive.appdata scope */
    valid: boolean;
    /** token 實際擁有的所有 scopes */
    scopes: string[];
    /** 驗證失敗時的錯誤訊息 */
    error?: string;
}

/**
 * 驗證 access token 是否擁有 Google Drive appdata 的存取權限。
 *
 * 呼叫 Google TokenInfo API 取得 token 實際持有的 scopes，
 * 檢查是否包含 `https://www.googleapis.com/auth/drive.appdata`。
 *
 * 此函式用於 403 錯誤的診斷流程：
 *   - 若 token 缺少 scope → 使用者需要登出重新登入
 *   - 若 token 有 scope 但仍 403 → Google Cloud Console 設定問題
 *
 * @param token 要驗證的 access token
 * @returns Token scope 驗證結果
 *
 * @example
 * ```ts
 * const validation = await validateTokenScopes(accessToken);
 * if (!validation.valid) {
 *     console.error('Token 缺少 drive.appdata scope:', validation.scopes);
 *     // 提示使用者重新登入
 * }
 * ```
 */
export async function validateTokenScopes(
    token: string,
): Promise<TokenScopeValidation> {
    const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

    try {
        const url = `${GOOGLE_TOKEN_INFO_URL}?access_token=${encodeURIComponent(token)}`;
        const response = await fetch(url);

        if (!response.ok) {
            const errText = await response.text();
            console.warn(
                `[TokenScope] TokenInfo API 回傳 ${response.status}: ${errText}`,
            );
            return {
                valid: false,
                scopes: [],
                error: `TokenInfo API 錯誤 (${response.status}): token 可能已過期或無效`,
            };
        }

        const data = await response.json();
        const scopeString = (data.scope as string) ?? '';
        const scopes = scopeString.split(' ').filter(Boolean);
        const hasDriveAppdata = scopes.includes(REQUIRED_SCOPE);

        if (!hasDriveAppdata) {
            console.warn(
                '[TokenScope] ⚠️ Token 缺少 drive.appdata scope！',
                '\n  現有 scopes:', scopes.join(', '),
                '\n  需要 scope:', REQUIRED_SCOPE,
                '\n  解決方式: 請登出後重新登入，以取得包含 drive.appdata 權限的新 token。',
            );
        } else {
            console.info(
                '[TokenScope] ✅ Token scope 驗證通過，包含 drive.appdata',
            );
        }

        return { valid: hasDriveAppdata, scopes };
    } catch (err) {
        const message = err instanceof Error
            ? err.message
            : 'TokenInfo API 呼叫時發生未知錯誤';
        console.warn('[TokenScope] 無法驗證 token scope:', message);
        return {
            valid: false,
            scopes: [],
            error: `無法驗證 token scope: ${message}`,
        };
    }
}

// ---------------------------------------------------------------------------
// 🔧 HTTP 工具
// ---------------------------------------------------------------------------

import { fetchWithResilience } from '../utils/fetchWithResilience';

/**
 * 針對 Google Drive 設計的 api request 封裝。
 * 
 * 底層直接依賴全域的 fetchWithResilience() 以獲得逾時、限流與指數退避功能。
 * 負責將網路或 HTTP 錯誤轉換成上層依賴的 DriveApiError。
 *
 * @param url 請求 URL
 * @param options fetch 選項
 * @param maxRetries 最大重試次數（預設 3）
 * @returns Response 物件
 * @throws 拋出 DriveApiError
 */
async function driveFetch(
    url: string,
    options: RequestInit,
    maxRetries: number = 3,
): Promise<Response> {
    try {
        const response = await fetchWithResilience(url, options, {
            endpointId: 'google_drive_api',
            maxRetries,
            baseDelayMs: 500,
        });

        // fetchWithResilience 遇到 429 或 5xx 會自動拋錯重試，
        // 若回傳到這裡且 !response.ok，代表是未重試的客戶端錯誤 (4xx 但非 429)
        if (!response.ok) {
            const errBody = await response.text();
            throw new DriveApiError(
                `Drive API ${response.status}: ${errBody}`,
                response.status,
                false, // 不可重試
            );
        }

        return response;
    } catch (err) {
        if (err instanceof DriveApiError) throw err;

        // 如果是 fetchWithResilience 放棄重試而拋出的錯，將其包裝為 DriveApiError
        const statusCode = (err as any).status ?? 0;
        throw new DriveApiError(
            `Drive API request failed: ${err instanceof Error ? err.message : String(err)}`,
            statusCode,
            true, // 其他網路層次錯誤可視為暫時性可重試
        );
    }
}

// ---------------------------------------------------------------------------
// ❌ 自訂錯誤類別
// ---------------------------------------------------------------------------

/**
 * Google Drive API 操作專用錯誤類別。
 *
 * 攜帶 HTTP status code 和是否可重試的資訊，
 * 讓上層（SyncOrchestrator）能根據錯誤類型做不同決策。
 */
export class DriveApiError extends Error {
    constructor(
        message: string,
        /** HTTP 狀態碼（0 表示網路層錯誤） */
        public readonly statusCode: number,
        /** 此錯誤是否屬於暫時性、可重試的 */
        public readonly retryable: boolean,
        /** 是否需要重新授權（403 時為 true，表示 token 可能過期或權限不足） */
        public readonly requiresReauth: boolean = statusCode === 403,
    ) {
        super(message);
        this.name = 'DriveApiError';
    }
}

// ---------------------------------------------------------------------------
// 📂 Drive File 操作
// ---------------------------------------------------------------------------

/** Google Drive 檔案搜尋回應中的單一檔案物件 */
interface DriveFile {
    id: string;
    name: string;
    modifiedTime: string;
}

/**
 * 在 appDataFolder 中搜尋指定名稱的檔案。
 *
 * appDataFolder 是每個 App 在使用者 Drive 中的隱藏空間，
 * 不同 App 之間互相看不到彼此的 appDataFolder 內容。
 *
 * @param token 有效的 Google OAuth access token
 * @returns 找到的檔案 metadata，或 null（不存在時）
 */
export async function findFavoritesFile(
    token: string,
): Promise<DriveFile | null> {
    const query = encodeURIComponent(`name = '${DRIVE_FAVORITES_FILENAME}'`);
    const url =
        `${GOOGLE_DRIVE_API_BASE}/files?` +
        `spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)&pageSize=1`;

    const response = await driveFetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();
    const files = (data.files ?? []) as DriveFile[];
    return files.length > 0 ? files[0] : null;
}

/**
 * 從 Google Drive 下載最愛餐廳資料。
 *
 * 流程：
 *   1. 先用 findFavoritesFile() 找到檔案 ID
 *   2. 用 ?alt=media 下載檔案實際內容
 *   3. Parse JSON 為 SyncableFavoriteState
 *
 * @param token 有效的 Google OAuth access token
 * @returns 解析後的 SyncableFavoriteState，或 null（檔案不存在時）
 */
export async function downloadFavorites(
    token: string,
): Promise<SyncableFavoriteState | null> {
    const file = await findFavoritesFile(token);
    if (!file) return null;

    const url = `${GOOGLE_DRIVE_API_BASE}/files/${file.id}?alt=media`;
    const response = await driveFetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
    });

    const text = await response.text();
    if (!text || text.trim().length === 0) return null;

    try {
        const parsed = JSON.parse(text) as SyncableFavoriteState;

        // 基礎資料完整性校驗（相容舊版 queue 和新版 groups 兩種格式）
        if (!Array.isArray(parsed.favorites)) {
            console.warn('[GoogleDrive] Downloaded data has invalid structure (missing favorites array), ignoring.');
            return null;
        }
        // 新版格式需要有 groups；舊版需要有 queue
        const hasNewFormat = Array.isArray(parsed.groups);
        const hasLegacyFormat = Array.isArray(parsed.queue);
        if (!hasNewFormat && !hasLegacyFormat) {
            console.warn('[GoogleDrive] Downloaded data has invalid structure (missing both groups and queue), ignoring.');
            return null;
        }

        return parsed;
    } catch (parseErr) {
        console.warn('[GoogleDrive] Failed to parse downloaded JSON:', parseErr);
        return null;
    }
}

/**
 * 將最愛餐廳資料上傳到 Google Drive appDataFolder。
 *
 * 使用 multipart upload：
 *   Part 1: metadata JSON（檔名、parent）
 *   Part 2: 實際檔案內容 JSON
 *
 * 如果檔案已存在，使用 PATCH 更新；否則用 POST 建立新檔案。
 *
 * @param token 有效的 Google OAuth access token
 * @param state 要上傳的最愛餐廳資料
 * @returns 上傳成功後的檔案 ID
 */
export async function uploadFavorites(
    token: string,
    state: SyncableFavoriteState,
): Promise<string> {
    const existingFile = await findFavoritesFile(token);
    const jsonContent = JSON.stringify(state, null, 2);

    if (existingFile) {
        // ── 更新既有檔案 ──
        // 使用 simple upload (uploadType=media) 直接覆蓋檔案內容
        const url = `${GOOGLE_DRIVE_UPLOAD_BASE}/files/${existingFile.id}?uploadType=media`;
        const response = await driveFetch(url, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: jsonContent,
        });

        const result = await response.json();
        return result.id as string;
    } else {
        // ── 建立新檔案 ──
        // 使用 multipart upload 同時傳送 metadata 和 content
        const boundary = '---how_to_eat_boundary_' + Date.now();
        const metadata = JSON.stringify({
            name: DRIVE_FAVORITES_FILENAME,
            parents: ['appDataFolder'],
            mimeType: 'application/json',
        });

        // 手動組裝 multipart body（React Native 的 FormData 與 Google API 不完全相容）
        const multipartBody =
            `--${boundary}\r\n` +
            `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
            `${metadata}\r\n` +
            `--${boundary}\r\n` +
            `Content-Type: application/json\r\n\r\n` +
            `${jsonContent}\r\n` +
            `--${boundary}--`;

        const url = `${GOOGLE_DRIVE_UPLOAD_BASE}/files?uploadType=multipart`;
        const response = await driveFetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartBody,
        });

        const result = await response.json();
        return result.id as string;
    }
}

/**
 * 刪除 Google Drive appDataFolder 中的最愛餐廳檔案。
 *
 * 用於使用者選擇「取消連結」時清除雲端資料。
 *
 * @param token 有效的 Google OAuth access token
 * @returns true 表示刪除成功（或檔案本來就不存在）
 */
export async function deleteFavoritesFile(token: string): Promise<boolean> {
    const file = await findFavoritesFile(token);
    if (!file) return true; // 檔案不存在，視為成功

    const url = `${GOOGLE_DRIVE_API_BASE}/files/${file.id}`;
    await driveFetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });

    return true;
}

/**
 * 檢查 Google Drive API 連通性。
 *
 * 用一個輕量級的 about API call 確認 token 有效且 Drive API 可達。
 *
 * @param token 有效的 Google OAuth access token
 * @returns true 表示連通成功
 */
export async function checkDriveConnectivity(token: string): Promise<boolean> {
    try {
        const url = `${GOOGLE_DRIVE_API_BASE}/about?fields=user(emailAddress)`;
        const response = await driveFetch(
            url,
            {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
            },
            1, // 只重試 1 次
        );
        return response.ok;
    } catch {
        return false;
    }
}
