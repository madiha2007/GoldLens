import { Callout, EmptyState, Panel, StatusPill, SummaryCard } from "../../components/ui";
import { loadGoldLensData } from "../../lib/data";
import {
  EXPIRING_SOON_DAYS,
  daysBetween,
  expiryStatus,
  fmtDate,
  latestTradeDate,
} from "../../lib/utils";

export const dynamic = "force-dynamic";

export default async function ExpiryPage() {
  const { contracts } = await loadGoldLensData();
  const latest = latestTradeDate(contracts);

  if (!latest) {
    return <EmptyState title="No expiry data available">No contract rows are loaded.</EmptyState>;
  }

  const items = contracts
    .filter((r) => r.tradeDate === latest)
    .map((r) => {
      const daysLeft = daysBetween(latest, r.expiryDate);
      return { ...r, daysLeft, status: expiryStatus(daysLeft) };
    })
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.symbol.localeCompare(b.symbol));

  const soon = items.filter((i) => i.daysLeft !== null && i.daysLeft >= 0 && i.daysLeft <= EXPIRING_SOON_DAYS).length;
  const next = items.find((i) => i.daysLeft !== null && i.daysLeft >= 0);

  return (
    <div className="stack">
      <Callout>
        Based only on contracts present in the {fmtDate(latest)} Bhavcopy. Listing dates and full contract lifecycles
        are not in the data, so none are shown. Days until expiry are counted from that trading date, not today.
      </Callout>

      <div className="cards">
        <SummaryCard label="Contracts listed" value={String(items.length)} hint="in the latest records" gold />
        <SummaryCard label="Next expiry" value={next ? fmtDate(next.expiryDate) : "—"} hint={next ? `${next.symbol}, in ${next.daysLeft} days` : undefined} />
        <SummaryCard label={`Expiring within ${EXPIRING_SOON_DAYS} days`} value={String(soon)} hint="status rule is shown below" />
      </div>

      <Panel title="Expiry list" subtitle="Sorted by expiry date">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Expiry Date</th>
                <th className="num">Days Until Expiry</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.symbol}-${i.expiryDate}`}>
                  <td className="sym">{i.symbol}</td>
                  <td>{fmtDate(i.expiryDate)}</td>
                  <td className="num">{i.daysLeft === null ? "—" : i.daysLeft}</td>
                  <td>
                    <StatusPill tone={i.status.tone}>{i.status.label}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Status rule: Expired if the expiry is before the trading date, Expiring soon within {EXPIRING_SOON_DAYS} days,
          otherwise Active.
        </p>
      </Panel>
    </div>
  );
}