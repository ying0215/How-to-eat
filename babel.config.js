// babel.config.js — Babel 設定
// babel-plugin-transform-import-meta 將 import.meta 轉換為相容語法，
// 修正 zustand 在 Web 上因 <script> 缺少 type="module" 導致的
// "Cannot use 'import.meta' outside a module" 錯誤。
module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: ['babel-plugin-transform-import-meta'],
    };
};
