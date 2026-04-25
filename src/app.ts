import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from 'dotenv';
import { z } from 'zod';
import { groqCircuitBreaker } from './utils/circuitBreaker';
import { LRUCache } from './utils/LRUcache';
import logger from './utils/logger';
import { rateLimiter } from 'hono-rate-limiter';
import { secureHeaders } from 'hono/secure-headers';

config();

const app = new Hono();
app.use('/*', cors());
app.use('*', secureHeaders());

if (process.env.NODE_ENV !== 'test') {
  app.use('/analyze', rateLimiter({
    windowMs: 60000,
    limit: 10,
    keyGenerator: (c) => c.req.header('x-forwarded-for') ?? 'anonymous',
    message: { error: 'Trop de requêtes, attendez 1 minute' },
  }));
}

type Asset = {
  symbol: string;
  quantity: number;
  purchasePrice: number;
};

type AnalysisResult = {
  riskLevel: string;
  riskType: string;
  description: string;
  suggestedAction: string;
  exposurePercent: number;
  score: number;
  sparklines: Record<string, number[]>; // ← nouveau
  stats: {
    sigma: string;
    spread: string;
    liquidity: string;
    sharpe: string;
  };
};

function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365);
}

function calculateSharpe(prices: number[]): number {
  if (prices.length < 2) return 0;
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const volatility = calculateVolatility(prices);
  if (volatility === 0) return 0;
  return parseFloat((avgReturn / volatility).toFixed(2));
}

function computeWeights(assets: Asset[]): number[] {
  const values = assets.map(a => a.quantity * a.purchasePrice);
  const total = values.reduce((a, b) => a + b, 0);
  return total === 0 ? assets.map(() => 1 / assets.length) : values.map(v => v / total);
}

function weightedAvg(
  marketsData: { sigma: string; spread: string; sharpe: number }[],
  weights: number[],
  key: 'sigma' | 'spread' | 'sharpe',
  precision: number
): string {
  let total = 0;
  let totalWeight = 0;
  marketsData.forEach((m, i) => {
    const val = key === 'sharpe' ? m.sharpe : parseFloat(m[key]);
    if (!isNaN(val) && m[key] !== 'N/A') {
      total += val * weights[i];
      totalWeight += weights[i];
    }
  });
  return totalWeight === 0 ? '0.00' : (total / totalWeight).toFixed(precision);
}

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  ADA: 'cardano',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  DOT: 'polkadot',
};

async function getMarketData(symbol: string) {
  logger.info('getMarketData called', { symbol });
  try {
    const id = COINGECKO_IDS[symbol] ?? symbol.toLowerCase();
    
    // Prix historiques 7 jours
    const histRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=7&interval=daily`
    );
    const histData = (await histRes.json()) as any;
    const prices = histData.prices.map((p: number[]) => p[1]);

    // Ticker actuel
    const tickerRes = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`
    );
    const ticker = (await tickerRes.json()) as any;

    const sigma = (calculateVolatility(prices) * 100).toFixed(2);
    const sharpe = calculateSharpe(prices);
    const volume = ticker[id]?.usd_24h_vol?.toLocaleString() ?? 'N/A';

    logger.info('Market data fetched', { symbol, sigma, volume, sharpe });
    return { sigma, spread: '0.00', volume, sharpe, prices };

  } catch (err: any) {
    logger.warn('getMarketData failed, returning N/A', { symbol, error: err.message });
    return { sigma: 'N/A', spread: 'N/A', volume: 'N/A', sharpe: 0, prices: [] };
  }
}

function computeScore(sigma: string, spread: string): number {
  let score = 100 - (parseFloat(sigma || '0') * 1.2) - (parseFloat(spread || '0') * 50);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function interpretScore(score: number): string {
  if (score > 75) return 'Healthy portfolio';
  if (score > 50) return 'Moderate risk';
  if (score > 30) return 'High risk';
  return 'Critical risk';
}

function buildFallback(avgSigma: string, avgSpread: string, avgSharpe: string): AnalysisResult {
  const score = computeScore(avgSigma, avgSpread);
  return {
    riskLevel: score > 75 ? 'low' : score > 50 ? 'moderate' : score > 30 ? 'high' : 'critical',
    riskType: 'volatility',
    description: `Degraded mode — technical analysis: Sigma ${avgSigma}%, Spread ${avgSpread}%, Sharpe ${avgSharpe}.\n\n📊 Risk Insight: ${interpretScore(score)}`,
    suggestedAction: 'Monitor volatility.',
    exposurePercent: 100,
    score,
    sparklines: {},
    stats: {
      sigma: `${avgSigma}%`,
      spread: `${avgSpread}%`,
      liquidity: Number(avgSpread) > 0.1 ? 'low' : 'excellent',
      sharpe: avgSharpe,
    },
  };
}

export const cache = new LRUCache<AnalysisResult>(50);

const AssetSchema = z.object({
  symbol: z.string().max(10).regex(/^[A-Z]+$/),
  quantity: z.number().positive(),
  purchasePrice: z.number().positive(),
});

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/analyze', async (c) => {
  logger.info('POST /analyze received');
  try {
    const body = await c.req.json();
    const assets = z.array(AssetSchema).parse(body.assets);

    const cacheKey = JSON.stringify(assets);
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info('Cache hit', { cacheKey });
      return c.json({ ...cached, source: 'cache' });
    }

    const marketsData = await Promise.all(assets.map(a => getMarketData(a.symbol)));
    const weights = computeWeights(assets);

    // Sparklines par symbol
    const sparklines: Record<string, number[]> = {};
    assets.forEach((a, i) => {
      sparklines[a.symbol] = marketsData[i].prices;
    });

    const avgSigma = weightedAvg(marketsData, weights, 'sigma', 2);
    const avgSpread = weightedAvg(marketsData, weights, 'spread', 4);
    const avgSharpe = weightedAvg(marketsData, weights, 'sharpe', 2);

    const market = {
      sigma: marketsData.map((m, i) => `${assets[i].symbol}:${m.sigma}%(w:${(weights[i] * 100).toFixed(0)}%)`).join(','),
      volume: marketsData.map((m, i) => `${assets[i].symbol}:${m.volume}`).join(','),
    };

    const analysis = await groqCircuitBreaker.execute(async () => {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            response_format: { type: 'json_object' },
            temperature: 0,
            messages: [
              {
                role: 'system',
                content: `Risk Engine. JSON only:
{"riskLevel":"low|moderate|high|critical","riskType":"market|liquidity|volatility|concentration","description":"technical analysis with numbers","suggestedAction":"concrete action","exposurePercent":number}
Sigma:${avgSigma}% Spread:${avgSpread}% Sharpe:${avgSharpe} Details:${market.sigma} Volume:${market.volume}`
              },
              { role: 'user', content: JSON.stringify(assets) },
            ],
          }),
        }
      );

      if (response.status === 429) {
        logger.warn('Groq 429 — switching to degraded mode');
        return buildFallback(avgSigma, avgSpread, avgSharpe);
      }

      const data = (await response.json()) as any;
      let content = data?.choices?.[0]?.message?.content || '{}';
      content = content.replace(/```json/g, '').replace(/```/g, '').trim();

      const result: AnalysisResult = JSON.parse(content);
      const score = computeScore(avgSigma, avgSpread);

      result.score = score;
      result.sparklines = sparklines; // ← ajouté
      result.stats = {
        sigma: `${avgSigma}%`,
        spread: `${avgSpread}%`,
        liquidity: Number(avgSpread) > 0.1 ? 'low' : 'excellent',
        sharpe: avgSharpe,
      };

      result.description += '\n\n📊 Risk Insight: ' + interpretScore(score);
      return result;
    });

    cache.set(cacheKey, analysis);
    return c.json(analysis);

  } catch (e: any) {
    logger.error('Analysis failed', { error: e.message });
    return c.json({ error: e.message }, 500);
  }
});

export { app };