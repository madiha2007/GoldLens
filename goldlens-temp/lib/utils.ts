// Pure helpers, types, formatters and alert rules.
// Safe to import from both server and client components (no Node APIs here).

export type Contract = {
  symbol: string;
  tradeDate: string; // ISO yyyy-mm-dd
  expiryDate: string; // ISO yyyy-mm-dd
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number;
  openInterest: number;
};

export type QualityFile = {
  file: string;
  status: string;
  reason?: string;
  rows_kept?: number;
  requested_date?: string;
  returned_date?: string;
  source_rows?: number;
  target_futures_rows?: number;
  invalid_expiry_rows?: number;
  zero_volume_rows?: number;
};

export type QualityReport = {
  files_discovered?: number;
  files_processed?: number;
  files_skipped?: number;
  clean_rows?: number;
  symbols_found?: string[];
  missing_contract_symbols?: string[];
  zero_volume_rows?: number;
  duplicate_key_rows_removed?: number;
  volume_unit?: string;
  open_interest_unit?: string;
  files?: QualityFile[];
};

export type Tone = "pos" | "neg" | "warn" | "gold" | "neutral";

export const SYMBOLS = ["GOLD", "GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL"] as const;

/* ---------- formatting ---------- */

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function fmtNum(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : inr.format(v);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Whole days from one ISO date to another (negative if `to` is earlier). */
export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/* ---------- dataset helpers ---------- */

export function latestTradeDate(rows: Contract[]): string | null {
  let latest: string | null = null;
  for (const r of rows) if (latest === null || r.tradeDate > latest) latest = r.tradeDate;
  return latest;
}

/** Known symbols first (in a fixed order), then any extra symbols alphabetically. */
export function orderedSymbols(rows: Contract[]): string[] {
  const present = new Set(rows.map((r) => r.symbol));
  const known = SYMBOLS.filter((s) => present.has(s)) as string[];
  const extra = Array.from(present)
    .filter((s) => !(SYMBOLS as readonly string[]).includes(s))
    .sort();
  return [...known, ...extra];
}

/** Nearest not-yet-expired contract (with a close price) among one symbol's rows. */
export function nearestContract(rows: Contract[], referenceDate: string): Contract | null {
  const candidates = rows
    .filter((r) => r.expiryDate >= referenceDate && r.close !== null)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  return candidates[0] ?? null;
}

/* ---------- expiry status (transparent rule) ---------- */

export const EXPIRING_SOON_DAYS = 14;

export function expiryStatus(daysLeft: number | null): { label: string; tone: Tone } {
  if (daysLeft === null) return { label: "Unknown", tone: "neutral" };
  if (daysLeft < 0) return { label: "Expired", tone: "neg" };
  if (daysLeft === 0) return { label: "Expires today", tone: "warn" };
  if (daysLeft <= EXPIRING_SOON_DAYS) return { label: "Expiring soon", tone: "warn" };
  return { label: "Active", tone: "pos" };
}

/* ---------- alert rules (simple, data-based, visible thresholds) ---------- */

export type AlertRule = {
  id: string;
  title: string;
  description: string;
  status: "active" | "pending";
};

export const ALERT_RULES: AlertRule[] = [
  {
    id: "low-liquidity",
    title: "Low-liquidity warning",
    description: "Flags a contract whose volume is 0 on the latest trading date.",
    status: "active",
  },
  {
    id: "missing-data",
    title: "Missing contract data",
    description:
      "Flags contracts with an empty open, high or low value, and any expected symbol the data-quality report lists as missing.",
    status: "active",
  },
  {
    id: "approaching-expiry",
    title: "Approaching expiry",
    description: `Flags contracts expiring within ${EXPIRING_SOON_DAYS} days of the latest trading date.`,
    status: "active",
  },
  {
    id: "price-difference",
    title: "Unusual price differences",
    description:
      "Needs contract-size and quotation normalisation before prices can be compared fairly. Not implemented yet.",
    status: "pending",
  },
];

export type Alert = {
  id: string;
  ruleId: string;
  severity: "warning" | "info";
  symbol: string;
  expiryDate: string | null;
  message: string;
};

export function buildAlerts(
  latestRows: Contract[],
  latestDate: string | null,
  report: QualityReport | null,
): Alert[] {
  const out: Alert[] = [];
  if (!latestDate) return out;

  for (const r of latestRows) {
    const key = `${r.symbol}-${r.expiryDate}`;
    if (r.volume === 0) {
      out.push({
        id: `liq-${key}`,
        ruleId: "low-liquidity",
        severity: "info",
        symbol: r.symbol,
        expiryDate: r.expiryDate,
        message: "No contracts traded on the latest trading date.",
      });
    }
    if (r.open === null || r.high === null || r.low === null) {
      out.push({
        id: `miss-${key}`,
        ruleId: "missing-data",
        severity: "warning",
        symbol: r.symbol,
        expiryDate: r.expiryDate,
        message: "Open, high or low is empty in the source data.",
      });
    }
    const d = daysBetween(latestDate, r.expiryDate);
    if (d !== null && d >= 0 && d <= EXPIRING_SOON_DAYS) {
      out.push({
        id: `exp-${key}`,
        ruleId: "approaching-expiry",
        severity: "warning",
        symbol: r.symbol,
        expiryDate: r.expiryDate,
        message: `Expires in ${d} day${d === 1 ? "" : "s"} (counted from the latest trading date).`,
      });
    }
  }

  for (const s of report?.missing_contract_symbols ?? []) {
    out.push({
      id: `sym-${s}`,
      ruleId: "missing-data",
      severity: "warning",
      symbol: s,
      expiryDate: null,
      message: "Expected symbol is missing from the processed data (per data-quality report).",
    });
  }

  return out.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1) ||
      a.symbol.localeCompare(b.symbol) ||
      (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""),
  );
}