/**
 * useNetworkStatus 單元測試
 *
 * 驗證 Network Store 的非 Hook 函式行為。
 * React Hook 部分（useEffect / event listener）需要 @testing-library/react-hooks，
 * 此處只測試 store + utility 函式。
 */

// Mock react-native to avoid ESM import errors in Jest
jest.mock('react-native', () => ({
    Platform: { OS: 'web' },
    AppState: {
        addEventListener: jest.fn(() => ({ remove: jest.fn() })),
        currentState: 'active',
    },
}));

// Mock fetch globally
const mockFetch = jest.fn();
(globalThis as unknown as Record<string, unknown>).fetch = mockFetch;

import {
    useNetworkStore,
    getNetworkStatus,
    checkNetworkConnectivity,
} from '../hooks/useNetworkStatus';

beforeEach(() => {
    mockFetch.mockReset();
    // 重置 store 狀態
    useNetworkStore.setState({
        isConnected: true,
        lastCheckedAt: null,
        isChecking: false,
    });
});

describe('useNetworkStore — 初始狀態', () => {
    it('預設為連線狀態（樂觀預設）', () => {
        const state = useNetworkStore.getState();
        expect(state.isConnected).toBe(true);
        expect(state.lastCheckedAt).toBeNull();
        expect(state.isChecking).toBe(false);
    });
});

describe('useNetworkStore — _setConnected', () => {
    it('設定 connected 為 true 時更新 lastCheckedAt', () => {
        useNetworkStore.getState()._setConnected(true);

        const state = useNetworkStore.getState();
        expect(state.isConnected).toBe(true);
        expect(state.lastCheckedAt).toBeDefined();
        expect(state.isChecking).toBe(false);
    });

    it('設定 connected 為 false', () => {
        useNetworkStore.getState()._setConnected(false);

        const state = useNetworkStore.getState();
        expect(state.isConnected).toBe(false);
        expect(state.lastCheckedAt).toBeDefined();
    });
});

describe('useNetworkStore — _setChecking', () => {
    it('設定 isChecking 為 true', () => {
        useNetworkStore.getState()._setChecking(true);
        expect(useNetworkStore.getState().isChecking).toBe(true);
    });
});

describe('getNetworkStatus', () => {
    it('回傳 store 中的 isConnected 值', () => {
        useNetworkStore.setState({ isConnected: false });
        expect(getNetworkStatus()).toBe(false);

        useNetworkStore.setState({ isConnected: true });
        expect(getNetworkStatus()).toBe(true);
    });
});

describe('checkNetworkConnectivity', () => {
    it('fetch 成功時回傳 true', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            type: 'opaque',
        } as Response);

        const result = await checkNetworkConnectivity();
        expect(result).toBe(true);
        expect(useNetworkStore.getState().isConnected).toBe(true);
    });

    it('fetch 失敗時回傳 false', async () => {
        // 重置 isChecking 以允許偵測
        useNetworkStore.setState({ isChecking: false });
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await checkNetworkConnectivity();
        expect(result).toBe(false);
        expect(useNetworkStore.getState().isConnected).toBe(false);
    });

    it('fetch 超時時回傳 false', async () => {
        useNetworkStore.setState({ isChecking: false });
        // 模擬 AbortError
        const abortError = new DOMException('The operation was aborted', 'AbortError');
        mockFetch.mockRejectedValueOnce(abortError);

        const result = await checkNetworkConnectivity();
        expect(result).toBe(false);
    });

    it('正在偵測中時不重複發送請求', async () => {
        useNetworkStore.setState({ isChecking: true, isConnected: true });

        const result = await checkNetworkConnectivity();

        // 應該直接回傳現有狀態，不呼叫 fetch
        expect(result).toBe(true);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
