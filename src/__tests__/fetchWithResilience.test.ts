import { fetchWithResilience, setRateLimitingEnabled } from '../utils/fetchWithResilience';
import { useDiagnosticStore } from '../store/useDiagnosticStore';

(global as any).__DEV__ = true;

describe('fetchWithResilience', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        // Mock fetch before each test
        global.fetch = jest.fn();
        useDiagnosticStore.getState().clearLogs();
        // Since we use global variables in fetchWithResilience for rate limiting,
        // we might hit rate limits between tests if we use the same endpointId.
        // We'll use random endpoint IDs for each test to clear state.
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it('should fetch successfully on the first try', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(new Response('OK', { status: 200 }));

        const response = await fetchWithResilience('https://example.com', undefined, {
            endpointId: 'test.success',
        });

        expect(response.status).toBe(200);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw an error and rate limit when called too frequently', async () => {
        setRateLimitingEnabled(true);

        (global.fetch as jest.Mock).mockResolvedValue(new Response('OK', { status: 200 }));
        const endpoint = 'test.ratelimit';

        // Call once
        await fetchWithResilience('https://example.com', undefined, { endpointId: endpoint, rateLimitMs: 1000 });

        // Call twice immediately
        await expect(
            fetchWithResilience('https://example.com', undefined, { endpointId: endpoint, rateLimitMs: 1000 })
        ).rejects.toThrow('請求過於頻繁');

        const logs = useDiagnosticStore.getState().logs;
        expect(logs.some(l => l.message === 'API Rate Limited Triggered')).toBe(true);

        setRateLimitingEnabled(false);
    });

    it('should retry on 500 error gracefully', async () => {
        // First, it returns 500. Second, it returns 200.
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(new Response('Error', { status: 500 }))
            .mockResolvedValueOnce(new Response('OK', { status: 200 }));

        const endpoint = 'test.retry.' + Date.now();

        const response = await fetchWithResilience('https://example.com', undefined, {
            endpointId: endpoint,
            maxRetries: 3,
            baseDelayMs: 10, // speed up tests
            rateLimitMs: 0,
        });

        expect(response.status).toBe(200);
        expect(global.fetch).toHaveBeenCalledTimes(2);

        const logs = useDiagnosticStore.getState().logs;
        expect(logs.some(l => l.message.includes('Retrying'))).toBe(true);
    });

    it('should throw permanently after hitting maxRetries', async () => {
        // Always fail
        (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));
        const endpoint = 'test.maxretries.' + Date.now();

        await expect(
            fetchWithResilience('https://example.com', undefined, {
                endpointId: endpoint,
                maxRetries: 2,
                baseDelayMs: 10,
                rateLimitMs: 0,
            })
        ).rejects.toThrow('Network error');

        expect(global.fetch).toHaveBeenCalledTimes(3);  // Initial try + 2 retries (since maxRetries=2)

        const logs = useDiagnosticStore.getState().logs;
        expect(logs.some(l => l.message.includes('permanently'))).toBe(true);
    });

    it('should retry on 429 gracefully with Retry-After priority over backoff', async () => {
        const mockHeaders = new Headers();
        mockHeaders.append('Retry-After', '0'); // 0秒退避以加速測試

        // 第一次 429, 第二次 200
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(new Response('Rate Limited', { status: 429, headers: mockHeaders }))
            .mockResolvedValueOnce(new Response('OK', { status: 200 }));

        const endpoint = 'test.retry.429.' + Date.now();

        const response = await fetchWithResilience('https://example.com', undefined, {
            endpointId: endpoint,
            maxRetries: 3,
            baseDelayMs: 10,
            rateLimitMs: 0,
        });

        expect(response.status).toBe(200);
        expect(global.fetch).toHaveBeenCalledTimes(2);

        const logs = useDiagnosticStore.getState().logs;
        const retryLog = logs.find(l => l.message.includes('Retrying'));
        expect(retryLog).toBeDefined();
    });
});
