import { Callout, EmptyState, Panel, SummaryCard, StatusPill } from "../../components/ui";

export const dynamic = "force-dynamic";

const SIGNAL_API = process.env.SIGNAL_API_URL || "http://127.0.0.1:8787";

type Signal = {
  trade_date: string;
  contract_a_id: number;
  contract_b_id: number;
  symbol_a: string;
  symbol_b: string;
  price_a_norm: number;
  price_b_norm: number;
  carry_gap_days: number;
  raw_spread: number;
  genuine_spread: number;
  rolldown: number;
  z_score: number | null;
  liquidity_ok: boolean;
  cost_ok: boolean;
  alert_raised: boolean;
  thin_a: boolean;
  thin_b: boolean;
  strategy_version: string;
};

type Summary = {
  total_signals: number;
  total_alerts: number;
  dates: number;
  pairs: number;
  latest_date: string;
  liquidity_pass_rate: number;
  cost_pass_rate: number;
  avg_z: number;
};

type HistoryDay = {
  trade_date: string;
  total: number;
  alerts: number;
  avg_z: number;
  liq_pct: number;
};

async function fetchJSON<T>(endpoint: string): Promise<T | null> {
  try {
    const res = await fetch(`${SIGNAL_API}${endpoint}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`fetchJSON non-ok ${endpoint}: ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`fetchJSON failed for ${endpoint}:`, err);
    return null;
  }
}

const inr = (v: number) => Math.round(v).toLocaleString("en-IN");
const signed = (v: number) => {
  const r = Math.round(v);
  return r === 0 ? "0" : `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("en-IN")}`;
};
const fmtZ = (v: number | null) => (v === null ? "—" : v.toFixed(2));

function ZBar({ value }: { value: number | null }) {
  if (value === null) return <span className="sig-z-na">—</span>;
  const abs = Math.abs(value);
  const pct = Math.min(abs / 4 * 100, 100);
  const cls = abs >= 2 ? "hot" : abs >= 1 ? "warm" : "cool";
  return (
    <div className="sig-z-bar">
      <div className={`sig-z-fill ${cls}`} style={{ width: `${pct}%` }} />
      <span className={`sig-z-label ${cls}`}>{value.toFixed(2)}</span>
    </div>
  );
}

function Gate({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "sig-gate pass" : "sig-gate fail"} title={label}>
      {ok ? "✓" : "✗"}
    </span>
  );
}

export default async function SignalsPage() {
  const [sigData, summary, histData] = await Promise.all([
    fetchJSON<{ signals: Signal[]; date: string; total: number; alerts: number }>("/api/signals"),
    fetchJSON<Summary>("/api/signals/summary"),
    fetchJSON<{ history: HistoryDay[] }>("/api/signals/history"),
  ]);

  const offline = !sigData;

  return (
    <div className="stack">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {offline ? (
        <Callout tone="warn">
          Signal engine is offline. Start the signal server:{" "}
          <code>python backend/signals/signal_server.py</code>
        </Callout>
      ) : null}

      {/* ── Summary cards ──────────────────────────────────────── */}
      {summary ? (
        <div className="sig-summary">
          <SummaryCard label="Total signals" value={String(summary.total_signals)} hint={`Across ${summary.dates} trading days`} />
          <SummaryCard label="Alerts raised" value={String(summary.total_alerts)} hint="Z-score + liquidity + cost pass" gold />
          <SummaryCard label="Unique pairs" value={String(summary.pairs)} hint="Cross-symbol contract pairs" />
          <SummaryCard label="Avg |z-score|" value={String(summary.avg_z)} hint="Mean absolute z across all signals" />
          <SummaryCard label="Liquidity pass" value={`${summary.liquidity_pass_rate}%`} hint="Signals with both legs liquid" />
          <SummaryCard label="Cost pass" value={`${summary.cost_pass_rate}%`} hint="Spread exceeds round-trip cost" />
        </div>
      ) : null}

      {/* ── Daily alert history sparkline ──────────────────────── */}
      {histData && histData.history.length > 1 ? (
        <Panel title="Daily alert frequency" subtitle="Alerts raised per trading day">
          <div className="sig-hist">
            {(() => {
              const hist = histData.history.slice(-60);
              const maxA = Math.max(1, ...hist.map(d => d.alerts));
              return hist.map((d) => (
                <div key={d.trade_date} className="sig-hist-bar" title={`${d.trade_date}: ${d.alerts} alerts`}>
                  <div className="sig-hist-fill" style={{ height: `${(d.alerts / maxA) * 100}%` }} />
                </div>
              ));
            })()}
          </div>
          <div className="sig-hist-labels">
            <span>{histData.history[Math.max(0, histData.history.length - 60)]?.trade_date}</span>
            <span>{histData.history[histData.history.length - 1]?.trade_date}</span>
          </div>
        </Panel>
      ) : null}

      {/* ── Latest day signal table ───────────────────────────── */}
      <Panel
        title="Signal table"
        subtitle={sigData ? `${sigData.date} · ${sigData.total} pairs, ${sigData.alerts} alerts` : "No data"}
        right={sigData && sigData.alerts > 0 ? <StatusPill tone="warn">{sigData.alerts} alerts</StatusPill> : undefined}
      >
        {!sigData || sigData.signals.length === 0 ? (
          <EmptyState title="No signals available">
            {offline
              ? "Start the signal server to see live signal data."
              : "The signal engine produced no output for the latest trading day."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table sig-table">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th className="num">Price A</th>
                  <th className="num">Price B</th>
                  <th className="num">Spread</th>
                  <th className="num">Roll-down</th>
                  <th className="num">Genuine</th>
                  <th>Z-Score</th>
                  <th className="center">Liq</th>
                  <th className="center">Cost</th>
                  <th className="center">Alert</th>
                  <th className="num">Gap</th>
                </tr>
              </thead>
              <tbody>
                {sigData.signals
                  .sort((a, b) => {
                    // Alerts first, then by |z| descending
                    if (a.alert_raised !== b.alert_raised) return a.alert_raised ? -1 : 1;
                    return Math.abs(b.z_score ?? 0) - Math.abs(a.z_score ?? 0);
                  })
                  .map((s, i) => (
                    <tr key={i} className={s.alert_raised ? "sig-alert-row" : undefined}>
                      <td className="sig-pair">
                        <strong>{s.symbol_a}</strong>
                        <span className="sig-vs">vs</span>
                        <strong>{s.symbol_b}</strong>
                      </td>
                      <td className="num">₹{inr(s.price_a_norm)}</td>
                      <td className="num">₹{inr(s.price_b_norm)}</td>
                      <td className="num">{signed(s.raw_spread)}</td>
                      <td className="num">{signed(s.rolldown)}</td>
                      <td className="num strong">{signed(s.genuine_spread)}</td>
                      <td><ZBar value={s.z_score} /></td>
                      <td className="center"><Gate ok={s.liquidity_ok} label="Liquidity" /></td>
                      <td className="center"><Gate ok={s.cost_ok} label="Cost" /></td>
                      <td className="center">
                        {s.alert_raised
                          ? <span className="sig-fire">🔥</span>
                          : <span className="sig-no">—</span>}
                      </td>
                      <td className="num">{s.carry_gap_days}d</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── Gate legend ───────────────────────────────────────── */}
      <div className="sig-legend">
        <h3>Signal gating rules</h3>
        <div className="sig-legend-grid">
          <div className="sig-legend-item">
            <span className="sig-gate pass">✓</span>
            <div>
              <strong>Z-Score ≥ 2.0</strong>
              <p>Genuine spread deviates significantly from rolling mean</p>
            </div>
          </div>
          <div className="sig-legend-item">
            <span className="sig-gate pass">✓</span>
            <div>
              <strong>Liquidity OK</strong>
              <p>Neither contract leg is a thin day (volume, OI, relative volume all pass)</p>
            </div>
          </div>
          <div className="sig-legend-item">
            <span className="sig-gate pass">✓</span>
            <div>
              <strong>Cost OK</strong>
              <p>Spread exceeds estimated round-trip cost (brokerage + slippage)</p>
            </div>
          </div>
          <div className="sig-legend-item">
            <span className="sig-fire">🔥</span>
            <div>
              <strong>Alert raised</strong>
              <p>All three gates pass — this signal is actionable</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.sig-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:16px;margin-bottom:4px}
@media(max-width:1200px){.sig-summary{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:640px){.sig-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}

.sig-table{table-layout:auto}
.sig-pair{white-space:nowrap}
.sig-pair strong{font-weight:600;color:var(--text)}
.sig-vs{margin:0 6px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.sig-alert-row{background:rgba(232,163,61,.07)!important}
.sig-alert-row td{border-color:rgba(232,163,61,.18)!important}

.sig-z-bar{position:relative;height:22px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden;min-width:90px}
.sig-z-fill{position:absolute;top:0;left:0;height:100%;border-radius:4px;transition:width .3s}
.sig-z-fill.cool{background:rgba(100,160,220,.25)}
.sig-z-fill.warm{background:rgba(232,163,61,.3)}
.sig-z-fill.hot{background:rgba(240,98,80,.35)}
.sig-z-label{position:absolute;top:50%;left:8px;transform:translateY(-50%);font-size:12px;font-weight:700;z-index:1}
.sig-z-label.cool{color:#7cb8e8}
.sig-z-label.warm{color:#e8a33d}
.sig-z-label.hot{color:#ff8a78}
.sig-z-na{color:var(--muted);font-size:13px}

.sig-gate{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;font-size:13px;font-weight:700}
.sig-gate.pass{background:rgba(52,168,110,.16);color:#5fd39a}
.sig-gate.fail{background:rgba(240,98,80,.12);color:#ff8a78}
.sig-fire{font-size:18px}
.sig-no{color:var(--muted)}

.sig-hist{display:flex;align-items:flex-end;gap:2px;height:64px;padding:0 4px}
.sig-hist-bar{flex:1;min-width:2px;max-width:10px;height:100%;display:flex;align-items:flex-end}
.sig-hist-fill{width:100%;background:var(--gold);border-radius:2px 2px 0 0;min-height:1px;transition:height .3s}
.sig-hist-labels{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);padding:4px 4px 0}

.sig-legend{padding:20px 24px;border-radius:16px;background:var(--surface);border:1px solid var(--border)}
.sig-legend h3{margin:0 0 16px;font-size:16px;font-weight:700;color:var(--text)}
.sig-legend-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
@media(max-width:900px){.sig-legend-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.sig-legend-item{display:flex;gap:12px;align-items:flex-start}
.sig-legend-item strong{font-size:14px;color:var(--text)}
.sig-legend-item p{margin:4px 0 0;font-size:12px;color:var(--muted);line-height:1.4}
.center{text-align:center}
`;
