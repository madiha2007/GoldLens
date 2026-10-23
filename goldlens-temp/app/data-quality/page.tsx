import { Callout, EmptyState, Panel, StatusPill, SummaryCard } from "../../components/ui";
import { loadGoldLensData } from "../../lib/data";
import { fmtNum } from "../../lib/utils";

export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  const { report, reportError, contracts } = await loadGoldLensData();

  if (!report) {
    return (
      <EmptyState title="Data-quality report not available">
        {reportError ?? "reports/data_quality_report.json could not be loaded."} Re-run the data pipeline to generate it.
      </EmptyState>
    );
  }

  const files = report.files ?? [];
  const skipped = files.filter((f) => f.status !== "processed");
  const mismatched = files.filter((f) => f.requested_date && f.returned_date && f.requested_date !== f.returned_date);
  const missingSymbols = report.missing_contract_symbols ?? [];
  const csvMismatch = report.clean_rows !== undefined && report.clean_rows !== contracts.length;

  const hasWarnings =
    (report.files_skipped ?? 0) > 0 || skipped.length > 0 || mismatched.length > 0 || missingSymbols.length > 0 || csvMismatch;

  return (
    <div className="stack">
      {hasWarnings ? (
        <Panel title="Warnings">
          <ul className="warn-list">
            {skipped.map((f) => (
              <li key={`s-${f.file}`}>
                <StatusPill tone="warn">Skipped</StatusPill> {f.file}
                {f.reason ? ` — ${f.reason}` : ""}
              </li>
            ))}
            {mismatched.map((f) => (
              <li key={`m-${f.file}`}>
                <StatusPill tone="warn">Date mismatch</StatusPill> {f.file}: requested {f.requested_date}, returned{" "}
                {f.returned_date}
              </li>
            ))}
            {missingSymbols.length > 0 ? (
              <li>
                <StatusPill tone="warn">Missing symbols</StatusPill> {missingSymbols.join(", ")}
              </li>
            ) : null}
            {csvMismatch ? (
              <li>
                <StatusPill tone="warn">Row count</StatusPill> Report says {report.clean_rows} clean rows, but the CSV
                loaded {contracts.length} valid rows.
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : (
        <Callout>No skipped files, date mismatches or missing symbols were reported.</Callout>
      )}

      <div className="cards">
        <SummaryCard label="Files discovered" value={fmtNum(report.files_discovered)} />
        <SummaryCard label="Files processed" value={fmtNum(report.files_processed)} gold />
        <SummaryCard label="Files skipped" value={fmtNum(report.files_skipped)} hint={(report.files_skipped ?? 0) > 0 ? "needs attention" : undefined} />
        <SummaryCard label="Clean rows" value={fmtNum(report.clean_rows)} hint={report.symbols_found ? `${report.symbols_found.length} symbols found` : undefined} />
        <SummaryCard label="Zero-volume rows" value={fmtNum(report.zero_volume_rows)} hint={report.volume_unit ? `volume unit: ${report.volume_unit}` : undefined} />
        <SummaryCard label="Duplicate rows removed" value={fmtNum(report.duplicate_key_rows_removed)} />
        <SummaryCard label="Missing contract symbols" value={String(missingSymbols.length)} hint={missingSymbols.length ? missingSymbols.join(", ") : "none"} />
      </div>

      <Panel title="Per-file processing" subtitle="Requested date versus the date the source file returned">
        {files.length === 0 ? (
          <EmptyState title="No per-file details in the report" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Returned</th>
                  <th className="num">Source rows</th>
                  <th className="num">Gold futures rows</th>
                  <th className="num">Rows kept</th>
                  <th className="num">Invalid expiry</th>
                  <th className="num">Zero volume</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const mismatch = !!f.requested_date && !!f.returned_date && f.requested_date !== f.returned_date;
                  return (
                    <tr key={f.file}>
                      <td className="sym">
                        {f.file}
                        {f.reason ? <div className="muted small">{f.reason}</div> : null}
                      </td>
                      <td>
                        <StatusPill tone={f.status === "processed" ? "pos" : "warn"}>{f.status}</StatusPill>
                      </td>
                      <td>{f.requested_date ?? "—"}</td>
                      <td>
                        {f.returned_date ?? "—"} {mismatch ? <StatusPill tone="warn">mismatch</StatusPill> : null}
                      </td>
                      <td className="num">{fmtNum(f.source_rows)}</td>
                      <td className="num">{fmtNum(f.target_futures_rows)}</td>
                      <td className="num">{fmtNum(f.rows_kept)}</td>
                      <td className="num">{fmtNum(f.invalid_expiry_rows)}</td>
                      <td className="num">{fmtNum(f.zero_volume_rows)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}