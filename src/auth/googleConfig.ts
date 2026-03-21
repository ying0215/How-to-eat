// ============================================================================
// 📁 googleConfig.ts — Google OAuth 2.0 靜態設定
// ============================================================================
//
// 📖 此檔集中管理所有 Google 登入所需的常數，包含：
//    - OAuth Client ID（需在 Google Cloud Console 建立）
//    - API Scope（最小權限：僅存取 appDataFolder）
//    - Discovery Document URL（Google 的 OAuth endpoints）
//
// ⚠️ 首次使用前，你必須：
//    1. 前往 https://console.cloud.google.com/
//    2. 建立專案，啟用 Google Drive API
//    3. 建立 OAuth 2.0 Client ID（Authorized redirect URI 填入 Expo AuthSession proxy）
//    4. 將 Client ID 填入 .env 的 EXPO_PUBLIC_GOOGLE_CLIENT_ID
// ============================================================================

/**
 * 從環境變數讀取 Google OAuth Client ID。
 *
 * Expo 慣例：以 EXPO_PUBLIC_ 前綴的環境變數會被自動注入到 client bundle 中。
 * 在 .env 中設置：EXPO_PUBLIC_GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
 *
 * 若未設定，googleClientId 為空字串，useGoogleAuth 會在初始化時偵測並跳過登入流程。
 */
export const googleClientId: string =
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

/**
 * Google OAuth Client Secret（Web Application 類型必須）。
 *
 * ⚠️ 注意：Web Application 類型的 OAuth Client 在 token exchange 時需要 client_secret。
 * 在 .env 中設置：EXPO_PUBLIC_GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
 *
 * 在正式生產環境中，client_secret 應由後端 proxy 持有，不暴露在前端。
 * 目前開發階段直接使用，因權限範圍僅限 drive.appdata，風險可控。
 */
export const googleClientSecret: string =
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET ?? '';

/**
 * Google OAuth 2.0 所需的授權範圍（Scopes）。
 *
 * - `openid`：OpenID Connect 基礎範圍，啟用 ID token
 * - `email`：取得使用者的 email 地址
 * - `profile`：取得使用者的名稱、頭像等基本資料
 * - `drive.appdata`：Google Drive 應用程式資料夾範圍
 *   - 只能存取此 App 自己建立的隱藏資料夾 (appDataFolder)
 *   - 不會看到使用者的任何其他 Drive 檔案
 *   - 不佔用使用者的儲存配額
 *   - 使用者刪除此 App 的授權後，該資料夾會被自動清除
 *
 * 這是**最小權限原則**的實踐——我們只請求絕對必要的存取範圍。
 */
export const GOOGLE_DRIVE_SCOPES: readonly string[] = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.appdata',
] as const;

/**
 * Google OAuth 2.0 Discovery Document URL。
 *
 * Discovery Document 是一份 JSON，包含 Google OAuth 的所有 endpoint：
 *   - authorization_endpoint（使用者授權頁面）
 *   - token_endpoint（換取 access token）
 *   - revocation_endpoint（撤銷授權）
 *
 * expo-auth-session 的 useAuthRequest() 會自動讀取此文件，
 * 開發者不需要手動硬編碼各個 endpoint URL。
 */
export const GOOGLE_DISCOVERY_DOC_URL =
    'https://accounts.google.com';

/**
 * Google Drive REST API v3 基礎 URL。
 *
 * 所有 Drive 操作（列出檔案、上傳、下載）都以此為前綴。
 */
export const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

/**
 * Google Drive REST API v3 上傳 URL。
 *
 * 用於建立/更新檔案內容（multipart upload 或 media upload）。
 * 與一般 API base 不同，上傳走 /upload 前綴路徑。
 */
export const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

/**
 * 存放在 Google Drive appDataFolder 中的檔案名稱。
 *
 * 命名規則：使用 app 名稱 + 功能名稱，避免與其他 app 衝突。
 */
export const DRIVE_FAVORITES_FILENAME = 'how-to-eat-favorites.json';

/**
 * Google OAuth TokenInfo API URL。
 *
 * 用於驗證 access token 實際持有的 scopes，
 * 以診斷 403 (Forbidden) 錯誤是否因為 token 缺少必要的 drive.appdata scope。
 *
 * 回傳範例：
 * ```json
 * {
 *   "azp": "xxxx.apps.googleusercontent.com",
 *   "scope": "openid https://www.googleapis.com/auth/drive.appdata ...",
 *   "expires_in": "3598",
 *   ...
 * }
 * ```
 */
export const GOOGLE_TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/**
 * 快速檢查 Google 登入所需的 Client ID 是否已正確設定。
 *
 * @returns true 表示 Client ID 已設定，可以執行 Google 登入流程
 */
export function isGoogleConfigured(): boolean {
    return (
        googleClientId.length > 0 &&
        !googleClientId.includes('your-client-id') &&
        googleClientId.endsWith('.apps.googleusercontent.com')
    );
}
