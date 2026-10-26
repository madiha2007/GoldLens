"""
GoldLens — Liquidity flags (Piyush Patil).

Marks each (contract, trade_date) observation as a "thin day" when any of
the following conditions hold:

  1. **Volume below threshold**  — daily volume < ``vol_floor`` lots.
  2. **Open interest below threshold** — daily OI < ``oi_floor`` lots.
  3. **Relative-volume drop** — today's volume is below ``vol_ratio_min`` ×
     the 20-day trailing median volume for that same contract.

Thresholds are configurable; the defaults match sensible MCX gold levels.

The flag is stored as a boolean ``thin_day`` column.  Downstream the signal
generator checks ``thin_day`` on **both** legs of a pair: a signal is
liquidity-OK only if *neither* leg is thin.
"""

from __future__ import annotations

import pandas as pd


# ── default thresholds ───────────────────────────────────────────────────────
DEFAULT_VOL_FLOOR: int = 100        # lots
DEFAULT_OI_FLOOR: int = 200         # lots
DEFAULT_VOL_RATIO_MIN: float = 0.20 # 20 % of trailing median


def flag_thin_days(
    df: pd.DataFrame,
    *,
    vol_floor: int = DEFAULT_VOL_FLOOR,
    oi_floor: int = DEFAULT_OI_FLOOR,
    vol_ratio_min: float = DEFAULT_VOL_RATIO_MIN,
    trailing_window: int = 20,
) -> pd.DataFrame:
    """Add a ``thin_day`` boolean column to *df*.

    Parameters
    ----------
    df : DataFrame
        Must contain ``contract_id`` (or ``symbol`` + ``expiry_date``),
        ``trade_date``, ``volume``, ``open_interest``.

    Returns
    -------
    DataFrame
        Copy with ``thin_day`` added.
    """
    df = df.copy()
    df = df.sort_values(["contract_id", "trade_date"]).reset_index(drop=True)

    # Absolute floor checks
    low_vol = df["volume"] < vol_floor
    low_oi = df["open_interest"] < oi_floor

    # Relative-volume check: compare today's volume against the trailing
    # median for the same contract (causal — uses data up to and including t).
    trailing_med = (
        df.groupby("contract_id")["volume"]
        .transform(
            lambda s: s.rolling(trailing_window, min_periods=1).median()
        )
    )
    vol_drop = df["volume"] < (trailing_med * vol_ratio_min)

    df["thin_day"] = low_vol | low_oi | vol_drop
    return df
