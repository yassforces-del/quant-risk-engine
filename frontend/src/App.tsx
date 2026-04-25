import { useState, useEffect } from 'react';
import { Plus, Trash2, Activity, TrendingUp, AlertTriangle, CheckCircle, XCircle, Clock, Download, FolderPlus, X } from 'lucide-react';

type Asset = { symbol: string; quantity: number; purchasePrice: number; };

type Stats = { sigma: string; spread: string; liquidity: string; sharpe: string; };

type Analysis = {
  riskLevel: string;
  riskType: string;
  description: string;
  suggestedAction: string;
  exposurePercent?: number;
  score?: number;
  stats?: Stats;
  sparklines?: Record<string, number[]>;
  source?: string;
  timestamp?: number;
};

type Portfolio = {
  id: string;
  name: string;
  assets: Asset[];
  lastAnalysis: Analysis | null;
};

const RISK_COLORS: Record<string, string> = {
  low: '#00ff88',
  moderate: '#ffcc00',
  high: '#ff6600',
  critical: '#ff0033',
};

const RISK_ICONS: Record<string, any> = {
  low: CheckCircle,
  moderate: Activity,
  high: AlertTriangle,
  critical: XCircle,
};

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

const DEFAULT_PORTFOLIO: Portfolio = {
  id: '1',
  name: 'MAIN FUND',
  assets: [{ symbol: 'BTC', quantity: 1, purchasePrice: 60000 }],
  lastAnalysis: null,
};

/** SPARKLINE SVG */
function Sparkline({ prices }: { prices: number[] }) {
  if (!prices || prices.length < 2) return <span style={{ color: '#2a4a2a', fontSize: 10 }}>NO DATA</span>;
  const w = 80, h = 28;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const trend = prices[prices.length - 1] >= prices[0];
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={trend ? '#00ff88' : '#ff4444'} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>(() => {
    try {
      const saved = localStorage.getItem('quant_portfolios');
      return saved ? JSON.parse(saved) : [DEFAULT_PORTFOLIO];
    } catch {
      return [DEFAULT_PORTFOLIO];
    }
  });

  const [activeId, setActiveId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('quant_portfolios');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed[0]?.id ?? '1';
      }
    } catch {}
    return '1';
  });

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [time, setTime] = useState(new Date());
  const [critical, setCritical] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');

  // autosave portfolios
  useEffect(() => {
    localStorage.setItem('quant_portfolios', JSON.stringify(portfolios));
  }, [portfolios]);

  // clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // load analysis from active portfolio
  useEffect(() => {
    const active = portfolios.find(p => p.id === activeId);
    setAnalysis(active?.lastAnalysis ?? null);
  }, [activeId]);

  // blink si critique
  useEffect(() => {
    if (!analysis?.score) return;
    if (analysis.score < 30) {
      const interval = setInterval(() => setCritical(c => !c), 500);
      return () => clearInterval(interval);
    } else {
      setCritical(false);
    }
  }, [analysis?.score]);

  const activePortfolio = portfolios.find(p => p.id === activeId) ?? portfolios[0];
  const assets = activePortfolio.assets;

  const setAssets = (updater: (prev: Asset[]) => Asset[]) => {
    setPortfolios(prev => prev.map(p =>
      p.id === activeId ? { ...p, assets: updater(p.assets) } : p
    ));
  };

  const totalValue = assets.reduce((s, a) => s + a.quantity * a.purchasePrice, 0);
  const weights = assets.map(a => {
    const val = a.quantity * a.purchasePrice;
    return totalValue > 0 ? ((val / totalValue) * 100).toFixed(1) : '0.0';
  });

  const addAsset = () => setAssets(p => [...p, { symbol: '', quantity: 0, purchasePrice: 0 }]);
  const removeAsset = (i: number) => setAssets(p => p.filter((_, j) => j !== i));
  const updateAsset = (i: number, f: keyof Asset, v: any) =>
    setAssets(p => p.map((a, j) => j === i ? { ...a, [f]: v } : a));

  const createPortfolio = () => {
    const newP: Portfolio = {
      id: generateId(),
      name: `FUND ${portfolios.length + 1}`,
      assets: [],
      lastAnalysis: null,
    };
    setPortfolios(prev => [...prev, newP]);
    setActiveId(newP.id);
    setAnalysis(null);
  };

  const deletePortfolio = (id: string) => {
    if (portfolios.length === 1) return;
    const remaining = portfolios.filter(p => p.id !== id);
    setPortfolios(remaining);
    if (activeId === id) {
      setActiveId(remaining[0].id);
      setAnalysis(remaining[0].lastAnalysis);
    }
  };

  const startRename = (p: Portfolio) => {
    setEditingName(p.id);
    setTempName(p.name);
  };

  const confirmRename = () => {
    if (!editingName) return;
    setPortfolios(prev => prev.map(p =>
      p.id === editingName ? { ...p, name: tempName.toUpperCase() || p.name } : p
    ));
    setEditingName(null);
  };

  const analyze = async () => {
    setLoading(true);
    setAnalysis(null);
    try {
      const res = await fetch('https://quant-risk-engine.vercel.app/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      const result = { ...data, timestamp: Date.now() };
      setAnalysis(result);
      setHistory(h => [result, ...h].slice(0, 5));
      // save to portfolio
      setPortfolios(prev => prev.map(p =>
        p.id === activeId ? { ...p, lastAnalysis: result } : p
      ));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const exportJSON = () => {
    if (!analysis) return;
    const blob = new Blob([JSON.stringify(analysis, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `risk-analysis-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => window.print();

  const valid = assets.every(a => a.symbol && a.quantity > 0 && a.purchasePrice > 0) && assets.length > 0;
  const riskColor = analysis ? (RISK_COLORS[analysis.riskLevel] ?? '#888') : '#888';
  const RiskIcon = analysis ? (RISK_ICONS[analysis.riskLevel] ?? Activity) : Activity;
  const isCritical = (analysis?.score ?? 100) < 30;

  return (
    <div style={styles.root}>
      <div style={styles.scanlines} />

      {/* TOP BAR */}
      <div style={styles.topBar}>
        <div style={styles.topLeft}>
          <span style={styles.logo}>⬡ QUANT RISK ENGINE</span>
          <span style={styles.tag}>v3.0 // LIVE</span>
        </div>
        <div style={styles.topRight}>
          <Clock size={12} color="#00ff88" />
          <span style={styles.clock}>{time.toLocaleTimeString('en-GB')} UTC</span>
          <span style={{ ...styles.dot, background: '#00ff88' }} />
          <span style={styles.statusText}>CONNECTED</span>
        </div>
      </div>

      {/* PORTFOLIO TABS */}
      <div style={styles.tabBar}>
        <div style={styles.tabList}>
          {portfolios.map(p => (
            <div
              key={p.id}
              style={{
                ...styles.tab,
                borderColor: activeId === p.id ? '#00ff88' : '#0a2a0a',
                color: activeId === p.id ? '#00ff88' : '#2a5a2a',
                background: activeId === p.id ? '#010f01' : 'transparent',
              }}
              onClick={() => setActiveId(p.id)}
            >
              {editingName === p.id ? (
                <input
                  value={tempName}
                  onChange={e => setTempName(e.target.value.toUpperCase())}
                  onBlur={confirmRename}
                  onKeyDown={e => e.key === 'Enter' && confirmRename()}
                  autoFocus
                  style={styles.tabInput}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span onDoubleClick={e => { e.stopPropagation(); startRename(p); }}>
                  {p.name}
                </span>
              )}

              {/* score badge */}
              {p.lastAnalysis?.score !== undefined && (
                <span style={{
                  ...styles.tabScore,
                  color: RISK_COLORS[p.lastAnalysis.riskLevel] ?? '#888',
                }}>
                  {p.lastAnalysis.score}
                </span>
              )}

              {portfolios.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); deletePortfolio(p.id); }}
                  style={styles.tabClose}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>

        <button onClick={createPortfolio} style={styles.newTabBtn}>
          <FolderPlus size={12} /> NEW FUND
        </button>
      </div>

      {/* CRITICAL ALERT */}
      {isCritical && (
        <div style={{
          ...styles.criticalBanner,
          background: critical ? '#1a0000' : '#2a0000',
          borderColor: critical ? '#ff0033' : '#aa0022',
        }}>
          <XCircle size={14} color="#ff0033" />
          <span style={{ color: '#ff0033', letterSpacing: 3, fontSize: 11, fontWeight: 700 }}>
            ⚠ CRITICAL RISK DETECTED — IMMEDIATE ACTION REQUIRED
          </span>
          <XCircle size={14} color="#ff0033" />
        </div>
      )}

      <div style={styles.grid}>

        {/* LEFT — PORTFOLIO */}
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <TrendingUp size={14} color="#00ff88" />
            <span>{activePortfolio.name}</span>
            <span style={styles.badge}>{assets.length} ASSETS</span>
          </div>

          <div style={styles.colHeaders}>
            <span style={{ flex: 2 }}>SYMBOL</span>
            <span style={{ flex: 2 }}>QTY</span>
            <span style={{ flex: 2 }}>PRICE $</span>
            <span style={{ flex: 1.5 }}>WEIGHT</span>
            <span style={{ flex: 1.5 }}>7D CHART</span>
            <span style={{ flex: 0.8 }}></span>
          </div>

          {assets.length === 0 && (
            <div style={styles.emptyAssets}>
              <span>NO POSITIONS — ADD AN ASSET</span>
            </div>
          )}

          {assets.map((a, i) => (
            <div key={i} style={styles.assetRow}>
              <input
                placeholder="BTC"
                value={a.symbol}
                onChange={e => updateAsset(i, 'symbol', e.target.value.toUpperCase())}
                style={{ ...styles.input, flex: 2, fontWeight: 700, color: '#00ff88', letterSpacing: 1 }}
              />
              <input
                type="number"
                placeholder="0"
                value={a.quantity || ''}
                onChange={e => updateAsset(i, 'quantity', Number(e.target.value))}
                style={{ ...styles.input, flex: 2 }}
              />
              <input
                type="number"
                placeholder="0"
                value={a.purchasePrice || ''}
                onChange={e => updateAsset(i, 'purchasePrice', Number(e.target.value))}
                style={{ ...styles.input, flex: 2 }}
              />
              <div style={{ flex: 1.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={styles.weightBar}>
                  <div style={{ ...styles.weightFill, width: `${weights[i]}%` }} />
                </div>
                <span style={styles.weightLabel}>{weights[i]}%</span>
              </div>
              <div style={{ flex: 1.5, display: 'flex', alignItems: 'center' }}>
                {analysis?.sparklines?.[a.symbol]
                  ? <Sparkline prices={analysis.sparklines[a.symbol]}  />
                  : <span style={{ color: '#1a3a1a', fontSize: 10, letterSpacing: 1 }}>RUN ANALYSIS</span>
                }
              </div>
              <button onClick={() => removeAsset(i)} style={{ ...styles.iconBtn, flex: 0.8 }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          <div style={styles.totalRow}>
            <span style={styles.totalLabel}>TOTAL VALUE</span>
            <span style={styles.totalValue}>
              ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>

          <button onClick={addAsset} style={styles.addBtn}>
            <Plus size={13} /> ADD POSITION
          </button>

          <button onClick={analyze} disabled={loading || !valid} style={{
            ...styles.analyzeBtn,
            background: loading || !valid ? '#1a2a1a' : 'transparent',
            borderColor: loading || !valid ? '#1a3a1a' : '#00ff88',
            color: loading || !valid ? '#2a4a2a' : '#00ff88',
            cursor: loading || !valid ? 'not-allowed' : 'pointer',
          }}>
            {loading ? '■ ANALYZING...' : '▶ RUN AI RISK ANALYSIS'}
          </button>
        </div>

        {/* RIGHT — ANALYSIS */}
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <Activity size={14} color="#00ff88" />
            <span>RISK ANALYSIS OUTPUT</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {analysis?.source === 'cache' && (
                <span style={{ ...styles.badge, background: '#1a2a3a', color: '#60a5fa' }}>CACHED</span>
              )}
              {analysis && (
                <>
                  <button onClick={exportJSON} style={styles.exportBtn} title="Export JSON">
                    <Download size={11} /> JSON
                  </button>
                  <button onClick={exportPDF} style={styles.exportBtn} title="Export PDF">
                    <Download size={11} /> PDF
                  </button>
                </>
              )}
            </div>
          </div>

          {!analysis && !loading && (
            <div style={styles.empty}>
              <span style={styles.emptyText}>AWAITING ANALYSIS INPUT</span>
              <span style={styles.cursor}>_</span>
            </div>
          )}

          {loading && (
            <div style={styles.empty}>
              <div style={styles.loadingGrid}>
                {[...Array(12)].map((_, i) => (
                  <div key={i} style={{ ...styles.loadingBlock, opacity: Math.random() > 0.5 ? 1 : 0.3 }} />
                ))}
              </div>
              <span style={styles.emptyText}>FETCHING MARKET DATA + AI ANALYSIS</span>
            </div>
          )}

          {analysis && (
            <div style={styles.resultBody}>
              <div style={{
                ...styles.riskBadge,
                borderColor: riskColor,
                color: riskColor,
                background: isCritical && critical ? '#1a0000' : '#010f01',
                transition: 'background 0.3s',
              }}>
                <RiskIcon size={18} />
                <span style={styles.riskLabel}>{analysis.riskLevel.toUpperCase()}</span>
                <span style={styles.riskType}>// {analysis.riskType.toUpperCase()}</span>
              </div>

              {analysis.score !== undefined && (
                <div style={styles.scoreSection}>
                  <div style={styles.scoreHeader}>
                    <span style={styles.scoreLabel}>RISK SCORE</span>
                    <span style={{
                      ...styles.scoreValue,
                      color: isCritical && critical ? '#ff0033' : riskColor,
                      transition: 'color 0.3s',
                    }}>
                      {analysis.score}/100
                    </span>
                  </div>
                  <div style={styles.scoreTrack}>
                    <div style={{
                      ...styles.scoreFill,
                      width: `${analysis.score}%`,
                      background: isCritical && critical
                        ? 'linear-gradient(90deg, #aa000033, #ff0033)'
                        : `linear-gradient(90deg, ${riskColor}33, ${riskColor})`,
                      boxShadow: `0 0 8px ${riskColor}66`,
                      transition: 'all 0.3s',
                    }} />
                  </div>
                </div>
              )}

              {analysis.stats && (
                <div style={styles.statsGrid}>
                  {[
                    { label: 'SIGMA', value: analysis.stats.sigma },
                    { label: 'SPREAD', value: analysis.stats.spread },
                    { label: 'LIQUIDITY', value: analysis.stats.liquidity },
                    { label: 'SHARPE', value: analysis.stats.sharpe },
                    { label: 'EXPOSURE', value: `${analysis.exposurePercent ?? 0}%` },
                  ].map(s => (
                    <div key={s.label} style={styles.statBox}>
                      <span style={styles.statLabel}>{s.label}</span>
                      <span style={styles.statValue}>{s.value}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={styles.descBox}>
                <span style={styles.descLabel}>// AI ANALYSIS</span>
                <p style={styles.descText}>{analysis.description}</p>
              </div>

              <div style={styles.actionBox}>
                <span style={styles.actionLabel}>▶ SUGGESTED ACTION</span>
                <p style={styles.actionText}>{analysis.suggestedAction}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PORTFOLIO COMPARISON */}
      {portfolios.filter(p => p.lastAnalysis).length > 1 && (
        <div style={styles.historyPanel}>
          <div style={styles.panelHeader}>
            <TrendingUp size={14} color="#00ff88" />
            <span>PORTFOLIO COMPARISON</span>
            <span style={styles.badge}>{portfolios.filter(p => p.lastAnalysis).length} FUNDS</span>
          </div>
          <div style={styles.historyGrid}>
            {portfolios.filter(p => p.lastAnalysis).map(p => (
              <div
                key={p.id}
                style={{
                  ...styles.historyItem,
                  borderColor: activeId === p.id ? '#00ff88' : '#0a2a0a',
                }}
                onClick={() => setActiveId(p.id)}
              >
                <span style={{ color: '#2a5a2a', fontSize: 10, letterSpacing: 1 }}>{p.name}</span>
                <span style={{ color: RISK_COLORS[p.lastAnalysis!.riskLevel] ?? '#888', fontWeight: 700 }}>
                  {p.lastAnalysis!.riskLevel?.toUpperCase()}
                </span>
                <span style={styles.historyScore}>{p.lastAnalysis!.score}/100</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HISTORY */}
      {history.length > 0 && (
        <div style={styles.historyPanel}>
          <div style={styles.panelHeader}>
            <Clock size={14} color="#00ff88" />
            <span>ANALYSIS HISTORY</span>
            <span style={styles.badge}>{history.length} RECORDS</span>
          </div>
          <div style={styles.historyGrid}>
            {history.map((h, i) => (
              <div key={i} style={styles.historyItem} onClick={() => setAnalysis(h)}>
                <span style={{ color: RISK_COLORS[h.riskLevel] ?? '#888', fontWeight: 700 }}>
                  {h.riskLevel?.toUpperCase()}
                </span>
                <span style={styles.historyScore}>{h.score}/100</span>
                <span style={styles.historyTime}>
                  {h.timestamp ? new Date(h.timestamp).toLocaleTimeString('en-GB') : '--'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    background: '#020c02',
    minHeight: '100vh',
    color: '#c8e6c8',
    fontFamily: "'Courier New', 'Lucida Console', monospace",
    fontSize: 13,
    position: 'relative',
    overflow: 'hidden',
  },
  scanlines: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.015) 2px, rgba(0,255,136,0.015) 4px)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 24px',
    borderBottom: '1px solid #0a2a0a',
    background: '#010a01',
    position: 'relative',
    zIndex: 1,
  },
  topLeft: { display: 'flex', alignItems: 'center', gap: 16 },
  topRight: { display: 'flex', alignItems: 'center', gap: 8 },
  logo: { color: '#00ff88', fontWeight: 700, fontSize: 15, letterSpacing: 3 },
  tag: { color: '#2a4a2a', fontSize: 11, letterSpacing: 2 },
  clock: { color: '#4a8a4a', fontSize: 12, letterSpacing: 1 },
  dot: { width: 6, height: 6, borderRadius: '50%', display: 'inline-block' },
  statusText: { color: '#00ff88', fontSize: 11, letterSpacing: 2 },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    background: '#010a01',
    borderBottom: '1px solid #0a2a0a',
    position: 'relative',
    zIndex: 1,
    gap: 8,
  },
  tabList: {
    display: 'flex',
    gap: 2,
    overflowX: 'auto',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    border: '1px solid',
    borderBottom: 'none',
    cursor: 'pointer',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: 700,
    fontFamily: "'Courier New', monospace",
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
    position: 'relative',
    top: 1,
  },
  tabInput: {
    background: 'transparent',
    border: 'none',
    color: '#00ff88',
    fontFamily: "'Courier New', monospace",
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: 700,
    outline: 'none',
    width: 100,
  },
  tabScore: {
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 5px',
    background: '#020c02',
    border: '1px solid #0a2a0a',
  },
  tabClose: {
    background: 'transparent',
    border: 'none',
    color: '#2a4a2a',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    fontFamily: 'inherit',
  },
  newTabBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    border: '1px solid #0a2a0a',
    color: '#2a5a2a',
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: "'Courier New', monospace",
    fontSize: 10,
    letterSpacing: 2,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  criticalBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: '8px 24px',
    border: '1px solid',
    transition: 'all 0.3s',
    position: 'relative',
    zIndex: 1,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 1,
    padding: 24,
    paddingTop: 16,
    position: 'relative',
    zIndex: 1,
  },
  panel: {
    background: '#010f01',
    border: '1px solid #0a2a0a',
    borderRadius: 2,
    padding: 20,
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#00ff88',
    fontWeight: 700,
    letterSpacing: 2,
    fontSize: 11,
    marginBottom: 16,
    paddingBottom: 10,
    borderBottom: '1px solid #0a2a0a',
  },
  badge: {
    marginLeft: 'auto',
    background: '#0a2a0a',
    color: '#00ff88',
    padding: '2px 8px',
    fontSize: 10,
    letterSpacing: 1,
  },
  colHeaders: {
    display: 'flex',
    gap: 8,
    color: '#2a5a2a',
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
    padding: '0 4px',
  },
  emptyAssets: {
    padding: '20px 0',
    color: '#1a3a1a',
    fontSize: 11,
    letterSpacing: 2,
    textAlign: 'center',
  },
  assetRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  input: {
    background: '#020c02',
    border: '1px solid #0a2a0a',
    color: '#c8e6c8',
    padding: '7px 10px',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
  },
  weightBar: {
    flex: 1,
    height: 4,
    background: '#0a1a0a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  weightFill: {
    height: '100%',
    background: '#00ff88',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  weightLabel: {
    color: '#00ff88',
    fontSize: 11,
    minWidth: 36,
    textAlign: 'right',
  },
  iconBtn: {
    background: '#1a0a0a',
    color: '#ff4444',
    border: '1px solid #2a0a0a',
    padding: '7px 10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 4px',
    borderTop: '1px solid #0a2a0a',
    marginTop: 8,
    marginBottom: 12,
  },
  totalLabel: { color: '#2a5a2a', letterSpacing: 2, fontSize: 11 },
  totalValue: { color: '#00ff88', fontWeight: 700, fontSize: 15 },
  addBtn: {
    background: 'transparent',
    border: '1px solid #0a2a0a',
    color: '#4a8a4a',
    padding: '8px 14px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11,
    letterSpacing: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  analyzeBtn: {
    width: '100%',
    padding: '12px',
    border: '1px solid',
    fontFamily: 'inherit',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: 700,
    marginTop: 4,
    transition: 'all 0.2s',
  },
  exportBtn: {
    background: 'transparent',
    border: '1px solid #0a2a0a',
    color: '#4a8a4a',
    padding: '3px 8px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 10,
    letterSpacing: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: 300,
    gap: 16,
  },
  emptyText: { color: '#1a3a1a', letterSpacing: 3, fontSize: 11 },
  cursor: { color: '#00ff88', fontSize: 20 },
  loadingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: 4,
    marginBottom: 16,
  },
  loadingBlock: {
    width: 20,
    height: 20,
    background: '#00ff88',
  },
  resultBody: { display: 'flex', flexDirection: 'column', gap: 14 },
  riskBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: '1px solid',
    padding: '10px 16px',
  },
  riskLabel: { fontWeight: 700, fontSize: 18, letterSpacing: 3 },
  riskType: { color: '#4a6a4a', fontSize: 11, letterSpacing: 2 },
  scoreSection: { display: 'flex', flexDirection: 'column', gap: 6 },
  scoreHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  scoreLabel: { color: '#2a5a2a', fontSize: 10, letterSpacing: 2 },
  scoreValue: { fontWeight: 700, fontSize: 16 },
  scoreTrack: { height: 6, background: '#0a1a0a', borderRadius: 1, overflow: 'hidden' },
  scoreFill: { height: '100%', borderRadius: 1, transition: 'width 0.5s ease' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 },
  statBox: {
    background: '#020c02',
    border: '1px solid #0a2a0a',
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  statLabel: { color: '#2a5a2a', fontSize: 9, letterSpacing: 2 },
  statValue: { color: '#00ff88', fontWeight: 700, fontSize: 14 },
  descBox: { background: '#020c02', border: '1px solid #0a2a0a', padding: 14 },
  descLabel: { color: '#2a5a2a', fontSize: 10, letterSpacing: 2, display: 'block', marginBottom: 8 },
  descText: { color: '#8aba8a', lineHeight: 1.7, margin: 0, fontSize: 12 },
  actionBox: { background: '#010f01', border: '1px solid #1a3a0a', padding: 14 },
  actionLabel: { color: '#00ff88', fontSize: 10, letterSpacing: 2, display: 'block', marginBottom: 8 },
  actionText: { color: '#c8e6c8', margin: 0, fontWeight: 700 },
  historyPanel: {
    margin: '0 24px 24px',
    background: '#010f01',
    border: '1px solid #0a2a0a',
    padding: 16,
    position: 'relative',
    zIndex: 1,
  },
  historyGrid: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  historyItem: {
    background: '#020c02',
    border: '1px solid #0a2a0a',
    padding: '8px 14px',
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    cursor: 'pointer',
    fontSize: 12,
    letterSpacing: 1,
  },
  historyScore: { color: '#4a8a4a' },
  historyTime: { color: '#2a4a2a', fontSize: 11 },
};
