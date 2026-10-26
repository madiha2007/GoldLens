"""
GoldLens — Expiry pairing & carry-gap adjustment (Piyush Patil).

The four MCX gold futures expire in different windows:
  • GOLDM:  3rd–5th of the month
  • Others: 27th–31st of the month

A naïve "same month" pairing would mix expiries that are 22–28 days apart.
That gap embeds a *carry cost* (storage + interest) that is NOT a real spread
signal — it is a mechanical artefact.

This module:
  1. Enumerates every cross-symbol contract pair that shares (roughly) the
     same economic expiry month.
  2. Computes the ``carry_gap_days`` for each pair.
  3. Adjusts the normalized-price spread by the estimated carry for that gap
     so the downstream z-score reflects genuine curve movement, not a constant
     cost-of-carry tilt.

Carry estimation
────────────────
We estimate daily carry as:

    carry_per_day = price × annualized_carry_rate / 365

The ``annualized_carry_rate`` is configurable (default 6 % — a rough blend
of repo + storage for Indian gold).  When the absolute carry gap is ≤ 2 days
no adjustment is made (same economic expiry).
"""

from __future__ import annotations

from itertools import combinations
from typing import List, Tuple

import numpy as np
import pandas as pd

from .contract_specs import SPECS


# ── default carry model ──────────────────────────────────────────────────────
DEFAULT_ANNUAL_CARRY_RATE: float = 0.06  # 6 % per annum


def _expiry_month_key(expiry_date: pd.Timestamp, symbol: str) -> Tuple[int, int]:
    """Return (year, month) that two contracts must share to be paired.

    GOLDM expires on the 3rd–5th, so its economic month is the *same*
    calendar month.  The others expire on the 27th–31st, also the same
    calendar month.  So we simply use (year, month) as the key.
    """
    return (expiry_date.year, expiry_date.month)


def pair_contracts(
    contracts: pd.DataFrame,
) -> pd.DataFrame:
    """Build a DataFrame of all pairwise contract combinations.

    Parameters
    ----------
    contracts : DataFrame
        Must contain ``contract_id``, ``symbol``, ``expiry_date``.

    Returns
    -------
    DataFrame with columns:
        contract_a_id, contract_b_id, symbol_a, symbol_b,
        expiry_a, expiry_b, expiry_month, carry_gap_days
    ``contract_a_id < contract_b_id`` is enforced (matches schema CHECK).
    """
    contracts = contracts.copy()
    contracts["expiry_date"] = pd.to_datetime(contracts["expiry_date"])
    contracts["_ym"] = contracts.apply(
        lambda r: _expiry_month_key(r["expiry_date"], r["symbol"]), axis=1
    )

    pairs: List[dict] = []
    for ym, group in contracts.groupby("_ym"):
        for a, b in combinations(group.itertuples(), 2):
            # Enforce a < b for the CHECK constraint
            if a.contract_id > b.contract_id:
                a, b = b, a
            gap = abs((a.expiry_date - b.expiry_date).days)
            pairs.append(
                {
                    "contract_a_id": a.contract_id,
                    "contract_b_id": b.contract_id,
                    "symbol_a": a.symbol,
                    "symbol_b": b.symbol,
                    "expiry_a": a.expiry_date,
                    "expiry_b": b.expiry_date,
                    "expiry_month": f"{ym[0]}-{ym[1]:02d}",
                    "carry_gap_days": gap,
                }
            )

    return pd.DataFrame(pairs)


def carry_adjustment(
    price: float,
    gap_days: int,
    annual_rate: float = DEFAULT_ANNUAL_CARRY_RATE,
    min_gap: int = 2,
) -> float:
    """Estimated carry cost for *gap_days* at the given annualised rate.

    Returns 0 if ``abs(gap_days) <= min_gap`` (same economic expiry).
    """
    if abs(gap_days) <= min_gap:
        return 0.0
    return price * annual_rate * gap_days / 365.0


def adjust_spread_for_carry(
    spread: float,
    price_a: float,
    gap_days: int,
    annual_rate: float = DEFAULT_ANNUAL_CARRY_RATE,
    min_gap: int = 2,
) -> float:
    """Subtract the carry component from a raw spread.

    The sign convention:  spread = price_a − price_b.
    If A expires *later* than B by ``gap_days``, A should be higher by the
    carry amount.  We remove that expected premium so the residual reflects
    genuine curve changes only.
    """
    return spread - carry_adjustment(price_a, gap_days, annual_rate, min_gap)
