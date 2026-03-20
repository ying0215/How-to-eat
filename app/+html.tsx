// ============================================================================
// 📄 +html.tsx — Web 平台的 HTML 模板
// ============================================================================
//
// Expo Router 在 Web（output: "static"）模式下需要此檔案定義 HTML 外殼。
// 如果不提供，Expo Router 會用預設模板，但可能缺少 type="module" 等關鍵設定。
//
// ⚠️ 注意：不要在這裡注入會影響 React 元件行為的 CSS，
//    那會導致 SSR 與客戶端渲染不一致，引發 hydration 錯誤。

import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
    return (
        <html lang="zh-TW">
            <head>
                <meta charSet="utf-8" />
                <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, shrink-to-fit=no"
                />

                {/* Expo Router 的 ScrollView 樣式重置 */}
                <ScrollViewStyleReset />
            </head>
            <body>{children}</body>
        </html>
    );
}
