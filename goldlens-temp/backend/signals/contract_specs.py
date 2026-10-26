"""
GoldLens — Contract specification constants.

Central reference for the four MCX gold futures.  Every other module
(normalization, pairing, liquidity) imports from here so the numbers live
in exactly one place.
"""

from dataclasses import dataclass
from typing import Dict


@dataclass(frozen=True)
class ContractSpec:
    """Immutable specification for one MCX gold contract variant."""

    symbol: str
    trading_unit_g: int      # grams per lot
    quote_unit_g: int        # denominator the exchange quote is "per X grams"
    purity: int              # fineness in parts-per-thousand (995 or 999)
    expiry_window_start: int # earliest calendar day-of-month for expiry
    expiry_window_end: int   # latest  calendar day-of-month for expiry


# ── canonical specifications (from MCX contract notes) ───────────────────────
SPECS: Dict[str, ContractSpec] = {
    "GOLDM": ContractSpec(
        symbol="GOLDM",
        trading_unit_g=100,
        quote_unit_g=10,
        purity=995,
        expiry_window_start=3,
        expiry_window_end=5,
    ),
    "GOLDTEN": ContractSpec(
        symbol="GOLDTEN",
        trading_unit_g=10,
        quote_unit_g=10,
        purity=999,
        expiry_window_start=27,
        expiry_window_end=31,
    ),
    "GOLDGUINEA": ContractSpec(
        symbol="GOLDGUINEA",
        trading_unit_g=8,
        quote_unit_g=8,
        purity=999,
        expiry_window_start=27,
        expiry_window_end=31,
    ),
    "GOLDPETAL": ContractSpec(
        symbol="GOLDPETAL",
        trading_unit_g=1,
        quote_unit_g=1,
        purity=999,
        expiry_window_start=27,
        expiry_window_end=31,
    ),
}

# ── normalization multipliers ────────────────────────────────────────────────
# Target: ₹ per 10 g at 999 purity.
#
# GOLDTEN:    already ₹/10g at 999  →  ×1
# GOLDGUINEA: ₹/8g  at 999         →  ×(10/8)
# GOLDPETAL:  ₹/1g  at 999         →  ×10
# GOLDM:      ₹/10g at 995         →  ×(999/995)
NORM_FACTOR: Dict[str, float] = {
    "GOLDM":      999.0 / 995.0,   # purity uplift
    "GOLDTEN":    1.0,              # already in target units
    "GOLDGUINEA": 10.0 / 8.0,      # weight rescale
    "GOLDPETAL":  10.0 / 1.0,      # weight rescale
}
