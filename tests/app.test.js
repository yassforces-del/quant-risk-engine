"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("../src/app");
const globals_1 = require("@jest/globals");
const circuitBreaker_1 = require("../src/utils/circuitBreaker");
const LRUcache_1 = require("../src/utils/LRUcache");
const mockFetch = globals_1.jest.fn();
global.fetch = mockFetch;
(0, globals_1.beforeEach)(() => {
    mockFetch.mockReset();
    circuitBreaker_1.groqCircuitBreaker.state = 'CLOSED';
    circuitBreaker_1.groqCircuitBreaker.failures = 0;
    circuitBreaker_1.groqCircuitBreaker.nextAttempt = 0;
    app_1.cache.cache.clear();
});
/** HELPERS */
const groqResponse = (content) => ({
    json: async () => ({
        choices: [{ message: { content: JSON.stringify(content) } }],
    }),
});
const setupBinanceMocks = (count) => {
    for (let i = 0; i < count; i++) {
        mockFetch.mockResolvedValueOnce({
            json: async () => [
                [0, 0, 0, 0, '50000'], [0, 0, 0, 0, '51000'], [0, 0, 0, 0, '49000'],
                [0, 0, 0, 0, '52000'], [0, 0, 0, 0, '48000'], [0, 0, 0, 0, '53000'], [0, 0, 0, 0, '50500'],
            ],
        });
    }
    for (let i = 0; i < count; i++) {
        mockFetch.mockResolvedValueOnce({
            json: async () => ({
                askPrice: '50100',
                bidPrice: '50000',
                quoteVolume: '1000000',
            }),
        });
    }
};
const urlBasedMock = () => {
    mockFetch.mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : url?.url ?? String(url);
        if (urlStr.includes('klines')) {
            return {
                json: async () => [
                    [0, 0, 0, 0, '50000'], [0, 0, 0, 0, '51000'], [0, 0, 0, 0, '49000'],
                    [0, 0, 0, 0, '52000'], [0, 0, 0, 0, '48000'], [0, 0, 0, 0, '53000'], [0, 0, 0, 0, '50500'],
                ],
            };
        }
        if (urlStr.includes('ticker')) {
            return {
                json: async () => ({
                    askPrice: '50100',
                    bidPrice: '50000',
                    quoteVolume: '1000000',
                }),
            };
        }
        throw new Error('Groq timeout');
    });
};
/** ========================
 *  POST /analyze
 * ======================== */
(0, globals_1.describe)('POST /analyze', () => {
    (0, globals_1.it)('should return analysis result with one asset', async () => {
        setupBinanceMocks(1);
        mockFetch.mockResolvedValueOnce(groqResponse({
            riskLevel: 'moderate',
            riskType: 'volatility',
            description: 'Volatilité modérée sur BTC',
            suggestedAction: 'Conserver la position',
            exposurePercent: 40,
        }));
        const res = await app_1.app.request('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assets: [{ symbol: 'BTC', quantity: 1, purchasePrice: 50000 }],
            }),
        });
        const data = await res.json();
        (0, globals_1.expect)(res.status).toBe(200);
        (0, globals_1.expect)(data).toHaveProperty('riskLevel', 'moderate');
        (0, globals_1.expect)(data).toHaveProperty('score');
        (0, globals_1.expect)(data.stats).toHaveProperty('sigma');
        (0, globals_1.expect)(data.stats).toHaveProperty('spread');
        (0, globals_1.expect)(data.stats).toHaveProperty('liquidity');
    });
    (0, globals_1.it)('should return analysis result with multiple assets', async () => {
        setupBinanceMocks(2);
        mockFetch.mockResolvedValueOnce(groqResponse({
            riskLevel: 'high',
            riskType: 'concentration',
            description: 'Portfolio concentré sur deux actifs volatils',
            suggestedAction: 'Diversifier',
            exposurePercent: 70,
        }));
        const res = await app_1.app.request('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assets: [
                    { symbol: 'BTC', quantity: 1, purchasePrice: 50000 },
                    { symbol: 'SOL', quantity: 10, purchasePrice: 80 },
                ],
            }),
        });
        const data = await res.json();
        (0, globals_1.expect)(res.status).toBe(200);
        (0, globals_1.expect)(data).toHaveProperty('riskLevel', 'high');
        (0, globals_1.expect)(data).toHaveProperty('score');
        (0, globals_1.expect)(data.stats).toHaveProperty('sigma');
    });
    (0, globals_1.it)('should return cached result on second identical request', async () => {
        const body = JSON.stringify({
            assets: [{ symbol: 'BTC', quantity: 1, purchasePrice: 50000 }],
        });
        const headers = { 'Content-Type': 'application/json' };
        setupBinanceMocks(1);
        mockFetch.mockResolvedValueOnce(groqResponse({
            riskLevel: 'low',
            riskType: 'market',
            description: 'Risque faible',
            suggestedAction: 'Conserver',
            exposurePercent: 10,
        }));
        const first = await app_1.app.request('/analyze', { method: 'POST', headers, body });
        const firstData = await first.json();
        (0, globals_1.expect)(firstData).toHaveProperty('riskLevel');
        const res = await app_1.app.request('/analyze', { method: 'POST', headers, body });
        const data = await res.json();
        (0, globals_1.expect)(res.status).toBe(200);
        (0, globals_1.expect)(data).toHaveProperty('source', 'cache');
    });
    (0, globals_1.it)('should return 500 if Groq fails', async () => {
        urlBasedMock();
        const res = await app_1.app.request('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assets: [{ symbol: 'BTC', quantity: 1, purchasePrice: 50000 }],
            }),
        });
        (0, globals_1.expect)(res.status).toBe(500);
        const data = await res.json();
        (0, globals_1.expect)(data).toHaveProperty('error');
    });
    (0, globals_1.it)('should return error if assets are invalid', async () => {
        const res = await app_1.app.request('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assets: [{ symbol: 'BTC', quantity: -1, purchasePrice: 0 }],
            }),
        });
        (0, globals_1.expect)([400, 500]).toContain(res.status);
    });
    (0, globals_1.it)('should return N/A stats if Binance fails', async () => {
        mockFetch.mockImplementation(async (url) => {
            const urlStr = typeof url === 'string' ? url : url?.url ?? String(url);
            if (urlStr.includes('klines') || urlStr.includes('ticker')) {
                throw new Error('Binance down');
            }
            return groqResponse({
                riskLevel: 'critical',
                riskType: 'market',
                description: 'Binance indisponible',
                suggestedAction: 'Attendre',
                exposurePercent: 100,
            });
        });
        const res = await app_1.app.request('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assets: [{ symbol: 'ADA', quantity: 100, purchasePrice: 5 }],
            }),
        });
        const data = await res.json();
        (0, globals_1.expect)(res.status).toBe(200);
        (0, globals_1.expect)(data.stats.sigma).toBe('0.00%');
    });
});
/** ========================
 *  CircuitBreaker
 * ======================== */
(0, globals_1.describe)('CircuitBreaker', () => {
    (0, globals_1.it)('should execute action normally when CLOSED', async () => {
        const result = await circuitBreaker_1.groqCircuitBreaker.execute(async () => 'ok');
        (0, globals_1.expect)(result).toBe('ok');
    });
    (0, globals_1.it)('should open circuit after 3 failures', async () => {
        const failing = async () => { throw new Error('fail'); };
        for (let i = 0; i < 3; i++) {
            try {
                await circuitBreaker_1.groqCircuitBreaker.execute(failing);
            }
            catch { }
        }
        await (0, globals_1.expect)(circuitBreaker_1.groqCircuitBreaker.execute(async () => 'ok'))
            .rejects
            .toThrow('Circuit ouvert');
    });
    (0, globals_1.it)('should transition to HALF_OPEN after timeout', async () => {
        const failing = async () => { throw new Error('fail'); };
        for (let i = 0; i < 3; i++) {
            try {
                await circuitBreaker_1.groqCircuitBreaker.execute(failing);
            }
            catch { }
        }
        // simule l'expiration du timeout en manipulant nextAttempt
        circuitBreaker_1.groqCircuitBreaker.nextAttempt = Date.now() - 1;
        // en HALF_OPEN, l'action est tentée
        const result = await circuitBreaker_1.groqCircuitBreaker.execute(async () => 'recovered');
        (0, globals_1.expect)(result).toBe('recovered');
    });
    (0, globals_1.it)('should reset after successful execution', async () => {
        await circuitBreaker_1.groqCircuitBreaker.execute(async () => 'ok');
        (0, globals_1.expect)(circuitBreaker_1.groqCircuitBreaker.state).toBe('CLOSED');
        (0, globals_1.expect)(circuitBreaker_1.groqCircuitBreaker.failures).toBe(0);
    });
});
/** ========================
 *  LRUCache
 * ======================== */
(0, globals_1.describe)('LRUCache', () => {
    (0, globals_1.it)('should store and retrieve a value', () => {
        const cache = new LRUcache_1.LRUCache(2);
        cache.set('a', 'valeur A');
        (0, globals_1.expect)(cache.get('a')).toBe('valeur A');
    });
    (0, globals_1.it)('should return undefined for missing key', () => {
        const cache = new LRUcache_1.LRUCache(2);
        (0, globals_1.expect)(cache.get('inexistant')).toBeUndefined();
    });
    (0, globals_1.it)('should evict least recently used when capacity exceeded', () => {
        const cache = new LRUcache_1.LRUCache(2);
        cache.set('a', 'A');
        cache.set('b', 'B');
        cache.set('c', 'C'); // évince 'a'
        (0, globals_1.expect)(cache.get('a')).toBeUndefined();
        (0, globals_1.expect)(cache.get('b')).toBe('B');
        (0, globals_1.expect)(cache.get('c')).toBe('C');
    });
    (0, globals_1.it)('should update recency on get', () => {
        const cache = new LRUcache_1.LRUCache(2);
        cache.set('a', 'A');
        cache.set('b', 'B');
        cache.get('a'); // 'a' devient le plus récent
        cache.set('c', 'C'); // évince 'b' pas 'a'
        (0, globals_1.expect)(cache.get('a')).toBe('A');
        (0, globals_1.expect)(cache.get('b')).toBeUndefined();
    });
});
