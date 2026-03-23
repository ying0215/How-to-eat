// ============================================================================
// 📁 favoriteFileHandler.ts — 平台相關的檔案 I/O 層
// ============================================================================
//
// 處理 Web 與 Native (iOS/Android) 的檔案下載/上傳差異：
//
//   匯出：
//     Web    → Blob + URL.createObjectURL + <a>.click()
//     Native → expo-file-system (File.write) + expo-sharing (分享面板)
//
//   匯入：
//     Web    → document.createElement('input') type=file accept=.json
//     Native → expo-document-picker → expo-file-system (File.text())
//
// ============================================================================

import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// 📤 匯出：將 JSON string 存為檔案
// ---------------------------------------------------------------------------

/**
 * 將 JSON 內容下載/分享為檔案。
 *
 * - **Web**：使用 Blob + `<a>` 模擬點擊下載。
 * - **Native**：寫入 Paths.cache 暫存檔，再透過 expo-sharing 開啟分享面板。
 *
 * @param jsonContent JSON 字串
 * @param filename 檔案名稱（含 .json 副檔名）
 * @throws Error 若 Native 端 expo-sharing 不可用
 */
export async function downloadFavoritesFile(
    jsonContent: string,
    filename: string,
): Promise<void> {
    if (Platform.OS === 'web') {
        await downloadWeb(jsonContent, filename);
    } else {
        await downloadNative(jsonContent, filename);
    }
}

/** Web 端下載：Blob + <a> download */
async function downloadWeb(jsonContent: string, filename: string): Promise<void> {
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();

    // 短暫延遲後清理 DOM 和 Object URL
    setTimeout(() => {
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    }, 150);
}

/** Native 端下載：expo-file-system (new API) + expo-sharing */
async function downloadNative(jsonContent: string, filename: string): Promise<void> {
    // 動態 import 避免 Web 端載入 native-only 模組
    const { File, Paths } = await import('expo-file-system');
    const Sharing = await import('expo-sharing');

    // 確認分享功能可用
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
        throw new Error('此裝置不支援檔案分享功能。');
    }

    // 使用新版 expo-file-system API：File + Paths.cache
    const file = new File(Paths.cache, filename);
    file.write(jsonContent);

    // 開啟分享面板（使用者可選擇儲存位置、傳送方式等）
    await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: '匯出餐廳清單',
        UTI: 'public.json', // iOS UTI
    });
}

// ---------------------------------------------------------------------------
// 📥 匯入：讓使用者選取 JSON 檔案並讀取內容
// ---------------------------------------------------------------------------

/** 使用者取消選檔時回傳 null（不視為錯誤） */
export type PickFileResult = string | null;

/**
 * 讓使用者選取一個 .json 檔案，並回傳其文字內容。
 *
 * - **Web**：使用隱藏的 `<input type="file">` 觸發檔案選擇器。
 * - **Native**：使用 expo-document-picker + expo-file-system。
 *
 * @returns JSON 檔案內容字串，或 null（使用者取消選檔）
 * @throws Error 若檔案讀取失敗
 */
export async function pickAndReadFavoritesFile(): Promise<PickFileResult> {
    if (Platform.OS === 'web') {
        return pickAndReadWeb();
    } else {
        return pickAndReadNative();
    }
}

/** Web 端選檔：<input type="file"> */
function pickAndReadWeb(): Promise<PickFileResult> {
    return new Promise<PickFileResult>((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';

        // 偵測使用者取消（focus 回到 window 但 input 沒有值）
        let fileSelected = false;

        input.addEventListener('change', () => {
            fileSelected = true;
            const file = input.files?.[0];
            if (!file) {
                document.body.removeChild(input);
                resolve(null);
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                document.body.removeChild(input);
                resolve(reader.result as string);
            };
            reader.onerror = () => {
                document.body.removeChild(input);
                reject(new Error('無法讀取檔案，請確認檔案未損毀。'));
            };
            reader.readAsText(file, 'utf-8');
        });

        // 偵測取消：focus 回來後 300ms 仍無檔案 → 視為取消
        const handleFocus = () => {
            setTimeout(() => {
                if (!fileSelected) {
                    document.body.removeChild(input);
                    resolve(null);
                }
                window.removeEventListener('focus', handleFocus);
            }, 300);
        };
        window.addEventListener('focus', handleFocus);

        document.body.appendChild(input);
        input.click();
    });
}

/** Native 端選檔：expo-document-picker + expo-file-system */
async function pickAndReadNative(): Promise<PickFileResult> {
    const DocumentPicker = await import('expo-document-picker');
    const { File: FSFile } = await import('expo-file-system');

    const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
    });

    // 使用者取消
    if (result.canceled || !result.assets || result.assets.length === 0) {
        return null;
    }

    const asset = result.assets[0];

    // 使用新版 expo-file-system API 讀取檔案
    const file = new FSFile(asset.uri);
    const content = await file.text();

    return content;
}
