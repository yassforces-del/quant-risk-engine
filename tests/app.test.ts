import { app, cache } from '../src/app';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { groqCircuitBreaker } from '../src/utils/circuitBreaker';
import { LRUCache } from '../src/utils/LRUcache';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  (groqCircuitBreaker as any).state = 'CLOSED';
  (groqCircuitBreaker as any).failures = 0;
  (groqCircuitBreaker as any).nextAttempt = 0;
  (cache as any).cache.clear();

});
/** HELPERS */
const groqResponse = (content: object) => ({
  json: async () => ({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }),
} as any);

const setupBinanceMocks = (count: number) => {
  for (let i = 0; i < count; i++) {
    mockFetch.mockResolvedValueOnce({
      json: async () => [
        [0,0,0,0,'50000'],[0,0,0,0,'51000'],[0,0,0,0,'49000'],
        [0,0,0,0,'52000'],[0,0,0,0,'48000'],[0,0,0,0,'53000'],[0,0,0,0,'50500'],
      ],
    } as any);
  }
  for (let i = 0; i < count; i++) {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        askPrice: '50100',
        bidPrice: '50000',
        quoteVolume: '1000000',
      }),
    } as any);
  }
};

const urlBasedMock = () => {
  mockFetch.mockImplementation(async (url: any) => {
    const urlStr = typeof url === 'string' ? url : url?.url ?? String(url);
    if (urlStr.includes('klines')) {
      return {
        json: async () => [
          [0,0,0,0,'50000'],[0,0,0,0,'51000'],[0,0,0,0,'49000'],
          [0,0,0,0,'52000'],[0,0,0,0,'48000'],[0,0,0,0,'53000'],[0,0,0,0,'50500'],
        ],
      } as any;
    }
    if (urlStr.includes('ticker')) {
      return {
        json: async () => ({
          askPrice: '50100',
          bidPrice: '50000',
          quoteVolume: '1000000',
        }),
      } as any;
    }
    throw new Error('Groq timeout');
  });
};

/** ========================
 *  POST /analyze
 * ======================== */
describe('POST /analyze', () => {

  it('should return analysis result with one asset', async () => {
    setupBinanceMocks(1);
    mockFetch.mockResolvedValueOnce(groqResponse({
      riskLevel: 'moderate',
      riskType: 'volatility',
      description: 'Volatilité modérée sur BTC',
      suggestedAction: 'Conserver la position',
      exposurePercent: 40,
    }));

    const res = await app.request('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assets: [{ symbol: 'BTC', quantity: 1, purchasePrice: 50000 }],
      }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('riskLevel', 'moderate');
    expect(data).toHaveProperty('score');
    expect(data.stats).toHaveProperty('sigma');
    expect(data.stats).toHaveProperty('spread');
    expect(data.stats).toHaveProperty('liquidity');
  });

  it('should return analysis result with multiple assets', async () => {
    setupBinanceMocks(2);
    mockFetch.mockResolvedValueOnce(groqResponse({
      riskLevel: 'high',
      riskType: 'concentration',
      description: 'Portfolio concentré sur deux actifs volatils',
      suggestedAction: 'Diversifier',
      exposurePercent: 70,
    }));

    const res = await app.request('/analyze', {
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
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('riskLevel', 'high');
    expect(data).toHaveProperty('score');
    expect(data.stats).toHaveProperty('sigma');
  });

  it('should return cached result on second identical request', async () => {
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

    const first = await app.request('/analyze', { method: 'POST', headers, body });
    const firstData = await first.json();
    expect(firstData).toHaveProperty('riskLevel');

    const res = await app.request('/analyze', { method: 'POST', headers, body });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('source', 'cache');
  });

  it('should return 500 if Groq fails', async () => {
    urlBasedMock();

    const res = await app.request('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assets: [{ symbol: 'BTC', quantity: 1, purchasePrice: 50000 }],
      }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('should return error if assets are invalid', async () => {
    const res = await app.request('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assets: [{ symbol: 'BTC', quantity: -1, purchasePrice: 0 }],
      }),
    });

    expect([400, 500]).toContain(res.status);
  });

  it('should return N/A stats if Binance fails', async () => {
  mockFetch.mockImplementation(async (url: any) => {
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

  const res = await app.request('/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assets: [{ symbol: 'ADA', quantity: 100, purchasePrice: 5 }],
    }),
  });

  const data = await res.json();
  expect(res.status).toBe(200);
  expect(data.stats.sigma).toBe('0.00%');
});

});

/** ========================
 *  CircuitBreaker
 * ======================== */
describe('CircuitBreaker', () => {

  it('should execute action normally when CLOSED', async () => {
    const result = await groqCircuitBreaker.execute(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('should open circuit after 3 failures', async () => {
    const failing = async () => { throw new Error('fail'); };

    for (let i = 0; i < 3; i++) {
      try { await groqCircuitBreaker.execute(failing); } catch {}
    }

    await expect(groqCircuitBreaker.execute(async () => 'ok'))
      .rejects
      .toThrow('Circuit ouvert');
  });

  it('should transition to HALF_OPEN after timeout', async () => {
    const failing = async () => { throw new Error('fail'); };

    for (let i = 0; i < 3; i++) {
      try { await groqCircuitBreaker.execute(failing); } catch {}
    }

    // simule l'expiration du timeout en manipulant nextAttempt
    (groqCircuitBreaker as any).nextAttempt = Date.now() - 1;

    // en HALF_OPEN, l'action est tentée
    const result = await groqCircuitBreaker.execute(async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('should reset after successful execution', async () => {
    await groqCircuitBreaker.execute(async () => 'ok');
    expect((groqCircuitBreaker as any).state).toBe('CLOSED');
    expect((groqCircuitBreaker as any).failures).toBe(0);
  });

});

/** ========================
 *  LRUCache
 * ======================== */
describe('LRUCache', () => {

  it('should store and retrieve a value', () => {
    const cache = new LRUCache<string>(2);
    cache.set('a', 'valeur A');
    expect(cache.get('a')).toBe('valeur A');
  });

  it('should return undefined for missing key', () => {
    const cache = new LRUCache<string>(2);
    expect(cache.get('inexistant')).toBeUndefined();
  });

  it('should evict least recently used when capacity exceeded', () => {
    const cache = new LRUCache<string>(2);
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.set('c', 'C'); // évince 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('B');
    expect(cache.get('c')).toBe('C');
  });

  it('should update recency on get', () => {
    const cache = new LRUCache<string>(2);
    cache.set('a', 'A');
    cache.set('b', 'B');
    cache.get('a'); // 'a' devient le plus récent
    cache.set('c', 'C'); // évince 'b' pas 'a'
    expect(cache.get('a')).toBe('A');
    expect(cache.get('b')).toBeUndefined();
  });

});