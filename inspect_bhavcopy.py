
from pathlib import Path
import pandas as pd

raw_folder = Path("data/raw")

files = list(raw_folder.glob("*.xls")) + list(raw_folder.glob("*.xlsx"))

if not files:
    print("No Bhavcopy file found in data/raw/")
else:
    file_path = files[0]
    print("Reading:", file_path.name)

    # The downloaded .xls file contains HTML tables.
    tables = pd.read_html(file_path, flavor="lxml")

    if not tables:
        print("No tables found in the file.")
    else:
        df = None

        for table in tables:
            table.columns = [
                str(column).strip() for column in table.columns
            ]

            if "Symbol" in table.columns:
                df = table
                break

        if df is None:
            print("Could not find a table with a Symbol column.")
            print("Available table columns:")
            for table in tables:
                print(table.columns.tolist())
        else:
            print("\nColumn names:")
            print(df.columns.tolist())

            # Clean spaces around symbol names.
            df["Symbol"] = df["Symbol"].astype(str).str.strip().str.upper()

            gold_symbols = [
                "GOLD",
                "GOLDM",
                "GOLDTEN",
                "GOLDGUINEA",
                "GOLDPETAL"
            ]

            gold = df[
                df["Symbol"].isin(gold_symbols)
                & df["Instrument Name"].astype(str).str.strip().str.upper().eq("FUTCOM")
            ]

            print("\nGold-related rows:")
            print(gold.head(20).to_string(index=False))

            print("\nTotal matching rows:", len(gold))
            print("\nSymbols found:")
            print(sorted(gold["Symbol"].unique()))
