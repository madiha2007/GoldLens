
from pathlib import Path
import pandas as pd
import json

# Project folders
PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
REPORT_DIR = PROJECT_ROOT / "reports"

TARGET_SYMBOLS = {
    "GOLD", "GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL"
}

def read_bhavcopy(file_path):
    """Read an MCX Bhavcopy containing an HTML table."""
    tables = pd.read_html(file_path, flavor="lxml")

    for table in tables:
        table.columns = [str(c).strip() for c in table.columns]

        required = {"Date", "Instrument Name", "Symbol", "Expiry Date"}
        if required.issubset(table.columns):
            return table

    raise ValueError("Could not find the expected Bhavcopy table.")


def main():
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    files = sorted(
        list(RAW_DIR.glob("*.xls")) + list(RAW_DIR.glob("*.xlsx"))
    )

    if not files:
        raise FileNotFoundError(f"No Bhavcopy files found in {RAW_DIR}")

    # Process the first file for now.
    file_path = files[0]
    df = read_bhavcopy(file_path)

    # Filter to commodity futures and our target symbols.
    df["Symbol"] = df["Symbol"].astype(str).str.strip().str.upper()
    df["Instrument Name"] = (
        df["Instrument Name"].astype(str).str.strip().str.upper()
    )

    futures = df[
        df["Instrument Name"].eq("FUTCOM")
        & df["Symbol"].isin(TARGET_SYMBOLS)
    ].copy()

    # Parse dates from the source.
    futures["trade_date"] = pd.to_datetime(
        futures["Date"], dayfirst=True, errors="coerce"
    ).dt.normalize()

    futures["expiry_date"] = pd.to_datetime(
        futures["Expiry Date"].astype(str).str.strip(),
        format="%d%b%Y",
        errors="coerce"
    )

    # Count rows with missing or invalid dates.
    invalid_dates = int(
        (futures["trade_date"].isna() | futures["expiry_date"].isna()).sum()
    )

    futures = futures.dropna(subset=["trade_date", "expiry_date"]).copy()

    # Convert prices and quantities to numeric values.
    numeric_columns = {
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Volume(Lots)": "volume",
        "Open Interest(Lots)": "open_interest",
    }

    for source_column, target_column in numeric_columns.items():
        futures[target_column] = pd.to_numeric(
            futures[source_column], errors="coerce"
        )

    # Standard nine-column output.
    clean = futures[
        [
            "Symbol", "trade_date", "expiry_date",
            "open", "high", "low", "close", "volume", "open_interest"
        ]
    ].rename(columns={"Symbol": "symbol"})

    # Report quality issues; do not silently remove zero-volume rows.
    quality_report = {
        "source_file": file_path.name,
        "rows_read": int(len(df)),
        "target_futures_rows_before_date_validation": int(
            len(futures) + invalid_dates
        ),
        "clean_rows": int(len(clean)),
        "invalid_date_rows": invalid_dates,
        "zero_volume_rows": int((clean["volume"] == 0).sum()),
        "missing_contract_symbols": sorted(
            TARGET_SYMBOLS - set(clean["symbol"].unique())
        ),
        "symbols_found": sorted(clean["symbol"].unique().tolist()),
        "duplicate_key_rows": int(
            clean.duplicated(
                ["symbol", "trade_date", "expiry_date"]
            ).sum()
        ),
        "volume_unit": "lots",
        "open_interest_unit": "lots",
        "date_validation_note": (
            "Trade date parsed from source; requested-date validation "
            "will be added when processing a specified date."
        ),
    }

    output_file = PROCESSED_DIR / "gold_futures.csv"
    report_file = REPORT_DIR / "data_quality_report.json"

    clean.to_csv(output_file, index=False, date_format="%Y-%m-%d")

    with open(report_file, "w", encoding="utf-8") as report:
        json.dump(quality_report, report, indent=2)

    print("Pipeline completed.")
    print(f"Source: {file_path.name}")
    print(f"Clean data: {output_file}")
    print(f"Quality report: {report_file}")
    print(f"Clean rows: {len(clean)}")
    print("\nRows by symbol:")
    print(clean.groupby("symbol").size().to_string())
    print("\nQuality report:")
    print(json.dumps(quality_report, indent=2))


if __name__ == "__main__":
    main()
