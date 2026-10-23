import { Callout, EmptyState, Panel, StatusPill } from "../../components/ui";
import { loadGoldLensData } from "../../lib/data";
import { ALERT_RULES, buildAlerts, fmtDate, latestTradeDate } from "../../lib/utils";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const { contracts, report } = await loadGoldLensData();
  const latest = latestTradeDate(contracts);
  const latestRows = latest ? contracts.filter((r) => r.tradeDate === latest) : [];
  const alerts = buildAlerts(latestRows, latest, report);

  return (
    <div className="stack">
      <Callout>
        These are plain threshold checks on the latest trading date. They are not statistical or model-based
        detection. Price-difference alerts will be enabled once the analysis engine exists.
      </Callout>

      <Panel title="Alert rules" subtitle="Exactly what is checked, and what is not built yet.">
        <div className="rule-grid">
          {ALERT_RULES.map((r) => (
            <div className="rule" key={r.id}>
              <div className="rule-head">
                <h3>{r.title}</h3>
                <StatusPill tone={r.status === "active" ? "pos" : "neutral"}>
                  {r.status === "active" ? "Active" : "Not implemented"}
                </StatusPill>
              </div>
              <p>{r.description}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Current alerts"
        subtitle={latest ? `Checked against records for ${fmtDate(latest)}` : undefined}
        right={alerts.length > 0 ? <StatusPill tone="warn">{alerts.length} found</StatusPill> : undefined}
      >
        {!latest ? (
          <EmptyState title="Alerts unavailable">No contract data is loaded, so no rules could be checked.</EmptyState>
        ) : alerts.length === 0 ? (
          <EmptyState title="No alerts triggered">
            None of the active rules matched the latest records. Alert detection will expand after the analysis engine
            is implemented.
          </EmptyState>
        ) : (
          <ul className="alert-list">
            {alerts.map((a) => (
              <li key={a.id} className={`alert ${a.severity}`}>
                <div>
                  <strong>{a.symbol}</strong>
                  {a.expiryDate ? <span className="muted"> · expiry {fmtDate(a.expiryDate)}</span> : null}
                  <p>{a.message}</p>
                </div>
                <StatusPill tone={a.severity === "warning" ? "warn" : "neutral"}>
                  {ALERT_RULES.find((r) => r.id === a.ruleId)?.title ?? a.ruleId}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}