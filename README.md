# 🍽️ 今天吃什麼 — How-to-eat Mobile App

> 一款協助使用者決定「今天吃什麼」的行動應用程式，每日從最愛清單輪替推薦餐廳，並支援 GPS 附近餐廳搜尋。

## 技術棧

- **框架**：React Native + Expo SDK 54
- **路由**：Expo Router（File-based routing）
- **語言**：TypeScript
- **狀態管理**：Zustand + persist middleware
- **附近搜尋**：Google Places API (New) — Nearby Search
- **雲端同步**：Google Drive REST API v3（appDataFolder）
- **認證**：Google OAuth 2.0（expo-auth-session + PKCE）

## 快速開始

### 環境需求

- Node.js 18+
- npm 9+
- Expo CLI（`npx expo`）

### 安裝與啟動

```bash
# 1. 安裝依賴
npm install

# 2. 建立環境變數檔（選填）
cp .env.example .env
# 編輯 .env 填入 Google API Key 與 Client ID

# 3. 啟動開發伺服器
npx expo start
```

### 環境變數

| 變數名稱 | 說明 | 必要 |
|----------|------|:---:|
| `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` | Google Places API Key（附近餐廳搜尋） | 否（未設定則降級 Mock 資料） |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | 否（未設定則停用雲端同步） |
| `EXPO_PUBLIC_GOOGLE_MAPS_SCHEME` | Google Maps URL Scheme | 否 |

> 即使不設定任何環境變數，App 也可正常運行（Mock 模式 + 本地存儲）。

## 主要功能

| 頁面 | 功能 |
|------|------|
| 🏠 **首頁** | App 入口，提供「隨機抽取」與「找最近的」兩個功能入口 |
| 🎲 **最愛抽獎** | 從最愛清單中每日輪替推薦餐廳，支援新增、跳過、刪除 |
| 📍 **附近美食** | 依 GPS + 分類篩選列出附近餐廳，支援導航與加入最愛 |
| ❤️ **最愛清單** | 管理已收藏的餐廳，可拖曳排序、刪除 |
| ⚙️ **偏好設定** | 交通方式、最高交通時間、Google 雲端同步管理 |

## 架構文件

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 系統架構、模組職責與核心資料流
- [PAGE_SPEC.md](./PAGE_SPEC.md) — 前端頁面 UI 詳細規格（按鈕、組件、導航）

## 測試

```bash
npx jest --passWithNoTests
```
