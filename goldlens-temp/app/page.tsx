import { Callout, EmptyState } from "../components/ui";
import { loadGoldLensData } from "../lib/data";
import { fmtDate, latestTradeDate, nearestContract } from "../lib/utils";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof loadGoldLensData>>["contracts"][number];

/* ---------- settings you can tune ---------- */
// factor = multiplier that converts each contract's quote to ₹ per 10 g at 999 purity.
// GOLDM is quoted at 995 purity, so 999/995 is a modelling assumption.
const CONFIG = {
  GOLDM: { factor: 999 / 995, short: "G.M", tag: "Mini" },
  GOLDTEN: { factor: 1, short: "G.TEN", tag: "Ten" },
  GOLDGUINEA: { factor: 10 / 8, short: "G.GUINEA", tag: "Guinea" },
  GOLDPETAL: { factor: 10, short: "G.PETAL", tag: "Petal" },
} as const;
type Sym = keyof typeof CONFIG;
const ORDER: Sym[] = ["GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL"];

const PRICE_TOLERANCE = 0.005; // normalized prices must sit within 0.5% of the median
const MIN_VOLUME = 500; // lots; below this a contract counts as thin
const FEE_BPS = 1; // same defaults as the backtest
const SLIP_BPS = 1;
const FILLS = 4; // two legs, in and out
const SPARK_DAYS = 30;

/* ---------- signal engine hook ---------- */
// TODO: return the number of rows in `signal` with alert_raised = true for the latest date.
// null = engine not connected yet, so the banner will not claim "no signal".
async function loadAlertCount(): Promise<number | null> {
  return null;
}

/* ---------- helpers ---------- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayMon(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]}` : fmtDate(iso);
}
const inr = (v: number) => Math.round(v).toLocaleString("en-IN");
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const signed = (v: number) => {
  const r = Math.round(v);
  return r === 0 ? "0" : `${r > 0 ? "+" : "−"}${Math.abs(r).toLocaleString("en-IN")}`;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Card = { sym: Sym; price: number; volume: number; expiry: string; change: number | null; spark: number[] };
type Check = { label: string; hint: string; value: string; ok: boolean };

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="gl-spark-empty">Not enough history yet</div>;
  const w = 300, h = 56, pad = 4;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - pad - ((v - min) / span) * (h - 2 * pad)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="gl-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Recent settlement trend">
      <polyline points={pts} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Tick({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "gl-tick ok" : "gl-tick warn"} aria-hidden="true">
      {ok ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 7v6M12 17h.01" /></svg>
      )}
    </span>
  );
}

function StatusBanner({ alertCount }: { alertCount: number | null }) {
  let title = "No meaningful signal today";
  let text = "Cross-contract spreads are not flagged after estimated costs.";
  let ok = true;
  if (alertCount === null) {
    title = "Signal engine not connected yet";
    text = "The figures below are descriptive only. Connect the signal table to see alerts here.";
    ok = false;
  } else if (alertCount > 0) {
    title = `${alertCount} signal${alertCount === 1 ? "" : "s"} flagged today`;
    text = "Open Alerts to review the liquidity and cost checks.";
  }
  return (
    <div className="gl-banner" role="status">
      <Tick ok={ok} />
      <div>
        <p className="gl-banner-title">{title}</p>
        <p className="gl-banner-text">{text}</p>
      </div>
    </div>
  );
}

/* ---------- page ---------- */
export default async function OverviewPage() {
  const { contracts, contractsError, invalidCsvRows } = await loadGoldLensData();
  const latest = latestTradeDate(contracts);

  if (!latest) {
    return (
      <EmptyState title="No gold futures data found">
        {contractsError ?? "The CSV was read, but it contains no valid rows."} Run the data pipeline to generate
        data/processed/gold_futures.csv, then refresh.
      </EmptyState>
    );
  }

  const alertCount = await loadAlertCount();
  const rows = contracts.filter((r: Row) => r.tradeDate === latest);
  const tradeDates = new Set(contracts.map((r: Row) => r.tradeDate)).size;

  // One card per symbol: nearest-expiry contract, tracked by its own expiry date (no continuous series).
  const cards: Card[] = [];
  for (const sym of ORDER) {
    const near = nearestContract(rows.filter((r: Row) => r.symbol === sym), latest);
    if (!near || near.close === null) continue;
    const f = CONFIG[sym].factor;
    const spark = contracts
      .filter((r: Row) => r.symbol === sym && r.expiryDate === near.expiryDate && r.close !== null && r.tradeDate <= latest)
      .sort((a: Row, b: Row) => (a.tradeDate < b.tradeDate ? -1 : 1))
      .slice(-SPARK_DAYS)
      .map((r: Row) => (r.close as number) * f);
    const change = spark.length >= 2 ? spark[spark.length - 1] / spark[spark.length - 2] - 1 : null;
    cards.push({ sym, price: near.close * f, volume: near.volume, expiry: near.expiryDate, change, spark });
  }

  if (cards.length === 0) {
    return <EmptyState title="No closing prices available">None of the four gold contracts has a settlement price on {fmtDate(latest)}.</EmptyState>;
  }

  // Market quality checks, all computed from the data.
  const med = median(cards.map((c) => c.price));
  const aligned = cards.filter((c) => Math.abs(c.price / med - 1) <= PRICE_TOLERANCE).length;
  const liquid = cards.filter((c) => c.volume >= MIN_VOLUME).length;
  const updated = ORDER.filter((s) => rows.some((r: Row) => r.symbol === s)).length;
  const roundTrip = (med * (FEE_BPS + SLIP_BPS) * FILLS) / 1e4;
  const checks: Check[] = [
    {
      label: "Price alignment",
      hint: `${aligned} / ${cards.length} contracts within ${(PRICE_TOLERANCE * 100).toFixed(1)}% of median`,
      value: aligned === cards.length ? "Within range" : "Check prices",
      ok: aligned === cards.length,
    },
    {
      label: "Liquidity coverage",
      hint: `${liquid} / ${cards.length} above ${MIN_VOLUME} lots`,
      value: liquid === cards.length ? "Healthy" : liquid * 2 >= cards.length ? "Mixed" : "Thin",
      ok: liquid === cards.length,
    },
    {
      label: "Estimated round trip",
      hint: `per paired unit, ${FILLS} fills at ${FEE_BPS + SLIP_BPS} bps`,
      value: `₹${roundTrip.toFixed(2)}`,
      ok: true,
    },
    {
      label: "Settlement freshness",
      hint: `${updated} / ${ORDER.length} symbols updated on ${fmtDate(latest)}`,
      value: updated === ORDER.length ? "Complete" : "Partial",
      ok: updated === ORDER.length,
    },
  ];

  return (
    <div className="gl-page">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <header className="gl-head">
        <p className="gl-eyebrow">Market overview</p>
        <h1>One market, four contracts</h1>
        <p className="gl-sub">Prices normalized to ₹ per 10 g for a clean, like-for-like comparison.</p>
      </header>

      {tradeDates === 1 ? (
        <Callout>
          Only one trading date ({fmtDate(latest)}) is loaded, so everything below is a snapshot of that day. No
          historical trend has been established yet.
        </Callout>
      ) : null}
      {invalidCsvRows > 0 ? (
        <Callout tone="warn">{invalidCsvRows} CSV row(s) had an invalid symbol or date and were ignored.</Callout>
      ) : null}

      <StatusBanner alertCount={alertCount} />

      <section className="gl-cards" aria-label="Contract prices">
        {cards.map((c) => (
          <article className="gl-card" key={c.sym}>
            <div className="gl-card-top">
              <div>
                <h2>{c.sym}</h2>
                <p className="gl-muted">{CONFIG[c.sym].tag}</p>
              </div>
              {c.change === null ? (
                <span className="gl-pill flat">—</span>
              ) : (
                <span className={c.change >= 0 ? "gl-pill up" : "gl-pill down"}>
                  {c.change >= 0 ? "+" : "−"}
                  {Math.abs(c.change * 100).toFixed(2)}%
                </span>
              )}
            </div>
            <p className="gl-price">
              <span>₹</span>
              {inr(c.price)}
            </p>
            <div className="gl-row gl-muted">
              <span>per 10 g</span>
              <span>Vol {compact(c.volume)}</span>
            </div>
            <Spark values={c.spark} />
            <div className="gl-row gl-foot">
              <span className="gl-muted">Nearest expiry</span>
              <strong>{dayMon(c.expiry)}</strong>
            </div>
          </article>
        ))}
      </section>

      <div className="gl-grid2">
        <section className="gl-panel">
          <div className="gl-panel-head">
            <h2>Normalized spread matrix</h2>
            <span className="gl-tag">Row − column</span>
          </div>
          <p className="gl-muted">₹ per 10 g · latest settlement</p>
          <table className="gl-matrix">
            <thead>
              <tr>
                <th />
                {cards.map((c) => (
                  <th key={c.sym} scope="col">{CONFIG[c.sym].short}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cards.map((r) => (
                <tr key={r.sym}>
                  <th scope="row">{CONFIG[r.sym].short}</th>
                  {cards.map((c) => {
                    if (r.sym === c.sym) return <td key={c.sym} className="cell self">—</td>;
                    const d = r.price - c.price;
                    return (
                      <td key={c.sym} className={d >= 0 ? "cell pos" : "cell neg"}>
                        {signed(d)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="gl-legend">
            <span><i className="neg" />Row below column</span>
            <span><i className="pos" />Row above column</span>
          </div>
          <p className="gl-note">Each symbol uses its nearest expiry, so spreads include carry when expiry dates differ.</p>
        </section>

        <section className="gl-panel">
          <h2>Market quality</h2>
          <p className="gl-muted">Checks used before any signal is surfaced</p>
          <ul className="gl-checks">
            {checks.map((k) => (
              <li key={k.label}>
                <Tick ok={k.ok} />
                <div className="gl-check-text">
                  <strong>{k.label}</strong>
                  <span className="gl-muted">{k.hint}</span>
                </div>
                <span className={k.ok ? "gl-check-val ok" : "gl-check-val warn"}>{k.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const CSS = `
.gl-page{
  --gl-text:#f3f5f7;--gl-muted:#8d97a3;--gl-soft:#b8c0c8;--gl-accent:#e8a33d;
  --gl-card:rgba(255,255,255,.04);--gl-line:rgba(255,255,255,.10);--gl-line-soft:rgba(255,255,255,.07);
  --gl-chip:rgba(255,255,255,.08);
  --gl-up-bg:rgba(52,168,110,.16);--gl-up:#5fd39a;
  --gl-down-bg:rgba(240,98,80,.16);--gl-down:#ff8a78;
  --gl-amber-bg:rgba(232,163,61,.10);--gl-amber-line:rgba(232,163,61,.35);--gl-amber-soft:rgba(232,163,61,.20);
  --gl-pos-bg:rgba(232,163,61,.22);--gl-pos:#f5c97a;
  --gl-neg-bg:rgba(120,150,180,.20);--gl-neg:#b9cbdd;
  display:flex;flex-direction:column;gap:24px;color:var(--gl-text)}
.gl-head h1{margin:6px 0 8px;font-size:40px;line-height:1.1;font-weight:700;color:var(--gl-text)}
.gl-eyebrow{margin:0;font-size:12px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--gl-accent)}
.gl-sub{margin:0;font-size:17px;color:var(--gl-soft)}
.gl-muted{margin:0;font-size:14px;color:var(--gl-muted)}
.gl-banner{display:flex;align-items:center;gap:16px;padding:20px 24px;border-radius:16px;background:var(--gl-amber-bg);border:1px solid var(--gl-amber-line)}
.gl-banner-title{margin:0;font-size:20px;font-weight:600;color:var(--gl-text)}
.gl-banner-text{margin:4px 0 0;font-size:15px;color:var(--gl-soft)}
.gl-tick{display:inline-flex;flex:none;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%}
.gl-tick.ok{background:var(--gl-up-bg);color:var(--gl-up)}
.gl-tick.warn{background:var(--gl-amber-soft);color:var(--gl-accent)}
.gl-banner .gl-tick{background:var(--gl-chip);border:1px solid var(--gl-amber-line)}
.gl-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px}
.gl-card{display:flex;flex-direction:column;gap:6px;padding:22px 24px;border-radius:16px;background:var(--gl-card);border:1px solid var(--gl-line)}
.gl-card h2{margin:0;font-size:16px;font-weight:700;letter-spacing:.02em;color:var(--gl-text)}
.gl-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.gl-pill{padding:4px 10px;border-radius:999px;font-size:13px;font-weight:600}
.gl-pill.up{background:var(--gl-up-bg);color:var(--gl-up)}
.gl-pill.down{background:var(--gl-down-bg);color:var(--gl-down)}
.gl-pill.flat{background:var(--gl-chip);color:var(--gl-muted)}
.gl-price{margin:22px 0 0;font-size:34px;font-weight:700;color:var(--gl-text)}
.gl-price span{margin-right:2px;font-size:22px;color:var(--gl-accent)}
.gl-row{display:flex;justify-content:space-between;align-items:center;font-size:14px}
.gl-spark{width:100%;height:56px;margin:14px 0 6px}
.gl-spark polyline{stroke:var(--gl-accent)}
.gl-spark-empty{height:56px;margin:14px 0 6px;display:flex;align-items:center;font-size:13px;color:var(--gl-muted)}
.gl-foot{padding-top:12px;border-top:1px solid var(--gl-line-soft)}
.gl-foot strong{color:var(--gl-text)}
.gl-grid2{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:24px}
.gl-panel{padding:28px;border-radius:16px;background:var(--gl-card);border:1px solid var(--gl-line)}
.gl-panel h2{margin:0;font-size:22px;font-weight:700;color:var(--gl-text)}
.gl-panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.gl-tag{padding:4px 12px;border-radius:999px;background:var(--gl-chip);font-size:13px;font-weight:600;color:var(--gl-soft)}
.gl-matrix{width:100%;margin-top:16px;border-collapse:separate;border-spacing:8px;table-layout:fixed}
.gl-matrix th{font-size:13px;font-weight:600;color:var(--gl-muted);text-align:center}
.gl-matrix tbody th{text-align:left;color:var(--gl-text)}
.gl-matrix .cell{height:54px;border-radius:8px;text-align:center;font-size:17px;font-weight:600}
.gl-matrix .pos{background:var(--gl-pos-bg);color:var(--gl-pos)}
.gl-matrix .neg{background:var(--gl-neg-bg);color:var(--gl-neg)}
.gl-matrix .self{background:var(--gl-chip);color:var(--gl-muted)}
.gl-legend{display:flex;justify-content:flex-end;gap:18px;margin-top:6px;font-size:12px;color:var(--gl-muted)}
.gl-legend i{display:inline-block;width:18px;height:6px;margin-right:6px;border-radius:3px}
.gl-legend i.pos{background:var(--gl-pos-bg)}
.gl-legend i.neg{background:var(--gl-neg-bg)}
.gl-note{margin:10px 0 0;font-size:12px;color:var(--gl-muted)}
.gl-checks{margin:12px 0 0;padding:0;list-style:none}
.gl-checks li{display:flex;align-items:center;gap:16px;padding:16px 0;border-top:1px solid var(--gl-line-soft)}
.gl-checks li:first-child{border-top:0}
.gl-check-text{display:flex;flex:1;flex-direction:column;gap:2px}
.gl-check-text strong{font-size:15px;color:var(--gl-text)}
.gl-check-val{font-size:15px;font-weight:600}
.gl-check-val.ok{color:var(--gl-up)}
.gl-check-val.warn{color:var(--gl-accent)}
@media (max-width:1200px){.gl-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:1000px){.gl-grid2{grid-template-columns:1fr}}
@media (max-width:640px){.gl-cards{grid-template-columns:1fr}.gl-head h1{font-size:30px}}
`;