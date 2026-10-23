import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./goldlens.css";
import { Header, Sidebar } from "../components/ui";
import { loadGoldLensData } from "../lib/data";
import { latestTradeDate } from "../lib/utils";

export const metadata: Metadata = {
  title: "GoldLens",
  description: "MCX gold futures intelligence",
};

export const dynamic = "force-dynamic"; // always re-read the CSV/JSON files

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { contracts } = await loadGoldLensData();
  const latest = latestTradeDate(contracts);

  return (
    <html lang="en">
      <body>
        <div className="gl-shell">
          <Sidebar />
          <div className="gl-main">
            <Header latestDate={latest} hasData={contracts.length > 0} />
            <main className="gl-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}