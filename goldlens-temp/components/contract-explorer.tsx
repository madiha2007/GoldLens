"use client";

import { useMemo, useState } from "react";
import { Callout, EmptyState, FuturesTable, LineChart, Panel, SummaryCard } from "./ui";
import { fmtDate, fmtNum, nearestContract, type Contract } from "../lib/utils";

const CHOICES = ["GOLD", "GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL"];

export function ContractExplorer({ rows, latestDate }: { rows: Contract[]; latestDate: string }) {
  const [symbol, setSymbol] = useState(CHOICES[0]);
  const [expiry, setExpiry] = useState("all");

  const symbolRows = useMemo(() => rows.filter((r) => r.symbol === symbol), [rows, symbol]);
  const expiries = useMemo(
    () => Array.from(new Set(symbolRows.map((r) => r.expiryDate))).sort(),
    [symbolRows],
  );
  const filtered = useMemo(
    () => (expiry === "all" ? symbolRows : symbolRows.filter((r) => r.expiryDate === expiry)),
    [symbolRows, expiry],
  );

  const latestFiltered = filtered.filter((r) => r.tradeDate === latestDate);
  const totalVolume = latestFiltered.reduce((s, r) => s + r.volume, 0);
  const totalOi = latestFiltered.reduce((s, r) => s + r.openInterest, 0);
  const tradeDates = new Set(symbolRows.map((r) => r.tradeDate)).size;

  // Trend: one specific contract across trade dates (the selected expiry, or else the nearest one).
  const trendContract =
    expiry !== "all"
      ? expiry
      : nearestContract(
          symbolRows.filter((r) => r.tradeDate === latestDate),
          latestDate,
        )?.expiryDate ?? null;

  const trendPoints = useMemo(() => {
    if (!trendContract) return [];
    return symbolRows
      .filter((r) => r.expiryDate === trendContract && r.close !== null)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
      .map((r) => ({ label: fmtDate(r.tradeDate), value: r.close as number }));
  }, [symbolRows, trendContract]);

  function pickSymbol(s: string) {
    setSymbol(s);
    setExpiry("all");
  }

  return (
    <div className="stack">
      <Callout>
        Contracts are quoted in different sizes, so raw prices should not be compared across symbols. Contract-size and
        quotation normalisation will be added later. Use this page to look at one symbol at a time.
      </Callout>

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Symbol">
          {CHOICES.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={s === symbol}
              className={s === symbol ? "tab active" : "tab"}
              onClick={() => pickSymbol(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="select-wrap">
          <span>Expiry</span>
          <select className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={expiries.length === 0}>
            <option value="all">All expiries</option>
            {expiries.map((e) => (
              <option key={e} value={e}>
                {fmtDate(e)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {symbolRows.length === 0 ? (
        <Panel title={symbol}>
          <EmptyState title={`No ${symbol} records in the dataset`}>
            This symbol has no rows in the processed CSV. Check the Data Quality page for missing symbols.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="cards">
            <SummaryCard label="Contracts shown" value={String(new Set(filtered.map((r) => r.expiryDate)).size)} hint={`${symbol}, by expiry date`} gold />
            <SummaryCard label="Volume (latest date)" value={fmtNum(totalVolume)} hint="lots" />
            <SummaryCard label="Open interest (latest date)" value={fmtNum(totalOi)} hint="lots" />
            <SummaryCard label="Trading dates loaded" value={String(tradeDates)} hint={`for ${symbol}`} />
          </div>

          <Panel title={`${symbol} contract records`} subtitle="Expiry, close, volume and open interest. Click a column to sort.">
            <FuturesTable rows={filtered} searchable={false} showSymbol={false} defaultSort="expiryDate" />
          </Panel>

          <Panel
            title="Closing-price trend"
            subtitle={trendContract ? `${symbol} contract expiring ${fmtDate(trendContract)}` : undefined}
          >
            {trendPoints.length >= 2 ? (
              <LineChart points={trendPoints} />
            ) : (
              <EmptyState title="Not enough trading dates for a trend">
                {trendPoints.length === 1
                  ? `Only one trading date (${trendPoints[0].label}) is loaded for this contract. A trend needs at least two dates.`
                  : "No closing prices are available for this selection."}{" "}
                More daily Bhavcopy files need to be processed before a trend can be drawn.
              </EmptyState>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}