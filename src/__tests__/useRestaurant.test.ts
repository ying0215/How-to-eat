import React from 'react';
// @ts-ignore
import { create, act } from 'react-test-renderer';
import { useRestaurant } from '../hooks/useRestaurant';
import { restaurantService } from '../services/restaurant';

// Mock the restaurantService
jest.mock('../services/restaurant', () => ({
    restaurantService: {
        getNearest: jest.fn(),
        getRandom: jest.fn(),
        clearCache: jest.fn(),
    },
}));

// Create a custom renderHook using react-test-renderer
function renderHook(hook: () => any) {
    const result: { current: any } = { current: null };
    function TestComponent() {
        result.current = hook();
        return null;
    }
    let TestRenderer: any;
    act(() => {
        TestRenderer = create(React.createElement(TestComponent));
    });
    return {
        result,
        rerender: () => {
            act(() => {
                TestRenderer.update(React.createElement(TestComponent));
            });
        }
    };
}

const mockGetNearest = restaurantService.getNearest as jest.Mock;
const mockGetRandom = restaurantService.getRandom as jest.Mock;
const mockClearCache = restaurantService.clearCache as jest.Mock;

describe('useRestaurant Hook Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Initial State', () => {
        it('should have correct initial state', () => {
            const { result } = renderHook(() => useRestaurant());
            expect(result.current.loading).toBe(false);
            expect(result.current.error).toBeNull();
            expect(result.current.restaurants).toEqual([]);
            expect(result.current.currentRandom).toBeNull();
        });
    });

    describe('fetchNearest()', () => {
        it('should fetch nearest restaurants successfully and update state', async () => {
            const mockData = [{ id: '1', name: 'Test Restaurant' }];
            // 模擬異步，避免 state update 時發生 warning
            mockGetNearest.mockImplementation(() => Promise.resolve({ success: true, data: mockData }));

            const { result } = renderHook(() => useRestaurant());

            await act(async () => {
                await result.current.fetchNearest({ latitude: 25.0, longitude: 121.0 });
            });

            expect(mockGetNearest).toHaveBeenCalledWith({ latitude: 25.0, longitude: 121.0 });
            expect(result.current.loading).toBe(false);
            expect(result.current.error).toBeNull();
            expect(result.current.restaurants).toEqual(mockData);
        });

        it('should handle API failure gracefully', async () => {
            mockGetNearest.mockImplementation(() => Promise.resolve({ success: false, message: 'API limits exceeded' }));

            const { result } = renderHook(() => useRestaurant());

            await act(async () => {
                await result.current.fetchNearest({ latitude: 25.0, longitude: 121.0 });
            });

            expect(result.current.loading).toBe(false);
            expect(result.current.error).toBe('API limits exceeded');
            expect(result.current.restaurants).toEqual([]);
        });

        it('should handle thrown exceptions gracefully', async () => {
            mockGetNearest.mockImplementation(() => Promise.reject(new Error('Network error')));

            const { result } = renderHook(() => useRestaurant());

            await act(async () => {
                await result.current.fetchNearest({ latitude: 25.0, longitude: 121.0 });
            });

            expect(result.current.loading).toBe(false);
            expect(result.current.error).toBe('Network error');
            expect(result.current.restaurants).toEqual([]);
        });
    });

    describe('refreshNearest()', () => {
        it('should call clearCache before fetching nearest data', async () => {
            const mockData = [{ id: '1', name: 'Refresh Restaurant' }];
            mockGetNearest.mockImplementation(() => Promise.resolve({ success: true, data: mockData }));

            const { result } = renderHook(() => useRestaurant());

            await act(async () => {
                await result.current.refreshNearest({ latitude: 25.0, longitude: 121.0 });
            });

            // clearCache should be called first
            expect(mockClearCache).toHaveBeenCalledTimes(1);
            expect(mockGetNearest).toHaveBeenCalledWith({ latitude: 25.0, longitude: 121.0 });
            expect(result.current.restaurants).toEqual(mockData);
        });
    });

    describe('fetchRandom()', () => {
        it('should fetch random restaurant successfully and update state', async () => {
            const mockData = { id: '99', name: 'Random Lucky Restaurant' };
            mockGetRandom.mockImplementation(() => Promise.resolve({ success: true, data: mockData }));

            const { result } = renderHook(() => useRestaurant());

            await act(async () => {
                await result.current.fetchRandom({ latitude: 25.0, longitude: 121.0 });
            });

            expect(mockGetRandom).toHaveBeenCalledWith({ latitude: 25.0, longitude: 121.0 });
            expect(result.current.loading).toBe(false);
            expect(result.current.error).toBeNull();
            expect(result.current.currentRandom).toEqual(mockData);
        });

        it('should handle random fetch failure and clear previous state', async () => {
            const mockData = { id: '99', name: 'Random Lucky Restaurant' };
            // First successful fetch
            mockGetRandom.mockImplementationOnce(() => Promise.resolve({ success: true, data: mockData }));
            const { result } = renderHook(() => useRestaurant());

            await act(async () => {
                await result.current.fetchRandom({ latitude: 25.0, longitude: 121.0 });
            });
            expect(result.current.currentRandom).toEqual(mockData);

            // Second fetch fails
            mockGetRandom.mockImplementationOnce(() => Promise.resolve({ success: false, message: 'No restaurants nearby' }));
            await act(async () => {
                await result.current.fetchRandom({ latitude: 25.0, longitude: 121.0 });
            });

            expect(result.current.error).toBe('No restaurants nearby');
            expect(result.current.currentRandom).toBeNull();
        });
    });

    describe('clearRandom()', () => {
        it('should set currentRandom back to null', async () => {
            const mockData = { id: '77', name: 'Random 77' };
            mockGetRandom.mockImplementation(() => Promise.resolve({ success: true, data: mockData }));

            const { result, rerender } = renderHook(() => useRestaurant());

            // Get a random restaurant first
            await act(async () => {
                await result.current.fetchRandom({ latitude: 25.0, longitude: 121.0 });
            });
            expect(result.current.currentRandom).toEqual(mockData);

            // Now clear it
            act(() => {
                result.current.clearRandom();
            });

            expect(result.current.currentRandom).toBeNull();
        });
    });
});
