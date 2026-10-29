// SERVER-ONLY data layer.
// Reads the CSV and the quality report from a URL (Vercel Blob) when GOLD_DATA_URL /
// REPORT_DATA_URL are set, and falls back to local files for development on your PC.

import { promises as fs } from "fs";
import path from "path";
import { cache } from "react";
import type { Contract, QualityReport } from "./utils";

const ROOT = process.env.GOLDLENS_ROOT
  ? path.resolve(process.env.GOLDLENS_ROOT)
  : path.resolve(process.cwd(), "..");

const CSV_PATH = path.join(ROOT, "data", "processed", "gold_futures.csv");
const REPORT_PATH = path.join(ROOT, "reports", "data_quality_report.json");

const CSV_URL = process.env.GOLD_DATA_URL;
const REPORT_URL = process.env.REPORT_DATA_URL;

const REQUIRED = [
  "symbol",
  "trade_date",
  "expiry_date",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "open_interest",
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

type TextResult = { text: string | null; error: string | null };

// Reads from a URL if one is given, otherwise from a local file path.
async function readText(localPath: string, url?: string): Promise<TextResult> {
  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return { text: null, error: `Could not download data (HTTP ${res.status})` };
      return { text: await res.text(), error: null };
    } catch {
      return { text: null, error: "Could not download data from the configured URL" };
    }
  }
  try {
    return { text: await fs.readFile(localPath, "utf8"), error: null };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return {
      text: null,
      error: code === "ENOENT" ? `File not found: ${localPath}` : `Could not read file: ${localPath}`,
    };
  }
}

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

function num(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseContracts(text: string): { rows: Contract[]; invalid: number; error: string | null } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return { rows: [], invalid: 0, error: "The CSV file is empty." };

  const header = splitLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], invalid: 0, error: `CSV is missing expected columns: ${missing.join(", ")}` };
  }
  const col = (name: string) => header.indexOf(name);

  const rows: Contract[] = [];
  let invalid = 0;
  for (const line of lines.slice(1)) {
    const f = splitLine(line);
    const symbol = (f[col("symbol")] ?? "").trim().toUpperCase();
    const tradeDate = (f[col("trade_date")] ?? "").trim();
    const expiryDate = (f[col("expiry_date")] ?? "").trim();
    if (!symbol || !ISO.test(tradeDate) || !ISO.test(expiryDate)) {
      invalid += 1;
      continue;
    }
    rows.push({
      symbol,
      tradeDate,
      expiryDate,
      open: num(f[col("open")]),
      high: num(f[col("high")]),
      low: num(f[col("low")]),
      close: num(f[col("close")]),
      volume: num(f[col("volume")]) ?? 0,
      openInterest: num(f[col("open_interest")]) ?? 0,
    });
  }
  return { rows, invalid, error: null };
}

export type GoldLensData = {
  contracts: Contract[];
  invalidCsvRows: number;
  contractsError: string | null;
  report: QualityReport | null;
  reportError: string | null;
};

// cache() means the layout and the page share one read per request.
export const loadGoldLensData = cache(async (): Promise<GoldLensData> => {
  const [csv, json] = await Promise.all([
    readText(CSV_PATH, CSV_URL),
    readText(REPORT_PATH, REPORT_URL),
  ]);

  let contracts: Contract[] = [];
  let invalidCsvRows = 0;
  let contractsError = csv.error;
  if (csv.text !== null) {
    const parsed = parseContracts(csv.text);
    contracts = parsed.rows;
    invalidCsvRows = parsed.invalid;
    contractsError = parsed.error;
  }

  let report: QualityReport | null = null;
  let reportError = json.error;
  if (json.text !== null) {
    try {
      report = JSON.parse(json.text) as QualityReport;
    } catch {
      reportError = "Report is not valid JSON";
    }
  }

  return { contracts, invalidCsvRows, contractsError, report, reportError };
});