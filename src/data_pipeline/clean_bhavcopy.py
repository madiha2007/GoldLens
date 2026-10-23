
from pathlib import Path
from datetime import datetime
import json
import re
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
REPORT_DIR = PROJECT_ROOT / "reports"

TARGET_SYMBOLS = {
    "GOLD", "GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL"
}

OUTPUT_COLUMNS = [
    "symbol", "trade_date", "expiry_date",
    "open", "high", "low", "close", "volume", "open_interest"
]

PRICE_COLUMNS = ["open", "high", "low", "close"]

def read_bhavcopy(file_path):
    """Read the HTML table returned with an .xls filename."""
    tables = pd.read_html(file_path, flavor="lxml")

    for table in tables:
        table.columns = [str(c).strip() for c in table.columns]

        required = {
            "Date", "Instrument Name", "Symbol", "Expiry Date",
            "Open", "High", "Low", "Close",
            "Volume(Lots)", "Open Interest(Lots)"
        }

        if required.issubset(table.columns):
            return table

    raise ValueError("Expected Bhavcopy columns were not found.")


def expected_date_from_filename(file_path):
    """
    Extract DDMMYYYY from filenames such as:
    BhavCopyDateWise_20102026.xls
    """
    match = re.search(r"(\d{2})(\d{2})(\d{4})", file_path.stem)

    if not match:
        return None

    date_text = "".join(match.groups())

    try:
        return pd.Timestamp(datetime.strptime(date_text, "%d%m%Y"))
    except ValueError:
        return None


def process_file(file_path):
    """Validate one file and return its cleaned rows and log entry."""
    log = {
        "file": file_path.name,
        "status": "skipped",
        "reason": "",
        "rows_kept": 0
    }

    try:
        df = read_bhavcopy(file_path)

        # Determine the date expected from the filename.
        expected_date = expected_date_from_filename(file_path)

        if expected_date is None:
            log["reason"] = (
                "Could not determine requested date from filename."
            )
            return None, log

        # Parse every trading date returned by the source.
        returned_dates = pd.to_datetime(
            df["Date"], dayfirst=True, errors="coerce"
        ).dt.normalize()

        actual_dates = set(returned_dates.dropna().unique())

        if returned_dates.isna().any():
            log["reason"] = "One or more source dates are invalid."
            return None, log

        if actual_dates != {expected_date.to_datetime64()}:
            log["reason"] = (
                f"Date mismatch: expected {expected_date:%d/%m/%Y}; "
                f"source returned "
                f"{', '.join(pd.Timestamp(d).strftime('%d/%m/%Y') for d in sorted(actual_dates))}"
            )
            return None, log

        # Filter to target commodity futures only.
        df["Symbol"] = (
            df["Symbol"].astype(str).str.strip().str.upper()
        )
        df["Instrument Name"] = (
            df["Instrument Name"].astype(str).str.strip().str.upper()
        )

        futures = df[
            df["Instrument Name"].eq("FUTCOM")
            & df["Symbol"].isin(TARGET_SYMBOLS)
        ].copy()

        futures["trade_date"] = returned_dates.loc[futures.index]

        futures["expiry_date"] = pd.to_datetime(
            futures["Expiry Date"].astype(str).str.strip(),
            format="%d%b%Y",
            errors="coerce"
        )

        invalid_expiries = int(futures["expiry_date"].isna().sum())
        futures = futures.dropna(subset=["expiry_date"]).copy()

        source_to_target = {
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume(Lots)": "volume",
            "Open Interest(Lots)": "open_interest"
        }

        for source, target in source_to_target.items():
            futures[target] = pd.to_numeric(
                futures[source], errors="coerce"
            )

        clean = futures[
            ["Symbol", "trade_date", "expiry_date",
             "open", "high", "low", "close", "volume", "open_interest"]
        ].rename(columns={"Symbol": "symbol"})

        clean = clean[OUTPUT_COLUMNS]

        log.update({
            "status": "processed",
            "reason": "",
            "requested_date": expected_date.strftime("%d/%m/%Y"),
            "returned_date": expected_date.strftime("%d/%m/%Y"),
            "source_rows": int(len(df)),
            "target_futures_rows": int(len(futures)),
            "invalid_expiry_rows": invalid_expiries,
            "rows_kept": int(len(clean)),
            "zero_volume_rows": int((clean["volume"] == 0).sum()),
            "missing_price_values": {
                column: int(clean[column].isna().sum())
                for column in PRICE_COLUMNS
            },
            "rows_with_missing_prices": int(
                clean[PRICE_COLUMNS].isna().any(axis=1).sum()
            ),
            "zero_volume_rows_with_missing_prices": int(
                (
                    clean["volume"].eq(0)
                    & clean[PRICE_COLUMNS].isna().any(axis=1)
                ).sum()
            )
        })

        return clean, log

    except Exception as error:
        log["reason"] = f"{type(error).__name__}: {error}"
        return None, log


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    files = sorted(
        list(RAW_DIR.glob("*.xls"))
        + list(RAW_DIR.glob("*.xlsx"))
    )

    if not files:
        raise FileNotFoundError(
            f"No Excel-style Bhavcopy files found in {RAW_DIR}"
        )

    cleaned_frames = []
    file_logs = []

    for file_path in files:
        clean, log = process_file(file_path)
        file_logs.append(log)

        if clean is not None:
            cleaned_frames.append(clean)

        print(f"{log['status'].upper()}: {file_path.name}")
        if log["reason"]:
            print(f"  Reason: {log['reason']}")

    if cleaned_frames:
        combined = pd.concat(cleaned_frames, ignore_index=True)

        duplicate_mask = combined.duplicated(
            ["symbol", "trade_date", "expiry_date"],
            keep="first"
        )
        duplicate_key_rows = int(duplicate_mask.sum())

        # Keep the first duplicate and report how many were found.
        combined = combined.drop_duplicates(
            ["symbol", "trade_date", "expiry_date"],
            keep="first"
        )

        combined = combined.sort_values(
            ["trade_date", "symbol", "expiry_date"]
        )

        output_file = PROCESSED_DIR / "gold_futures.csv"
        combined.to_csv(
            output_file, index=False, date_format="%Y-%m-%d"
        )

        symbols_found = sorted(combined["symbol"].unique().tolist())
        zero_volume_rows = int((combined["volume"] == 0).sum())

        quality_report = {
            "files_discovered": len(files),
            "files_processed": sum(
                item["status"] == "processed" for item in file_logs
            ),
            "files_skipped": sum(
                item["status"] == "skipped" for item in file_logs
            ),
            "clean_rows": len(combined),
            "symbols_found": symbols_found,
            "missing_contract_symbols": sorted(
                TARGET_SYMBOLS - set(symbols_found)
            ),
            "zero_volume_rows": zero_volume_rows,
            "duplicate_key_rows_removed": duplicate_key_rows,
            "volume_unit": "lots",
            "open_interest_unit": "lots",
            "missing_price_values_by_column": {
                column: int(combined[column].isna().sum())
                for column in PRICE_COLUMNS
            },
            "rows_with_missing_prices": int(
                combined[PRICE_COLUMNS].isna().any(axis=1).sum()
            ),
            "zero_volume_rows_with_missing_prices": int(
                (
                    combined["volume"].eq(0)
                    & combined[PRICE_COLUMNS].isna().any(axis=1)
                ).sum()
            ),
            "files": file_logs
        }

        combined.to_csv(
            output_file, index=False, date_format="%Y-%m-%d"
        )

    else:
        quality_report = {
            "files_discovered": len(files),
            "files_processed": 0,
            "files_skipped": len(files),
            "clean_rows": 0,
            "files": file_logs,
            "note": "No valid files; existing processed CSV was not changed."
        }

    report_file = REPORT_DIR / "data_quality_report.json"

    with open(report_file, "w", encoding="utf-8") as report:
        json.dump(quality_report, report, indent=2, default=str)

    print("\nPipeline summary:")
    print(json.dumps(quality_report, indent=2, default=str))


if __name__ == "__main__":
    main()
