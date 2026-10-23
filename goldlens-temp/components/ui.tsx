"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { fmtDate, fmtNum, type Contract, type Tone } from "../lib/utils";

/* ============================ Icons ============================ */

function Icon({ name }: { name: "grid" | "bars" | "bell" | "calendar" | "database" }) {
  const paths: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </>
    ),
    bars: (
      <>
        <line x1="6" y1="20" x2="6" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="18" y1="20" x2="18" y2="14" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3" />
        <path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" />
      </>
    ),
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/* ====================== Sidebar & header ====================== */

const NAV = [
  { href: "/", label: "Overview", icon: "grid" },
  { href: "/contracts", label: "Contract Analysis", icon: "bars" },
  { href: "/alerts", label: "Alerts", icon: "bell" },
  { href: "/expiry", label: "Expiry Calendar", icon: "calendar" },
  { href: "/data-quality", label: "Data Quality", icon: "database" },
] as const;

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  return (
    <aside className="gl-sidebar">
      <div className="gl-brand">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2 22 12 12 22 2 12Z" fill="var(--gold)" />
          <path d="M12 7 17 12 12 17 7 12Z" fill="var(--bg)" />
        </svg>
        <span>
          Gold<b>Lens</b>
        </span>
      </div>
      <nav className="gl-nav" aria-label="Primary">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "gl-nav-link active" : "gl-nav-link"}
              aria-current={active ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="gl-sidebar-foot">MCX Gold Futures Intelligence</div>
    </aside>
  );
}

const PAGES: Record<string, { title: string; desc: string }> = {
  "/": { title: "Overview", desc: "Latest MCX gold futures records from the daily Bhavcopy." },
  "/contracts": { title: "Contract Analysis", desc: "Explore contracts, expiries and prices by symbol." },
  "/alerts": { title: "Alerts", desc: "Simple, rule-based checks on the latest available data." },
  "/expiry": { title: "Expiry Calendar", desc: "Contract expiry dates found in the current dataset." },
  "/data-quality": { title: "Data Quality", desc: "Results from the Bhavcopy cleaning pipeline." },
};

export function Header({ latestDate, hasData }: { latestDate: string | null; hasData: boolean }) {
  const pathname = usePathname() ?? "/";
  const key = pathname === "/" ? "/" : "/" + pathname.split("/")[1];
  const page = PAGES[key] ?? PAGES["/"];
  return (
    <header className="gl-header">
      <div>
        <h1>{page.title}</h1>
        <p>{page.desc}</p>
      </div>
      <div className="gl-header-meta">
        <span className="meta-chip">
          <small>Market</small>MCX
        </span>
        <span className="meta-chip">
          <small>Latest trading date</small>
          {latestDate ? fmtDate(latestDate) : "—"}
        </span>
        <span className={hasData ? "meta-chip status ok" : "meta-chip status bad"}>
          <i />
          {hasData ? "Historical data loaded" : "No data available"}
          <small className="inline">End-of-day files, not live</small>
        </span>
      </div>
    </header>
  );
}

/* ====================== Generic building blocks ====================== */

export function Panel({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function SummaryCard({
  label,
  value,
  hint,
  gold,
}: {
  label: string;
  value: string;
  hint?: string;
  gold?: boolean;
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className={gold ? "card-value gold" : "card-value"}>{value}</div>
      {hint ? <div className="card-hint">{hint}</div> : null}
    </div>
  );
}

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true" />
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function Callout({ tone = "gold", children }: { tone?: "gold" | "warn" | "neg"; children: ReactNode }) {
  return <div className={`callout ${tone}`}>{children}</div>;
}

/* ============================ Charts ============================ */

export type BarItem = { label: string; value: number; display: string; note?: string };

export function BarList({ items, accent = "gold" }: { items: BarItem[]; accent?: "gold" | "teal" }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <div className="barlist">
      {items.map((i) => {
        const pct = max > 0 ? Math.max((i.value / max) * 100, i.value > 0 ? 1.5 : 0) : 0;
        return (
          <div className="bar-row" key={i.label} title={`${i.label}: ${i.display}${i.note ? ` (${i.note})` : ""}`}>
            <div className="bar-label">
              {i.label}
              {i.note ? <small>{i.note}</small> : null}
            </div>
            <div className="bar-track">
              <div className={`bar-fill ${accent}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="bar-value">{i.display}</div>
          </div>
        );
      })}
    </div>
  );
}

export function LineChart({ points }: { points: { label: string; value: number }[] }) {
  const W = 640;
  const H = 260;
  const L = 68;
  const R = 16;
  const T = 16;
  const B = 36;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.02 || 1;
  const lo = min - span * 0.15;
  const hi = max + span * 0.15;

  const x = (i: number) => L + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);

  return (
    <svg className="linechart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Closing price trend">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="axis">
            {fmtNum(Math.round(t))}
          </text>
        </g>
      ))}
      <polyline
        fill="none"
        stroke="var(--gold)"
        strokeWidth="2"
        points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
      />
      {points.map((p, i) => (
        <g key={`${p.label}-${i}`}>
          <circle cx={x(i)} cy={y(p.value)} r="3.5" fill="var(--gold)">
            <title>{`${p.label}: ${fmtNum(p.value)}`}</title>
          </circle>
          {i === 0 || i === points.length - 1 || points.length <= 6 ? (
            <text
              x={x(i)}
              y={H - 12}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="axis"
            >
              {p.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

/* ======================== Futures table ======================== */

type SortKey =
  | "symbol"
  | "tradeDate"
  | "expiryDate"
  | "open"
  | "high"
  | "low"
  | "close"
  | "volume"
  | "openInterest";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "symbol", label: "Symbol", numeric: false },
  { key: "tradeDate", label: "Trade Date", numeric: false },
  { key: "expiryDate", label: "Expiry Date", numeric: false },
  { key: "open", label: "Open", numeric: true },
  { key: "high", label: "High", numeric: true },
  { key: "low", label: "Low", numeric: true },
  { key: "close", label: "Close", numeric: true },
  { key: "volume", label: "Volume", numeric: true },
  { key: "openInterest", label: "Open Interest", numeric: true },
];

export function FuturesTable({
  rows,
  searchable = true,
  showSymbol = true,
  defaultSort = "symbol",
}: {
  rows: Contract[];
  searchable?: boolean;
  showSymbol?: boolean;
  defaultSort?: SortKey;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: defaultSort, dir: "asc" });

  const view = useMemo(() => {
    const needle = query.trim().toUpperCase();
    const list = needle ? rows.filter((r) => r.symbol.includes(needle)) : rows.slice();
    const factor = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null && bv !== null) return 1; // empty values always last
      if (bv === null && av !== null) return -1;
      let c = 0;
      if (typeof av === "number" && typeof bv === "number") c = av - bv;
      else if (av !== null && bv !== null) c = String(av).localeCompare(String(bv));
      if (c !== 0) return c * factor;
      return (
        a.symbol.localeCompare(b.symbol) ||
        a.expiryDate.localeCompare(b.expiryDate) ||
        a.tradeDate.localeCompare(b.tradeDate)
      );
    });
    return list;
  }, [rows, query, sort]);

  const cols = showSymbol ? COLUMNS : COLUMNS.filter((c) => c.key !== "symbol");

  function toggle(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  if (rows.length === 0) {
    return <EmptyState title="No contract records available">There are no rows to show for this selection.</EmptyState>;
  }

  return (
    <div>
      {searchable ? (
        <div className="table-tools">
          <input
            type="search"
            className="input"
            placeholder="Search by symbol, e.g. GOLDM"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search by symbol"
          />
          <span className="muted">
            {view.length} of {rows.length} contracts
          </span>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={c.numeric ? "num" : undefined}
                  aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button type="button" onClick={() => toggle(c.key)}>
                    {c.label}
                    <span className="sort-ind">{sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="muted center">
                  No symbols match “{query}”.
                </td>
              </tr>
            ) : (
              view.map((r) => (
                <tr key={`${r.symbol}-${r.tradeDate}-${r.expiryDate}`} className={r.volume === 0 ? "zero" : undefined}>
                  {showSymbol ? <td className="sym">{r.symbol}</td> : null}
                  <td>{fmtDate(r.tradeDate)}</td>
                  <td>{fmtDate(r.expiryDate)}</td>
                  <td className="num">{fmtNum(r.open)}</td>
                  <td className="num">{fmtNum(r.high)}</td>
                  <td className="num">{fmtNum(r.low)}</td>
                  <td className="num strong">{fmtNum(r.close)}</td>
                  <td className="num">
                    {r.volume === 0 ? <span className="pill neutral tiny">No trades</span> : null} {fmtNum(r.volume)}
                  </td>
                  <td className="num">{fmtNum(r.openInterest)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}