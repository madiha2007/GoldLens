# GoldLens

**MCX Gold Contract Relative-Value Intelligence**

GoldLens is a Python-based research project that compares MCX gold contracts by normalizing their prices to a common unit: ₹ per 10 grams at 999 purity.

## Objectives

- Normalize GOLDM, GOLDTEN, GOLDGUINEA and GOLDPETAL prices.
- Identify unusual relative-price differences.
- Account for contract expiry, liquidity and trading costs.
- Validate strategies using walk-forward backtesting.
- Display charts and alerts through a Streamlit dashboard.

## Tech Stack

- Python
- Pandas, NumPy and SciPy
- Streamlit and Plotly
- DuckDB and Parquet
- Pytest

## Setup

```bash
python -m venv .venv
```

Activate the environment on Windows:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

## Run Tests

```bash
python -m pytest
```

## Project Status

Initial project setup. Data ingestion, normalization, signal generation, backtesting and dashboard development will be implemented in stages.

## Disclaimer

GoldLens is a research and analytics project, not a guarantee of profitable trading or financial advice.
