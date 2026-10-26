"""
GoldLens — Price normalizer (Piyush Patil).

Converts raw settlement/close prices for all four gold contracts to a common
unit: **₹ per 10 g at 999 fine**.

Conversion factors
──────────────────
  GOLDTEN:    already ₹/10 g @ 999  →  ×1
  GOLDGUINEA: ₹/8 g @ 999           →  ×(10/8)
  GOLDPETAL:  ₹/1 g @ 999           →  ×10
  GOLDM:      ₹/10 g @ 995          →  ×(999/995)

The function operates on a DataFrame so it can be used in both the DuckDB
pipeline and standalone CSV workflows.
"""

from __future__ import annotations

import pandas as pd

from .contract_specs import NORM_FACTOR


def normalize_prices(df: pd.DataFrame) -> pd.DataFrame:
    """Add a ``price_per_10g_999`` column to *df*.

    Parameters
    ----------
    df : DataFrame
        Must contain at least ``symbol`` and ``close`` columns.
        The ``close`` column holds the raw exchange settlement price.

    Returns
    -------
    DataFrame
        Same frame with a new ``price_per_10g_999`` float column.
        Rows whose symbol has no known factor are set to NaN.
    """
    df = df.copy()
    df["price_per_10g_999"] = df.apply(
        lambda r: r["close"] * NORM_FACTOR.get(r["symbol"], float("nan")),
        axis=1,
    )
    return df
