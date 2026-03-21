// ============================================================================
// 🩺 useDiagnosticStore — 應用程式診斷日誌中心 (Ring Buffer)
// ============================================================================
//
// 💡 架構決策：
//   為了解決正式環境無後端日誌伺服器的問題，實作輕量級的 in-memory Ring Buffer。
//   - 僅保留最新 100 筆紀錄，避免記憶體外洩。
//   - 提供匯出功能，方便使用者回報 Bug 時附上狀態。
// ============================================================================

import { create } from 'zustand';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
    id: string;
    timestamp: number;
    level: LogLevel;
    message: string;
    metadata?: Record<string, unknown>;
}

interface DiagnosticState {
    logs: LogEntry[];
    maxLogs: number;
    addLog: (level: LogLevel, message: string, metadata?: Record<string, unknown>) => void;
    clearLogs: () => void;
    getExportLogs: () => string;
}

const generateId = () => Math.random().toString(36).slice(2, 9);

export const useDiagnosticStore = create<DiagnosticState>((set, get) => ({
    logs: [],
    maxLogs: 100, // Ring buffer 大小限制

    addLog: (level, message, metadata) => {
        const newLog: LogEntry = {
            id: generateId(),
            timestamp: Date.now(),
            level,
            message,
            metadata,
        };

        set((state) => {
            const nextLogs = [newLog, ...state.logs];
            // 裁切超出長度的日誌
            if (nextLogs.length > state.maxLogs) {
                nextLogs.length = state.maxLogs;
            }
            return { logs: nextLogs };
        });

        // 開發環境同步印出至 console
        if (__DEV__) {
            const logStr = `[Diagnostic][${level.toUpperCase()}] ${message}`;
            if (level === 'error') console.error(logStr, metadata ?? '');
            else if (level === 'warn') console.warn(logStr, metadata ?? '');
            else console.log(logStr, metadata ?? '');
        }
    },

    clearLogs: () => {
        set({ logs: [] });
    },

    getExportLogs: () => {
        const { logs } = get();
        return logs
            .map(
                (l) =>
                    `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}] ${l.message} ${
                        l.metadata ? JSON.stringify(l.metadata) : ''
                    }`
            )
            .join('\n');
    },
}));
