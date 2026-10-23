import { ContractExplorer } from "../../components/contract-explorer";
import { EmptyState } from "../../components/ui";
import { loadGoldLensData } from "../../lib/data";
import { latestTradeDate } from "../../lib/utils";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  const { contracts, contractsError } = await loadGoldLensData();
  const latest = latestTradeDate(contracts);

  if (!latest) {
    return (
      <EmptyState title="No contract data available">
        {contractsError ?? "The CSV contains no valid rows."}
      </EmptyState>
    );
  }
  return <ContractExplorer rows={contracts} latestDate={latest} />;
}