"""
GoldLens — Signal generator (Piyush Patil).

**Entry point**: ``generate_signals()`` returns a daily table of normalised
prices, spreads, rolling z-scores, liquidity flags, cost checks and final
alert flags — with **no look-ahead**.

Pipeline
────────
1. Normalize all four contracts to ₹/10 g @ 999 purity.
2. Flag thin (illiquid) days per contract.
3. Pair contracts by expiry month; compute carry-gap days.
4. For each pair on each trade date:
   a. Compute the raw spread.
   b. Adjust for carry gap.
   c. Decompose into roll-down vs genuine using the daily term-structure fit.
   d. Compute a rolling z-score on the *genuine* spread using ONLY data
      up to day *t* (expanding or rolling window, never future data).
5. Apply alert rules — a signal only fires if ALL three gates pass:
   • |z-score| ≥ threshold
   • Both legs are liquid (neither is a thin day)
   • The spread exceeds the estimated round-trip cost

Usage
─────
  # standalone — reads from / writes to DuckDB
  python -m signals.generate --db goldlens.duckdb --run-id 1

  # library — returns a DataFrame
  from signals.generate import generate_signals
  table = generate_signals(con)
"""

from __future__ import annotations

import argparse
from itertools import combinations
from typing import Optional

import duckdb
import numpy as np
import pandas as pd

from .contract_specs import NORM_FACTOR, SPECS
from .normalizer import normalize_prices
from .liquidity import flag_thin_days
from .pairing import carry_adjustment, DEFAULT_ANNUAL_CARRY_RATE
from .term_structure import fit_daily_curve, decompose_spread


# ── configurable thresholds ──────────────────────────────────────────────────
DEFAULT_Z_THRESHOLD: float = 2.0
DEFAULT_ROLLING_WINDOW: int = 20
DEFAULT_ROLLING_MIN_PERIODS: int = 15
DEFAULT_COST_BPS: float = 8.0  # round-trip cost estimate in basis points


def _load_data(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Pull daily_price + contract tables into one DataFrame."""
    return con.execute("""
        SELECT
            d.price_id,
            d.contract_id,
            c.symbol,
            c.expiry_date,
            d.trade_date,
            d.open,
            d.high,
            d.low,
            d.close,
            d.volume,
            d.open_interest
        FROM daily_price d
        JOIN contract c ON c.contract_id = d.contract_id
        ORDER BY d.trade_date, c.symbol, c.expiry_date
    """).df()


def _nearest_contract_per_symbol(df: pd.DataFrame) -> pd.DataFrame:
    """For each (trade_date, symbol) keep only the nearest-expiry contract
    that has not yet expired (expiry_date >= trade_date)."""
    df = df.copy()
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    df["expiry_date"] = pd.to_datetime(df["expiry_date"])
    active = df[df["expiry_date"] >= df["trade_date"]].copy()
    active = active.sort_values("expiry_date")
    return active.groupby(["trade_date", "symbol"]).first().reset_index()


def generate_signals(
    con: duckdb.DuckDBPyConnection,
    *,
    z_threshold: float = DEFAULT_Z_THRESHOLD,
    rolling_window: int = DEFAULT_ROLLING_WINDOW,
    rolling_min_periods: int = DEFAULT_ROLLING_MIN_PERIODS,
    cost_bps: float = DEFAULT_COST_BPS,
    annual_carry_rate: float = DEFAULT_ANNUAL_CARRY_RATE,
    strategy_version: str = "patil-v1",
) -> pd.DataFrame:
    """Generate the full daily signal table.  **No look-ahead.**

    Parameters
    ----------
    con : open DuckDB connection with populated ``daily_price`` and
          ``contract`` tables.

    Returns
    -------
    DataFrame with one row per (trade_date, pair) containing:
        trade_date, contract_a_id, contract_b_id, symbol_a, symbol_b,
        price_a_norm, price_b_norm, carry_gap_days,
        raw_spread, carry_adj_spread, rolldown, genuine_spread,
        z_score, thin_a, thin_b, liquidity_ok, cost_ok, alert_raised,
        strategy_version
    """
    # ── step 1: load & normalize ─────────────────────────────────────────
    raw = _load_data(con)
    if raw.empty:
        return pd.DataFrame()

    raw = normalize_prices(raw)

    # ── step 2: liquidity flags ──────────────────────────────────────────
    raw = flag_thin_days(raw)

    # ── step 3: nearest contract per symbol ──────────────────────────────
    near = _nearest_contract_per_symbol(raw)

    # ── step 4: term-structure fit (one per trade_date) ──────────────────
    curve = fit_daily_curve(raw)

    # ── step 5: build all cross-symbol pairs per trade_date ──────────────
    symbols = sorted(SPECS.keys())
    records = []

    for td, day_grp in near.groupby("trade_date"):
        day_map = {r.symbol: r for r in day_grp.itertuples()}
        slope = curve.loc[td, "slope"] if td in curve.index else np.nan

        for s1, s2 in combinations(symbols, 2):
            if s1 not in day_map or s2 not in day_map:
                continue
            a, b = day_map[s1], day_map[s2]

            # Enforce contract_a_id < contract_b_id for the DB CHECK
            if a.contract_id > b.contract_id:
                a, b = b, a
                swapped = True
            else:
                swapped = False

            pa = a.price_per_10g_999
            pb = b.price_per_10g_999
            ea = a.expiry_date
            eb = b.expiry_date
            gap = abs((ea - eb).days)

            raw_spread = pa - pb
            carry_adj = carry_adjustment(pa, gap, annual_carry_rate)
            carry_adj_spread = raw_spread - carry_adj

            # Roll-down decomposition
            dte_a = (ea - td).days
            dte_b = (eb - td).days
            if np.isfinite(slope):
                dec = decompose_spread(pa, pb, dte_a, dte_b, slope)
                rolldown = dec["rolldown"]
                genuine = dec["genuine_spread"]
            else:
                rolldown = np.nan
                genuine = carry_adj_spread  # fallback

            records.append({
                "trade_date": td,
                "contract_a_id": int(a.contract_id),
                "contract_b_id": int(b.contract_id),
                "symbol_a": a.symbol if not swapped else b.symbol,
                "symbol_b": b.symbol if not swapped else a.symbol,
                "price_a_norm": pa,
                "price_b_norm": pb,
                "expiry_a": ea,
                "expiry_b": eb,
                "carry_gap_days": gap,
                "raw_spread": raw_spread,
                "carry_adj_spread": carry_adj_spread,
                "rolldown": rolldown,
                "genuine_spread": genuine,
                "thin_a": bool(a.thin_day),
                "thin_b": bool(b.thin_day),
            })

    if not records:
        return pd.DataFrame()

    sig = pd.DataFrame(records)
    sig["trade_date"] = pd.to_datetime(sig["trade_date"])

    # ── step 6: rolling z-score (causal — data up to day t only) ─────────
    sig = sig.sort_values(["contract_a_id", "contract_b_id", "trade_date"])
    grp = sig.groupby(["contract_a_id", "contract_b_id"])["genuine_spread"]
    sig["roll_mean"] = grp.transform(
        lambda x: x.expanding(min_periods=rolling_min_periods).mean()
        if len(x) < rolling_window
        else x.rolling(rolling_window, min_periods=rolling_min_periods).mean()
    )
    sig["roll_std"] = grp.transform(
        lambda x: x.expanding(min_periods=rolling_min_periods).std()
        if len(x) < rolling_window
        else x.rolling(rolling_window, min_periods=rolling_min_periods).std()
    )
    sig["z_score"] = (sig["genuine_spread"] - sig["roll_mean"]) / sig["roll_std"]

    # ── step 7: alert flags ──────────────────────────────────────────────
    sig["liquidity_ok"] = ~(sig["thin_a"] | sig["thin_b"])

    # Cost gate: the spread must exceed the estimated round-trip cost
    # (brokerage + slippage on both legs, both entry and exit).
    cost_threshold = sig["price_a_norm"] * cost_bps / 1e4
    sig["cost_ok"] = sig["genuine_spread"].abs() > cost_threshold

    sig["alert_raised"] = (
        (sig["z_score"].abs() >= z_threshold)
        & sig["liquidity_ok"]
        & sig["cost_ok"]
    )
    sig["strategy_version"] = strategy_version

    # ── step 8: build the final spread column matching the schema ────────
    sig["spread"] = sig["genuine_spread"]

    # Re-sort by date for readability
    sig = sig.sort_values("trade_date").reset_index(drop=True)

    return sig


def write_signals_to_db(
    con: duckdb.DuckDBPyConnection,
    sig: pd.DataFrame,
    run_id: int,
) -> int:
    """Persist the signal DataFrame into the ``normalized_price`` and
    ``signal`` tables, replacing any previous data for *run_id*.

    Returns the number of signal rows written.
    """
    if sig.empty:
        return 0

    # ── write normalized_price rows ──────────────────────────────────────
    # We need to update the normalized_price table with our computed values.
    # First, gather unique (price_id, price_per_10g_999, thin_day) from the
    # raw data that was used.
    raw = con.execute("""
        SELECT d.price_id, d.contract_id, d.trade_date, d.close, c.symbol,
               d.volume, d.open_interest
        FROM daily_price d
        JOIN contract c ON c.contract_id = d.contract_id
    """).df()
    from .normalizer import normalize_prices as _np
    from .liquidity import flag_thin_days as _ft
    raw = _np(raw)
    raw = _ft(raw)

    # Upsert into normalized_price
    con.execute("DELETE FROM normalized_price").fetchall()
    norm_rows = raw[["price_id", "price_per_10g_999", "thin_day"]].copy()
    con.register("_norm_tmp", norm_rows)
    con.execute("INSERT INTO normalized_price SELECT * FROM _norm_tmp").fetchall()
    con.unregister("_norm_tmp")

    # ── write signal rows ────────────────────────────────────────────────
    # Must delete dependent rows (trade_leg → trade → signal) first to
    # avoid foreign-key constraint violations.
    con.execute(
        "DELETE FROM trade_leg WHERE trade_id IN "
        "(SELECT trade_id FROM trade WHERE run_id = ?)", [run_id]
    ).fetchall()
    con.execute("DELETE FROM trade WHERE run_id = ?", [run_id]).fetchall()
    con.execute("DELETE FROM signal WHERE run_id = ?", [run_id]).fetchall()

    # Auto-increment signal_id
    max_id = con.execute(
        "SELECT coalesce(max(signal_id), 0) FROM signal"
    ).fetchall()[0][0]

    out = sig[["trade_date", "contract_a_id", "contract_b_id",
               "carry_gap_days", "spread", "z_score",
               "liquidity_ok", "cost_ok", "alert_raised",
               "strategy_version"]].copy()
    out = out.dropna(subset=["z_score"])
    out.insert(0, "signal_id", range(max_id + 1, max_id + 1 + len(out)))
    out.insert(1, "run_id", run_id)

    # Cast types for DuckDB
    out["trade_date"] = pd.to_datetime(out["trade_date"]).dt.date
    out["contract_a_id"] = out["contract_a_id"].astype(int)
    out["contract_b_id"] = out["contract_b_id"].astype(int)
    out["carry_gap_days"] = out["carry_gap_days"].astype(int)
    out["liquidity_ok"] = out["liquidity_ok"].astype(bool)
    out["cost_ok"] = out["cost_ok"].astype(bool)
    out["alert_raised"] = out["alert_raised"].astype(bool)

    con.register("_sig_tmp", out)
    con.execute("INSERT INTO signal SELECT * FROM _sig_tmp").fetchall()
    con.unregister("_sig_tmp")

    return len(out)


# ── CLI entry point ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate GoldLens spread signals."
    )
    parser.add_argument("--db", default="goldlens.duckdb",
                        help="Path to the DuckDB file.")
    parser.add_argument("--run-id", type=int, default=1,
                        help="backtest_run.run_id to associate signals with.")
    parser.add_argument("--z-threshold", type=float,
                        default=DEFAULT_Z_THRESHOLD)
    parser.add_argument("--window", type=int, default=DEFAULT_ROLLING_WINDOW)
    parser.add_argument("--cost-bps", type=float, default=DEFAULT_COST_BPS)
    parser.add_argument("--carry-rate", type=float,
                        default=DEFAULT_ANNUAL_CARRY_RATE)
    parser.add_argument("--version", default="patil-v1",
                        help="Strategy version string.")

    args = parser.parse_args()
    con = duckdb.connect(args.db)

    print(f"Generating signals from {args.db} ...")
    sig = generate_signals(
        con,
        z_threshold=args.z_threshold,
        rolling_window=args.window,
        cost_bps=args.cost_bps,
        annual_carry_rate=args.carry_rate,
        strategy_version=args.version,
    )
    n_alerts = int(sig["alert_raised"].sum()) if not sig.empty else 0
    print(f"  {len(sig)} signal rows, {n_alerts} alerts raised.")

    n = write_signals_to_db(con, sig, args.run_id)
    print(f"  Wrote {n} rows to signal table (run_id={args.run_id}).")
    con.close()


if __name__ == "__main__":
    main()
