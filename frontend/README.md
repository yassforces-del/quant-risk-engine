# quant-risk-engine

A production-grade AI-powered portfolio risk analysis engine built with Hono, TypeScript, and Groq (LLaMA 3.3 70B).

---

## Features

- **AI Risk Analysis** — LLaMA 3.3 70B via Groq API analyzes your crypto portfolio and returns risk level, type, description, and suggested action
- **Real-time Market Data** — Fetches live volatility (sigma), bid-ask spread, and volume from Binance
- **Multi-asset Support** — Analyze multiple crypto assets simultaneously using `Promise.all`
- **LRU Cache** — Avoids redundant API calls for identical portfolios
- **Circuit Breaker** — Protects against Groq API failures with automatic recovery
- **Rate Limiter** — 10 requests per minute per IP
- **Structured Logging** — Winston logger with timestamps and metadata
- **Input Validation** — Zod schema validation on all inputs
- **React Frontend** — Clean dark UI to manage assets and visualize results

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Hono + Node.js + TypeScript |
| AI | Groq API (LLaMA 3.3 70B) |
| Market Data | Binance REST API |
| Frontend | React + Vite + TypeScript |
| Testing | Jest + ts-jest |
| Logging | Winston |

---

## Project Structure

```
quant-risk-engine/
├── src/
│   ├── app.ts          # Hono app, routes, business logic
│   ├── index.ts        # Server entry point
│   └── utils/
│       ├── circuitBreaker.ts
│       ├── LRUcache.ts
│       └── logger.ts
├── frontend/
│   └── src/
│       └── App.tsx     # React UI
├── tests/
│   └── app.test.ts
├── .env.example
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js >= 18
- A [Groq API key](https://console.groq.com)

### Installation

```bash
# Clone the repo
git clone https://github.com/your-username/quant-risk-engine.git
cd quant-risk-engine

# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### Environment Variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

```env
GROQ_API_KEY=your_groq_api_key_here
PORT=3000
NODE_ENV=development
```

### Run

```bash
# Terminal 1 — Backend
npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

- Backend: http://localhost:3000
- Frontend: http://localhost:5173

---

## API

### `POST /analyze`

Analyze a portfolio of crypto assets.

**Request:**
```json
{
  "assets": [
    { "symbol": "BTC", "quantity": 1, "purchasePrice": 60000 },
    { "symbol": "SOL", "quantity": 10, "purchasePrice": 80 }
  ]
}
```

**Response:**
```json
{
  "riskLevel": "moderate",
  "riskType": "volatility",
  "description": "Volatilité modérée sur BTC...",
  "suggestedAction": "Conserver la position",
  "exposurePercent": 40,
  "score": 55,
  "stats": {
    "sigma": "37.68%",
    "spread": "0.0002%",
    "liquidity": "Excellente"
  }
}
```

### `GET /health`

```json
{ "status": "ok", "timestamp": "2026-04-25T02:00:00.000Z" }
```

---

## Tests

```bash
# Run tests
npm test

# Run with coverage
npx jest --coverage
```

Coverage summary:

| File | Statements | Branches | Functions | Lines |
|------|-----------|----------|-----------|-------|
| app.ts | 93% | 62% | 95% | 98% |
| circuitBreaker.ts | 100% | 100% | 100% | 100% |
| LRUcache.ts | 100% | 71% | 100% | 100% |
| logger.ts | 100% | 100% | 100% | 100% |

---

## License

MIT