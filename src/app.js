"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = exports.cache = void 0;
const hono_1 = require("hono");
const cors_1 = require("hono/cors");
const dotenv_1 = require("dotenv");
const zod_1 = require("zod");
const circuitBreaker_1 = require("./utils/circuitBreaker");
const LRUcache_1 = require("./utils/LRUcache");
const logger_1 = __importDefault(require("./utils/logger"));
const hono_rate_limiter_1 = require("hono-rate-limiter");
const secure_headers_1 = require("hono/secure-headers");
(0, dotenv_1.config)();
const app = new hono_1.Hono();
exports.app = app;
app.use('/*', (0, cors_1.cors)());
app.use('*', (0, secure_headers_1.secureHeaders)());
if (process.env.NODE_ENV !== 'test') {
    app.use('/analyze', (0, hono_rate_limiter_1.rateLimiter)({
        windowMs: 60000,
        limit: 10,
        keyGenerator: (c) => c.req.header('x-forwarded-for') ?? 'anonymous',
        message: { error: 'Trop de requêtes, attendez 1 minute' },
    }));
}
function calculateVolatility(prices) {
    if (prices.length < 2)
        return 0;
    const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
    if (returns.length < 2)
        return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(365);
}
function calculateSharpe(prices) {
    if (prices.length < 2)
        return 0;
    const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const volatility = calculateVolatility(prices);
    if (volatility === 0)
        return 0;
    return parseFloat((avgReturn / volatility).toFixed(2));
}
function computeWeights(assets) {
    const values = assets.map(a => a.quantity * a.purchasePrice);
    const total = values.reduce((a, b) => a + b, 0);
    return total === 0 ? assets.map(() => 1 / assets.length) : values.map(v => v / total);
}
function weightedAvg(marketsData, weights, key, precision) {
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
async function getMarketData(symbol) {
    logger_1.default.info('getMarketData called', { symbol });
    try {
        const pair = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
        const histRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&limit=7`);
        const histData = (await histRes.json());
        const prices = histData.map((d) => Number(d[4]));
        const tickerRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`);
        const ticker = (await tickerRes.json());
        const ask = parseFloat(ticker.askPrice ?? '0');
        const bid = parseFloat(ticker.bidPrice ?? '0');
        const sigma = (calculateVolatility(prices) * 100).toFixed(2);
        const sharpe = calculateSharpe(prices);
        const spread = ask ? (((ask - bid) / ask) * 100).toFixed(4) : '0.00';
        const volume = Number(ticker.quoteVolume || 0).toLocaleString();
        logger_1.default.info('Market data fetched', { symbol, sigma, spread, volume, sharpe });
        return { sigma, spread, volume, sharpe, prices }; // ← prices ajouté
    }
    catch (err) {
        logger_1.default.warn('getMarketData failed, returning N/A', { symbol, error: err.message });
        return { sigma: 'N/A', spread: 'N/A', volume: 'N/A', sharpe: 0, prices: [] };
    }
}
function computeScore(sigma, spread) {
    let score = 100 - (parseFloat(sigma || '0') * 1.2) - (parseFloat(spread || '0') * 50);
    return Math.max(0, Math.min(100, Math.round(score)));
}
function interpretScore(score) {
    if (score > 75)
        return 'Portfolio sain';
    if (score > 50)
        return 'Risque modéré';
    if (score > 30)
        return 'Risque élevé';
    return 'Risque critique';
}
function buildFallback(avgSigma, avgSpread, avgSharpe) {
    const score = computeScore(avgSigma, avgSpread);
    return {
        riskLevel: score > 75 ? 'low' : score > 50 ? 'moderate' : score > 30 ? 'high' : 'critical',
        riskType: 'volatility',
        description: `Mode dégradé — analyse technique: Sigma ${avgSigma}%, Spread ${avgSpread}%, Sharpe ${avgSharpe}.\n\n📊 Risk Insight: ${interpretScore(score)}`,
        suggestedAction: 'Surveiller la volatilité.',
        exposurePercent: 100,
        score,
        sparklines: {},
        stats: {
            sigma: `${avgSigma}%`,
            spread: `${avgSpread}%`,
            liquidity: Number(avgSpread) > 0.1 ? 'Faible' : 'Excellente',
            sharpe: avgSharpe,
        },
    };
}
exports.cache = new LRUcache_1.LRUCache(50);
const AssetSchema = zod_1.z.object({
    symbol: zod_1.z.string().max(10).regex(/^[A-Z]+$/),
    quantity: zod_1.z.number().positive(),
    purchasePrice: zod_1.z.number().positive(),
});
app.post('/analyze', async (c) => {
    logger_1.default.info('POST /analyze received');
    try {
        const body = await c.req.json();
        const assets = zod_1.z.array(AssetSchema).parse(body.assets);
        const cacheKey = JSON.stringify(assets);
        const cached = exports.cache.get(cacheKey);
        if (cached) {
            logger_1.default.info('Cache hit', { cacheKey });
            return c.json({ ...cached, source: 'cache' });
        }
        const marketsData = await Promise.all(assets.map(a => getMarketData(a.symbol)));
        const weights = computeWeights(assets);
        // Sparklines par symbol
        const sparklines = {};
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
        const analysis = await circuitBreaker_1.groqCircuitBreaker.execute(async () => {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
            });
            if (response.status === 429) {
                logger_1.default.warn('Groq 429 — switching to degraded mode');
                return buildFallback(avgSigma, avgSpread, avgSharpe);
            }
            const data = (await response.json());
            let content = data?.choices?.[0]?.message?.content || '{}';
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(content);
            const score = computeScore(avgSigma, avgSpread);
            result.score = score;
            result.sparklines = sparklines; // ← ajouté
            result.stats = {
                sigma: `${avgSigma}%`,
                spread: `${avgSpread}%`,
                liquidity: Number(avgSpread) > 0.1 ? 'Faible' : 'Excellente',
                sharpe: avgSharpe,
            };
            result.description += '\n\n📊 Risk Insight: ' + interpretScore(score);
            return result;
        });
        exports.cache.set(cacheKey, analysis);
        return c.json(analysis);
    }
    catch (e) {
        logger_1.default.error('Analysis failed', { error: e.message });
        return c.json({ error: e.message }, 500);
    }
});
