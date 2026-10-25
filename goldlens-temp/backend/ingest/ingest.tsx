/**
 * GoldLens data ingest (TypeScript, run with Node through tsx).
 *
 * Downloads the MCX daily Bhavcopy, validates and cleans it, and keeps only the four gold futures
 * (GOLDM, GOLDTEN, GOLDGUINEA, GOLDPETAL). It saves to:
 *   1. <root>/data/processed/gold_futures.csv      what the website reads
 *   2. <root>/data/processed/data_quality_log.csv  one row per requested day: ok, or why it was skipped
 *   3. Postgres / Supabase tables, only with --db
 * <root> is GOLDLENS_ROOT if set, otherwise the parent of the folder you run from (same rule as lib/data.ts).
 * Re-running is safe: rows are keyed by symbol + expiry_date + trade_date and replaced, never duplicated.
 *
 * Usage (from the Next.js app folder):
 *   npm run ingest                                     last 3 days (daily job)
 *   npm run ingest:backfill                            everything since 2025-01-01, resumable
 *   npm run ingest:file -- bhavcopy.csv --date 2026-10-23     a CSV you downloaded by hand
 * Other flags: --days N  --start YYYY-MM-DD  --end YYYY-MM-DD  --backfill-from YYYY-MM-DD
 *              --csv-out PATH  --log-out PATH  --db  --force  --delay MS
 */
import { promises as fs } from "fs";
import path from "path";
import dotenv from "dotenv";
import type { Client } from "pg";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

/* ------------------------------------------------------------------ types and constants */
type Raw = Record<string, unknown>;
export type Row = {
  symbol: string;
  trade_date: string;
  expiry_date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
  open_interest: number;
};
export type Status = "ok" | "no_data" | "no_rows" | "date_mismatch" | "error" | "fetch_error";
export type LogRow = { requested_date: string; returned_date: string; status: Status; reason: string };

// symbol: [trading_unit_g, quote_unit_g, purity, expiry_window_start, expiry_window_end]
const SPECS: Record<string, [number, number, number, number, number]> = {
  GOLDM: [100, 10, 995, 3, 5],
  GOLDTEN: [10, 10, 999, 27, 31],
  GOLDGUINEA: [8, 8, 999, 27, 31],
  GOLDPETAL: [1, 1, 999, 27, 31],
};
const SYMBOLS = new Set(Object.keys(SPECS));
const CSV_COLS = ["symbol", "trade_date", "expiry_date", "open", "high", "low", "close", "volume", "open_interest"] as const;
const LOG_COLS = ["requested_date", "returned_date", "status", "reason"] as const;
const HANDLED: Status[] = ["ok", "no_data", "no_rows", "date_mismatch"]; // backfill does not ask MCX for these again

const PAGE_URL = "https://www.mcxindia.com/market-data/bhavcopy";
// The request MCX's own page sends. Override with MCX_URL_TEMPLATE if MCX changes it.
// Placeholders: {dd} {mm} {yyyy} {yyyymmdd} {iso}. The date goes in as dd%2Fmm%2Fyyyy.
const DEFAULT_URL =
  "https://www.mcxindia.com/market-data/bhavcopy/GetDateWiseBhavCopy?InstrumentName=ALL&fromDate={dd}%2F{mm}%2F{yyyy}";
const BASE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json",
  Referer: PAGE_URL,
  "X-Requested-With": "XMLHttpRequest",
};

/* ------------------------------------------------------------------ dates and numbers */
const MONTHS = new Map(
  ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].map((m, i) => [m, i + 1]),
);

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** MCX response dates are MM/DD/YYYY; expiries look like 04SEP2026. Returns YYYY-MM-DD or null. */
export function parseDate(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  if (x instanceof Date) return Number.isNaN(x.getTime()) ? null : iso(x.getFullYear(), x.getMonth() + 1, x.getDate());
  const s = String(x).trim().split(/\s+/)[0];
  if (!s) return null;
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (a) return iso(+a[1], +a[2], +a[3]);
  const b = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (b) return iso(+b[3], +b[1], +b[2]) ?? iso(+b[3], +b[2], +b[1]); // MM/DD/YYYY first, DD/MM/YYYY as fallback
  const c = /^(\d{1,2})-?([A-Za-z]{3})-?(\d{4})$/.exec(s);
  if (c) {
    const mo = MONTHS.get(c[2].toUpperCase());
    return mo ? iso(+c[3], mo, +c[1]) : null;
  }
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (d) return iso(+d[1], +d[2], +d[3]);
  return null;
}

function toNum(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (x === null || x === undefined) return null;
  const s = String(x).replace(/,/g, "").trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function todayIso(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ cleaning */
const ALIASES = new Map(
  Object.entries({
    symbol: "symbol", date: "date", tradedate: "date", expirydate: "expiry", expiry: "expiry",
    open: "open", high: "high", low: "low", close: "close", volume: "volume",
    openinterest: "open_interest", oi: "open_interest", instrumentname: "instrument", instrument: "instrument",
  }),
);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** original column name -> canonical name. Also finds "Volume(In Lots)" style names. */
function buildColumnMap(keys: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const k of keys) {
    const t = ALIASES.get(squash(k));
    if (t && !used.has(t)) {
      map.set(k, t);
      used.add(t);
    }
  }
  const fallback = (target: string, ok: (k: string) => boolean) => {
    if (used.has(target)) return;
    for (const k of keys) {
      if (!map.has(k) && ok(squash(k))) {
        map.set(k, target);
        used.add(target);
        return;
      }
    }
  };
  fallback("volume", (k) => k.startsWith("volume") && !k.includes("thousand") && !k.includes("value"));
  fallback("open_interest", (k) => k.startsWith("openint"));
  return map;
}

/** Returns the clean gold rows and a log row. Never throws on bad data: it logs why the day was skipped. */
export function clean(raw: Raw[], requested: string): { rows: Row[]; log: LogRow } {
  const log: LogRow = { requested_date: requested, returned_date: "", status: "ok", reason: "" };
  const fail = (status: Status, reason: string) => {
    log.status = status;
    log.reason = reason;
    return { rows: [] as Row[], log };
  };
  if (raw.length === 0) return fail("no_data", "MCX returned no rows (holiday, weekend or not published yet)");

  const cmap = buildColumnMap(Object.keys(raw[0]));
  const have = new Set(cmap.values());
  const missing = ["symbol", "date", "expiry", "close"].filter((c) => !have.has(c));
  if (missing.length) return fail("error", `missing columns: ${missing.join(", ")}`);

  const recs = raw.map((r) => {
    const o: Raw = {};
    for (const [k, t] of cmap) o[t] = r[k];
    return o;
  });
  const gold = recs
    .map((r): Raw => ({ ...r, symbol: String(r.symbol ?? "").trim().toUpperCase() })) // symbols may be space-padded
    .filter((r) => SYMBOLS.has(String(r.symbol)))
    .filter((r) => !have.has("instrument") || String(r.instrument ?? "").toUpperCase().startsWith("FUT")); // not options
  if (gold.length === 0) return fail("no_rows", "no gold futures rows in the response");

  const dated = gold.map((r) => ({ rec: r, trade_date: parseDate(r.date) }));
  const returned = [...new Set(dated.map((r) => r.trade_date).filter((d): d is string => d !== null))].sort();
  log.returned_date = returned[returned.length - 1] ?? "";
  if (returned.length !== 1 || returned[0] !== requested) {
    // MCX silently returns the latest day for holidays and bad dates
    return fail("date_mismatch", `MCX returned [${returned.join(", ")}] for requested ${requested}`);
  }

  const notes = (["volume", "open_interest"] as const)
    .filter((c) => !have.has(c))
    .map((c) => `no '${c}' column found, set to 0`);
  const out = new Map<string, Row>();
  let dropped = 0;
  for (const { rec: r } of dated) {
    const symbol = String(r.symbol);
    const expiry = parseDate(r.expiry);
    const close = toNum(r.close);
    if (!expiry || close === null || close <= 0) {
      dropped += 1;
      continue;
    }
    out.set(`${symbol}|${expiry}`, {
      symbol,
      trade_date: requested,
      expiry_date: expiry,
      open: toNum(r.open),
      high: toNum(r.high),
      low: toNum(r.low),
      close,
      volume: Math.round(toNum(r.volume) ?? 0),
      open_interest: Math.round(toNum(r.open_interest) ?? 0),
    });
  }
  if (dropped) notes.push(`${dropped} row(s) dropped: bad expiry or non-positive close`);
  log.reason = notes.join("; ");
  if (out.size === 0) return fail("no_rows", "all gold rows were invalid");
  return { rows: [...out.values()], log };
}

/* ------------------------------------------------------------------ downloading */
type Session = { cookie: string; token: string };
let session: Session | null = null;
let lastFetchError = "";

function setCookieLines(h: Headers): string[] {
  const anyH = h as unknown as { getSetCookie?: () => string[] };
  if (typeof anyH.getSetCookie === "function") return anyH.getSetCookie();
  const one = h.get("set-cookie");
  return one ? [one] : [];
}

/** Load the Bhavcopy page first, like a browser: it gives us the cookies and anti-forgery token the data call needs. */
async function getSession(fresh: boolean): Promise<Session> {
  if (session && !fresh) return session;
  if (process.env.MCX_COOKIE && process.env.MCX_TOKEN) {
    // emergency override: values copied from your browser's DevTools (they expire)
    session = { cookie: process.env.MCX_COOKIE, token: process.env.MCX_TOKEN };
    return session;
  }
  const res = await fetch(PAGE_URL, {
    headers: { ...BASE_HEADERS, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`bhavcopy page returned HTTP ${res.status}`);
  const html = await res.text();
  const jar = new Map<string, string>();
  for (const line of setCookieLines(res.headers)) {
    const pair = line.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const m =
    /name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(html) ??
    /value="([^"]+)"[^>]*name="__RequestVerificationToken"/.exec(html);
  session = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), token: m?.[1] ?? "" };
  return session;
}

/** Find the list of records inside whatever JSON wrapper MCX uses. */
function findRecords(obj: unknown): Raw[] {
  if (typeof obj === "string") {
    try {
      return findRecords(JSON.parse(obj));
    } catch {
      return [];
    }
  }
  if (Array.isArray(obj)) return obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null ? (obj as Raw[]) : [];
  if (obj && typeof obj === "object") {
    const o = obj as Raw;
    for (const k of ["d", "Data", "data", "Table", "Result"]) {
      if (k in o) {
        const r = findRecords(o[k]);
        if (r.length) return r;
      }
    }
    for (const v of Object.values(o)) {
      const r = findRecords(v);
      if (r.length) return r;
    }
  }
  return [];
}

export async function fetchDay(d: string): Promise<Raw[]> {
  lastFetchError = "";
  const [yyyy, mm, dd] = d.split("-");
  const tpl = (process.env.MCX_URL_TEMPLATE ?? "").trim() || DEFAULT_URL;
  const url = tpl
    .replaceAll("{dd}", dd).replaceAll("{mm}", mm).replaceAll("{yyyy}", yyyy)
    .replaceAll("{yyyymmdd}", `${yyyy}${mm}${dd}`).replaceAll("{iso}", d);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const s = await getSession(attempt > 0); // second try uses a fresh session
      const headers: Record<string, string> = { ...BASE_HEADERS };
      if (s.cookie) headers.Cookie = s.cookie;
      if (s.token) headers.__RequestVerificationToken = s.token;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      if (!res.ok) {
        lastFetchError = `HTTP ${res.status}: ${JSON.stringify(text.slice(0, 150))}`;
        continue;
      }
      let js: unknown;
      try {
        js = JSON.parse(text);
      } catch {
        lastFetchError = `response is not JSON: ${JSON.stringify(text.slice(0, 150))}`;
        continue;
      }
      lastFetchError = "";
      return findRecords(js);
    } catch (e) {
      lastFetchError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      await sleep(2000);
    }
  }
  return [];
}

/* ------------------------------------------------------------------ CSV */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const f = splitLine(l);
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = (f[i] ?? "").trim()));
    return o;
  });
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

async function writeCsv(p: string, cols: readonly string[], rows: Record<string, string | number | null>[]) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c] === null || r[c] === undefined ? "" : String(r[c]))).join(","));
  await fs.writeFile(p, lines.join("\n") + "\n", "utf8");
}

export async function mergeRows(file: string, fresh: Row[]): Promise<number> {
  const map = new Map<string, Row>();
  const old = await readIfExists(file);
  if (old) {
    for (const r of parseCsv(old)) {
      const symbol = (r.symbol ?? "").trim().toUpperCase();
      const trade_date = parseDate(r.trade_date);
      const expiry_date = parseDate(r.expiry_date);
      const close = toNum(r.close);
      if (!symbol || !trade_date || !expiry_date || close === null) continue;
      map.set(`${symbol}|${expiry_date}|${trade_date}`, {
        symbol, trade_date, expiry_date, close,
        open: toNum(r.open), high: toNum(r.high), low: toNum(r.low),
        volume: toNum(r.volume) ?? 0, open_interest: toNum(r.open_interest) ?? 0,
      });
    }
  }
  for (const r of fresh) map.set(`${r.symbol}|${r.expiry_date}|${r.trade_date}`, r); // new data replaces old
  const all = [...map.values()].sort((a, b) =>
    a.trade_date === b.trade_date
      ? a.symbol === b.symbol ? a.expiry_date.localeCompare(b.expiry_date) : a.symbol.localeCompare(b.symbol)
      : a.trade_date.localeCompare(b.trade_date),
  );
  await writeCsv(file, CSV_COLS, all);
  return all.length;
}

async function readLog(file: string): Promise<Map<string, LogRow>> {
  const map = new Map<string, LogRow>();
  const txt = await readIfExists(file);
  if (txt) {
    for (const r of parseCsv(txt)) {
      const d = parseDate(r.requested_date);
      if (d) map.set(d, { requested_date: d, returned_date: r.returned_date ?? "", status: (r.status as Status) ?? "error", reason: r.reason ?? "" });
    }
  }
  return map;
}

async function mergeLog(file: string, fresh: LogRow[]): Promise<void> {
  const map = await readLog(file);
  for (const l of fresh) map.set(l.requested_date, l);
  const all = [...map.values()].sort((a, b) => a.requested_date.localeCompare(b.requested_date));
  await writeCsv(file, LOG_COLS, all);
}

/* ------------------------------------------------------------------ database (optional, --db) */
async function insertChunks(client: Client, head: string, nCols: number, data: unknown[][], tail: string) {
  const size = 500;
  for (let i = 0; i < data.length; i += size) {
    const part = data.slice(i, i + size);
    const ph = part.map((_, r) => `(${Array.from({ length: nCols }, (_, c) => `$${r * nCols + c + 1}`).join(",")})`).join(",");
    await client.query(`${head} ${ph} ${tail}`, part.flat());
  }
}

export async function writeDb(rows: Row[], logs: LogRow[], url: string): Promise<void> {
  const { Client: PgClient } = await import("pg");
  const client = new PgClient({
    connectionString: url,
    ssl: /supabase|pooler/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await insertChunks(
      client,
      "INSERT INTO contract_spec (symbol, trading_unit_g, quote_unit_g, purity, expiry_window_start, expiry_window_end) VALUES",
      6,
      Object.entries(SPECS).map(([s, v]) => [s, ...v]),
      "ON CONFLICT (symbol) DO NOTHING",
    );
    if (rows.length) {
      const first = new Map<string, { symbol: string; expiry: string; first: string }>();
      for (const r of rows) {
        const k = `${r.symbol}|${r.expiry_date}`;
        const f = first.get(k);
        if (!f || r.trade_date < f.first) first.set(k, { symbol: r.symbol, expiry: r.expiry_date, first: r.trade_date });
      }
      // assumption: last trading day = expiry date. Refine from the MCX contract specification.
      await insertChunks(
        client,
        "INSERT INTO contract (symbol, expiry_date, listing_date, last_trade_date) VALUES",
        4,
        [...first.values()].map((f) => [f.symbol, f.expiry, f.first, f.expiry]),
        "ON CONFLICT (symbol, expiry_date) DO UPDATE SET listing_date = LEAST(contract.listing_date, EXCLUDED.listing_date)",
      );
      const res = await client.query<{ contract_id: number; symbol: string; expiry_date: string }>(
        "SELECT contract_id, symbol, expiry_date::text AS expiry_date FROM contract",
      );
      const ids = new Map(res.rows.map((r) => [`${r.symbol}|${r.expiry_date}`, r.contract_id]));
      await insertChunks(
        client,
        "INSERT INTO daily_price (contract_id, trade_date, open, high, low, close, volume, open_interest) VALUES",
        8,
        rows.map((r) => [ids.get(`${r.symbol}|${r.expiry_date}`), r.trade_date, r.open, r.high, r.low, r.close, r.volume, r.open_interest]),
        `ON CONFLICT (contract_id, trade_date) DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high,
         low = EXCLUDED.low, close = EXCLUDED.close, volume = EXCLUDED.volume, open_interest = EXCLUDED.open_interest`,
      );
    }
    if (logs.length) {
      await insertChunks(
        client,
        "INSERT INTO data_quality_log (requested_date, returned_date, status, reason) VALUES",
        4,
        logs.map((l) => [l.requested_date, l.returned_date || null, l.status, l.reason]),
        "ON CONFLICT (requested_date) DO UPDATE SET returned_date = EXCLUDED.returned_date, status = EXCLUDED.status, reason = EXCLUDED.reason",
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

/* ------------------------------------------------------------------ command line */
type Args = {
  days?: number; start?: string; end?: string; backfillFrom?: string; fromFile?: string; date?: string;
  csvOut?: string; logOut?: string; db: boolean; force: boolean; delay: number;
};

export function parseArgs(argv: string[]): Args {
  const a: Args = { db: false, force: false, delay: 1200 };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${f} needs a value`);
      return v;
    };
    if (f === "--days") a.days = Number(val());
    else if (f === "--start") a.start = val();
    else if (f === "--end") a.end = val();
    else if (f === "--backfill-from") a.backfillFrom = val();
    else if (f === "--from-file") a.fromFile = val();
    else if (f === "--date") a.date = val();
    else if (f === "--csv-out") a.csvOut = val();
    else if (f === "--log-out") a.logOut = val();
    else if (f === "--delay") a.delay = Number(val());
    else if (f === "--db") a.db = true;
    else if (f === "--force") a.force = true;
    else throw new Error(`Unknown option: ${f}`);
  }
  return a;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const a = parseArgs(argv);
  const root = process.env.GOLDLENS_ROOT ? path.resolve(process.env.GOLDLENS_ROOT) : path.resolve(process.cwd(), "..");
  const csvOut = a.csvOut ? path.resolve(a.csvOut) : path.join(root, "data", "processed", "gold_futures.csv");
  const logOut = a.logOut ? path.resolve(a.logOut) : path.join(root, "data", "processed", "data_quality_log.csv");
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (a.db && !dbUrl) throw new Error("Set DATABASE_URL in .env.local to use --db");

  const rows: Row[] = [];
  const logs: LogRow[] = [];
  let saved = 0;
  const flush = async () => {
    if (rows.length) saved = await mergeRows(csvOut, rows);
    if (logs.length) await mergeLog(logOut, logs);
    if (a.db) await writeDb(rows, logs, dbUrl);
    rows.length = 0;
    logs.length = 0;
  };
  const show = (l: LogRow, n: number) =>
    console.log(`${l.requested_date}  ${l.status.padEnd(13)} ${String(n).padStart(3)} rows  ${l.reason}`);

  if (a.fromFile) {
    if (!a.date) throw new Error("--from-file needs --date YYYY-MM-DD");
    const d = parseDate(a.date);
    if (!d) throw new Error(`Could not read --date ${a.date}`);
    const text = await fs.readFile(a.fromFile, "utf8");
    const r = clean(parseCsv(text), d);
    show(r.log, r.rows.length);
    rows.push(...r.rows);
    logs.push(r.log);
    await flush();
    console.log(`${csvOut}: ${saved} rows total`);
    return;
  }

  const today = todayIso();
  const end = a.end ? parseDate(a.end) ?? today : today;
  const start = a.backfillFrom
    ? parseDate(a.backfillFrom)
    : a.start
      ? parseDate(a.start)
      : addDays(end, -((a.days ?? 3) - 1));
  if (!start) throw new Error("Could not read the start date");
  const handled = a.backfillFrom && !a.force ? await readLog(logOut) : new Map<string, LogRow>();

  let consecutiveErrors = 0;
  let sinceFlush = 0;
  let fetched = 0;
  for (let d = start; d <= end && d <= today; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    const prev = handled.get(d);
    if (prev && HANDLED.includes(prev.status)) continue; // backfill resumes where it stopped
    const raw = await fetchDay(d);
    const r = clean(raw, d);
    if (r.log.status === "no_data" && lastFetchError) {
      r.log.status = "fetch_error";
      r.log.reason = lastFetchError.slice(0, 300);
    }
    show(r.log, r.rows.length);
    rows.push(...r.rows);
    logs.push(r.log);
    fetched += 1;
    consecutiveErrors = r.log.status === "fetch_error" ? consecutiveErrors + 1 : 0;
    if (++sinceFlush >= 20) {
      await flush();
      sinceFlush = 0;
    }
    if (consecutiveErrors >= 5) {
      console.log("\nStopping: 5 downloads in a row failed. Fix the problem and run again; it resumes from here.");
      break;
    }
    await sleep(a.delay); // be polite to the MCX site
  }
  await flush();
  if (fetched === 0) console.log("Nothing to fetch: every day in this range is already handled (use --force to redo).");
  else console.log(`\nDone. ${fetched} day(s) checked.${saved ? ` ${csvOut}: ${saved} rows total.` : ""}`);
  if (logs.length === 0 && consecutiveErrors >= 5)
    console.log("If every download fails, download the Bhavcopy by hand and use: npm run ingest:file -- file.csv --date YYYY-MM-DD");
}

if (path.basename(process.argv[1] ?? "").startsWith("ingest")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
