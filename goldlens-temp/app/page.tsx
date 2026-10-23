import { BarList, Callout, EmptyState, FuturesTable, Panel, SummaryCard, type BarItem } from "../components/ui";
import { loadGoldLensData } from "../lib/data";
import { fmtDate, fmtNum, latestTradeDate, nearestContract, orderedSymbols } from "../lib/utils";

export const dynamic = "force-dynamic";

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

  const rows = contracts.filter((r) => r.tradeDate === latest);
  const tradeDates = new Set(contracts.map((r) => r.tradeDate)).size;
  const symbols = orderedSymbols(rows);
  const totalVolume = rows.reduce((s, r) => s + r.volume, 0);
  const zeroVolume = rows.filter((r) => r.volume === 0).length;
  const active = rows.filter((r) => r.expiryDate >= latest).length;

  const priceItems: BarItem[] = [];
  const volumeItems: BarItem[] = [];
  for (const s of symbols) {
    const symRows = rows.filter((r) => r.symbol === s);
    const near = nearestContract(symRows, latest);
    if (near && near.close !== null) {
      priceItems.push({
        label: s,
        value: near.close,
        display: fmtNum(near.close),
        note: `exp ${fmtDate(near.expiryDate)}`,
      });
    }
    const vol = symRows.reduce((sum, r) => sum + r.volume, 0);
    volumeItems.push({ label: s, value: vol, display: fmtNum(vol) });
  }

  return (
    <div className="stack">
      {tradeDates === 1 ? (
        <Callout>
          Only one trading date ({fmtDate(latest)}) is loaded, so everything below is a snapshot of that day. No
          historical trend has been established yet.
        </Callout>
      ) : null}
      {invalidCsvRows > 0 ? (
        <Callout tone="warn">{invalidCsvRows} CSV row(s) had an invalid symbol or date and were ignored.</Callout>
      ) : null}

      <div className="cards">
        <SummaryCard label="Latest Trading Date" value={fmtDate(latest)} hint={`${tradeDates} trading date${tradeDates === 1 ? "" : "s"} loaded`} gold />
        <SummaryCard label="Gold Contracts Available" value={String(rows.length)} hint={`${symbols.length} unique symbols; each expiry is one contract`} />
        <SummaryCard label="Total Trading Volume" value={fmtNum(totalVolume)} hint={`lots, all symbols, latest date. ${zeroVolume} contract${zeroVolume === 1 ? "" : "s"} with zero volume`} />
        <SummaryCard label="Active Expiry Contracts" value={String(active)} hint="expiry on or after the latest trading date" />
      </div>

      <Panel title="Gold futures comparison" subtitle={`Contracts recorded on ${fmtDate(latest)}. Click a column header to sort.`}>
        <FuturesTable rows={rows} />
      </Panel>

      <div className="chart-grid">
        <Panel title="Closing price by symbol" subtitle="Nearest-expiry contract for each symbol">
          {priceItems.length > 0 ? (
            <>
              <BarList items={priceItems} />
              <p className="note">
                Symbols are quoted in different contract sizes, so these prices are not directly comparable. Size
                normalisation comes later.
              </p>
            </>
          ) : (
            <EmptyState title="No closing prices available" />
          )}
        </Panel>
        <Panel title="Trading volume by symbol" subtitle="Total lots across all expiries, latest date">
          {totalVolume > 0 ? (
            <BarList items={volumeItems} accent="teal" />
          ) : (
            <EmptyState title="No volume recorded">Every contract has zero volume on the latest trading date.</EmptyState>
          )}
        </Panel>
      </div>
    </div>
  );
}