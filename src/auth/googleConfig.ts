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
//    3. 建立 OAuth 2.0 Client ID：
//       - Web Application 類型（用於 Web 平台）
//       - Android 類型（用於 APK，需填入 package name + SHA-1 指紋）
//    4. 將 Client ID 分別填入 .env：
//       - EXPO_PUBLIC_GOOGLE_CLIENT_ID（Web）
//       - EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID（Android）
// ============================================================================

// ---------------------------------------------------------------------------
// 🔧 Safe Platform Detection
// ---------------------------------------------------------------------------
// googleConfig.ts 會被 useGoogleAuth.ts / GoogleDriveAdapter.ts 引用，
// 而測試環境使用 ts-jest（Node），無法直接 import react-native。
// 因此使用安全的 runtime 偵測：先嘗試取得 Platform.OS，失敗則 fallback 為 'web'。
// ---------------------------------------------------------------------------

function detectPlatformOS(): string {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Platform } = require('react-native');
        return Platform.OS ?? 'web';
    } catch {
        // Node.js / Jest 環境下 react-native 不可用，fallback 為 'web'
        return 'web';
    }
}

/** 當前平台識別碼（'web' | 'android' | 'ios'） */
const CURRENT_PLATFORM = detectPlatformOS();

// ---------------------------------------------------------------------------
// 📱 Expo Go 偵測
// ---------------------------------------------------------------------------
// Expo Go 是 Expo 提供的通用開發 App，使用時 package name 是 host.exp.exponent。
// 這會導致：
//   1. API Key 的 Android 限制不認得此 package name → Places API 403
//   2. 自訂 scheme (mobile://) 無法被 Expo Go 攔截 → OAuth redirect 失敗
// 
// 解法：在 Expo Go 中，OAuth 改走 Expo Auth Proxy（HTTPS redirect URI），
// 因此必須使用 Web Application 類型的 OAuth Client（需要 client_id + client_secret）。
// ---------------------------------------------------------------------------

/**
 * 偵測當前是否在 Expo Go 中運行。
 * 
 * Constants.appOwnership 的值：
 *   - 'expo' = Expo Go（通用開發 App）
 *   - 'standalone' = 獨立 APK/IPA（EAS Build 產出）
 *   - 'guest' = Expo Go 中的 Guest 模式
 *   - undefined = Web 或無法判斷
 */
function detectIsExpoGo(): boolean {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Constants = require('expo-constants').default;
        return Constants.appOwnership === 'expo';
    } catch {
        return false;
    }
}

/** 是否在 Expo Go 環境中運行 */
export const isExpoGo: boolean = detectIsExpoGo();

// ⚠️ Expo Auth Proxy (auth.expo.io) 已在 SDK 48+ 棄用並關閉。
// Expo Go 中無法使用 Google OAuth，因為：
//   1. Expo Go 無法攔截自訂 scheme (mobile://) 的 redirect
//   2. Google OAuth 不接受 exp:// 格式的 redirect URI
//   3. auth.expo.io proxy 已不再運作
// 官方建議：使用 Development Build (eas build --profile development) 來測試 OAuth。

// ---------------------------------------------------------------------------
// 🔑 Platform-specific OAuth Client ID
// ---------------------------------------------------------------------------
// Web Application 類型 → EXPO_PUBLIC_GOOGLE_CLIENT_ID
//   - 需要 client_secret 進行 token exchange
//   - 透過 HTTP Referrer 限制來源
//
// Android 類型 → EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
//   - 不需要 client_secret（靠 package name + SHA-1 簽名指紋驗證身份）
//   - 在 Google Cloud Console 建立時填入 package name 與 SHA-1
//
// ⚠️ 2023/10 政策變更：Google 禁止 Android OAuth Client 使用自訂 URI scheme
//    (如 mobile://) 作為 redirect_uri（Secure Response Handling 政策）。
//    因此 Android 平台改用 Web Application Client ID + client_secret，
//    搭配 PKCE 保護授權碼交換，安全性等同。
//    需在 Google Cloud Console → Web Client → Authorized redirect URIs 加入 mobile://
// ---------------------------------------------------------------------------

/** Web 平台用的 OAuth Client ID（Web Application 類型） */
const WEB_CLIENT_ID: string =
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

/** Android 平台用的 OAuth Client ID（Android 類型） */
const ANDROID_CLIENT_ID: string =
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '';

/** iOS 平台用的 OAuth Client ID（iOS 類型） */
const IOS_CLIENT_ID: string =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

/**
 * 根據當前平台自動選擇對應的 Google OAuth Client ID。
 *
 * - Web → Web Application Client ID
 * - Android → Web Application Client ID（Google 禁止 Android Client 使用 custom scheme redirect）
 * - iOS → 目前 fallback 到 Web Client ID（未來可擴充）
 *
 * ⚠️ Android 為何不用 Android Client ID？
 *    Google 自 2023/10 起禁止 Android OAuth Client 使用自訂 URI scheme（如 mobile://）
 *    作為 redirect_uri，違反 Secure Response Handling 政策。
 *    改用 Web Client ID + client_secret + PKCE，redirect_uri 仍可為 mobile://。
 *
 * Expo 慣例：以 EXPO_PUBLIC_ 前綴的環境變數會被自動注入到 client bundle 中。
 * 若未設定，googleClientId 為空字串，useGoogleAuth 會在初始化時偵測並跳過登入流程。
 */
function selectClientId(): string {
    switch (CURRENT_PLATFORM) {
        case 'android':
            // ⚠️ 使用 Web Client ID（非 Android Client ID），繞過 custom scheme 禁令
            return WEB_CLIENT_ID;
        case 'ios':
            return IOS_CLIENT_ID || WEB_CLIENT_ID;      // fallback to Web if iOS not set
        case 'web':
        default:
            return WEB_CLIENT_ID;
    }
}
export const googleClientId: string = selectClientId();

/**
 * Google OAuth Client Secret（Web Application 類型需要）。
 *
 * ⚠️ Android 現在也使用 Web Client ID（因 custom scheme 禁令），
 *    因此 Android 也需要提供 client_secret。
 *
 * ⚠️ iOS 若使用原生 iOS OAuth Client，則不需要 client_secret。
 *
 * ⚠️ 在正式生產環境中，client_secret 應由後端 proxy 持有，不暴露在前端。
 * 目前開發階段直接使用，因權限範圍僅限 drive.appdata，風險可控。
 */
function selectClientSecret(): string {
    switch (CURRENT_PLATFORM) {
        case 'android':
            // Android 使用 Web Client ID，需要 client_secret 進行 token exchange
            return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET ?? '';
        case 'ios':
            return '';  // iOS 原生 OAuth Client 不需要 client_secret
        case 'web':
        default:
            return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET ?? '';
    }
}
export const googleClientSecret: string = selectClientSecret();

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
