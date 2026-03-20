// ============================================================================
// 📁 metro.config.js — Metro Bundler 自訂設定
// ============================================================================
//
// 🔧 修復問題：zustand 5.x 的 ESM 版（esm/middleware.mjs）使用了 import.meta.env，
//    Metro 打包後的 bundle 不是 ES Module，導致瀏覽器報：
//      「Uncaught SyntaxError: Cannot use 'import.meta' outside a module」
//    JS bundle 在此行直接中斷，React 無法初始化，所有互動元件失效。
//
// 🛡️ 修法：使用 resolveRequest 攔截器，當解析結果指向 zustand/esm/ 下的
//    .mjs 檔案時，將其重導向到根目錄的 CJS 版本（不含 import.meta）。
// ============================================================================

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// ── 自訂 resolver：攔截 zustand 的 .mjs ESM 模組 ──
const zustandDir = path.resolve(__dirname, 'node_modules', 'zustand');
const zustandEsmDir = path.join(zustandDir, 'esm');

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
    // 使用預設或上層 resolver 取得解析結果
    const resolve = defaultResolveRequest || context.resolveRequest;
    let result;

    try {
        result = resolve(context, moduleName, platform);
    } catch (e) {
        throw e;
    }

    // 如果解析結果指向 zustand/esm/ 下的 .mjs 檔案，重導向到 CJS 版本
    if (
        result &&
        result.type === 'sourceFile' &&
        result.filePath &&
        result.filePath.includes('zustand') &&
        result.filePath.includes(path.sep + 'esm' + path.sep) &&
        result.filePath.endsWith('.mjs')
    ) {
        // zustand/esm/middleware.mjs → zustand/middleware.js
        const basename = path.basename(result.filePath, '.mjs');
        const cjsPath = path.join(zustandDir, basename + '.js');

        // 確認 CJS 版本存在才重導向
        try {
            require.resolve(cjsPath);
            return { type: 'sourceFile', filePath: cjsPath };
        } catch {
            // CJS 版本不存在，回傳原始結果
            return result;
        }
    }

    return result;
};

module.exports = config;
