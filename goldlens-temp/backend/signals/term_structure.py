"""
GoldLens — Term-structure analysis (Piyush Patil).

Separates two effects in the gold futures curve:

1. **Mechanical roll-down** — as a contract approaches expiry its price
   converges toward spot.  This is predictable and should not trigger signals.
2. **Genuine curve changes** — shifts in the term-structure slope driven by
   supply/demand, rate expectations, or sentiment.

The approach:
  • For each trade date, fit a simple linear model: normalised price vs.
    days-to-expiry across all active contracts.  The slope is the daily
    cost-of-carry embedded in the curve.
  • On day *t* the "expected" price of contract *c* is:
        expected_c = intercept_t + slope_t × dte_c
  • The roll-down component for a spread (A − B) is:
        rolldown = slope_t × (dte_A − dte_B)
  • The "genuine" spread is raw_spread − rolldown.

Everything is computed using only data visible on day *t* (no look-ahead).
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def fit_daily_curve(
    df: pd.DataFrame,
) -> pd.DataFrame:
    """Fit a linear term-structure to each trade date.

    Parameters
    ----------
    df : DataFrame
        Must contain ``trade_date``, ``expiry_date`` (both date-like),
        and ``price_per_10g_999``.

    Returns
    -------
    DataFrame indexed by ``trade_date`` with columns:
        slope  — ₹ per 10 g per day-to-expiry (the daily carry rate implied
                 by the curve).
        intercept — estimated "spot" in ₹/10 g @ 999.
        r_squared — goodness-of-fit (used as a confidence filter).
        n_points  — number of contracts used in the fit.
    """
    df = df.copy()
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    df["expiry_date"] = pd.to_datetime(df["expiry_date"])
    df["dte"] = (df["expiry_date"] - df["trade_date"]).dt.days

    results = []
    for td, grp in df.groupby("trade_date"):
        px = grp["price_per_10g_999"].values
        dte = grp["dte"].values.astype(float)
        n = len(px)
        if n < 2:
            results.append(
                {"trade_date": td, "slope": np.nan, "intercept": np.nan,
                 "r_squared": np.nan, "n_points": n}
            )
            continue
        # Simple OLS:  price = intercept + slope * dte
        A = np.vstack([dte, np.ones(n)]).T
        sol, residuals, _, _ = np.linalg.lstsq(A, px, rcond=None)
        slope, intercept = sol
        ss_res = residuals[0] if len(residuals) > 0 else np.sum((px - A @ sol) ** 2)
        ss_tot = np.sum((px - px.mean()) ** 2)
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else np.nan
        results.append(
            {"trade_date": td, "slope": slope, "intercept": intercept,
             "r_squared": r2, "n_points": n}
        )

    return pd.DataFrame(results).set_index("trade_date")


def decompose_spread(
    price_a: float,
    price_b: float,
    dte_a: int,
    dte_b: int,
    slope: float,
) -> dict:
    """Split a raw spread into roll-down and genuine components.

    Parameters
    ----------
    price_a, price_b : normalised prices of the two legs.
    dte_a, dte_b     : days-to-expiry for each leg.
    slope            : daily carry slope from ``fit_daily_curve``.

    Returns
    -------
    dict with keys: raw_spread, rolldown, genuine_spread.
    """
    raw = price_a - price_b
    rolldown = slope * (dte_a - dte_b)
    return {
        "raw_spread": raw,
        "rolldown": rolldown,
        "genuine_spread": raw - rolldown,
    }
