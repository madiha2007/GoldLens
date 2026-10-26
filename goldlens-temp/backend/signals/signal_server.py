"""
GoldLens — Signal data API for the Next.js frontend.

A minimal HTTP server that exposes the signal engine output as JSON.
Run alongside `npm run dev` so the Next.js app can fetch signal data.

Usage:
    python signal_server.py                          # default: port 8787
    python signal_server.py --port 9000 --db path/to/goldlens.duckdb

Endpoints:
    GET /api/signals          — latest day's signal table (normalized prices,
                                spreads, z-scores, flags)
    GET /api/signals/summary  — aggregate stats for the dashboard header
    GET /api/signals/history  — all signals (for charts)
    GET /health               — liveness check
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import duckdb
import numpy as np
import pandas as pd

# Ensure the signals package is importable
HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent if (HERE.parent / "signals").is_dir() else HERE
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from signals.generate import generate_signals


class _Encoder(json.JSONEncoder):
    """Handle numpy / pandas types in JSON serialization."""
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj) if np.isfinite(obj) else None
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        if isinstance(obj, pd.Timestamp):
            return obj.isoformat()[:10]
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()[:10]
        return super().default(obj)


def _to_records(df: pd.DataFrame) -> list[dict]:
    """Convert DataFrame to list of dicts with JSON-safe types (no bare NaNs)."""
    records = []
    for _, row in df.iterrows():
        rec = {}
        for col in df.columns:
            val = row[col]
            if pd.isna(val):
                rec[col] = None
            elif isinstance(val, (pd.Timestamp,)):
                rec[col] = val.isoformat()[:10]
            elif isinstance(val, (np.integer, int)):
                rec[col] = int(val)
            elif isinstance(val, (np.floating, float)):
                rec[col] = float(val) if np.isfinite(val) else None
            elif isinstance(val, (np.bool_, bool)):
                rec[col] = bool(val)
            elif hasattr(val, 'isoformat'):
                rec[col] = str(val)
            else:
                rec[col] = val
        records.append(rec)
    return records


# Cache the signal DataFrame so we don't recompute on every request.
_cache: dict = {"sig": None, "db_path": None}


def _get_signals(db_path: str) -> pd.DataFrame:
    """Generate signals (cached)."""
    if _cache["sig"] is None or _cache["db_path"] != db_path:
        con = duckdb.connect(db_path, read_only=True)
        _cache["sig"] = generate_signals(con)
        _cache["db_path"] = db_path
        con.close()
    return _cache["sig"]


def _make_handler(db_path: str):
    """Create a request handler class bound to the given DB path."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/")
            params = parse_qs(parsed.query)

            if path == "/health":
                self._json({"status": "ok"})

            elif path == "/api/signals":
                sig = _get_signals(db_path)
                if sig.empty:
                    self._json({"signals": [], "date": None})
                    return
                # Latest day only
                latest = sig["trade_date"].max()
                day = sig[sig["trade_date"] == latest]
                cols = [
                    "trade_date", "contract_a_id", "contract_b_id",
                    "symbol_a", "symbol_b",
                    "price_a_norm", "price_b_norm",
                    "carry_gap_days", "raw_spread",
                    "genuine_spread", "rolldown",
                    "z_score", "liquidity_ok", "cost_ok",
                    "alert_raised", "thin_a", "thin_b",
                    "strategy_version",
                ]
                out_cols = [c for c in cols if c in day.columns]
                self._json({
                    "signals": _to_records(day[out_cols]),
                    "date": str(latest)[:10],
                    "total": len(day),
                    "alerts": int(day["alert_raised"].sum()),
                })

            elif path == "/api/signals/summary":
                sig = _get_signals(db_path)
                if sig.empty:
                    self._json({"total_signals": 0, "total_alerts": 0,
                                "dates": 0, "pairs": 0})
                    return
                self._json({
                    "total_signals": len(sig),
                    "total_alerts": int(sig["alert_raised"].sum()),
                    "dates": int(sig["trade_date"].nunique()),
                    "pairs": int(sig.groupby(
                        ["contract_a_id", "contract_b_id"]).ngroups),
                    "latest_date": str(sig["trade_date"].max())[:10],
                    "liquidity_pass_rate": round(
                        float(sig["liquidity_ok"].mean()) * 100, 1),
                    "cost_pass_rate": round(
                        float(sig["cost_ok"].mean()) * 100, 1),
                    "avg_z": round(float(
                        sig["z_score"].dropna().abs().mean()), 2),
                })

            elif path == "/api/signals/history":
                sig = _get_signals(db_path)
                if sig.empty:
                    self._json({"history": []})
                    return
                # Daily aggregates
                daily = sig.groupby("trade_date").agg(
                    total=("alert_raised", "size"),
                    alerts=("alert_raised", "sum"),
                    avg_z=("z_score", lambda x: x.dropna().abs().mean()),
                    liq_pct=("liquidity_ok", "mean"),
                ).reset_index()
                daily["trade_date"] = daily["trade_date"].astype(str)
                daily = daily.sort_values("trade_date")
                self._json({"history": _to_records(daily)})

            else:
                self.send_error(404)

        def _json(self, obj):
            data = json.dumps(obj, cls=_Encoder).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, fmt, *args):
            # Quieter logging
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description="GoldLens Signal API Server")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--db", default=str(
        HERE.parent / "backtest" / "goldlens.duckdb"))
    args = parser.parse_args()

    print(f"GoldLens Signal Server")
    print(f"  DB:   {args.db}")
    print(f"  URL:  http://localhost:{args.port}")
    print(f"  Endpoints:")
    print(f"    GET /api/signals          — latest day signals")
    print(f"    GET /api/signals/summary  — dashboard stats")
    print(f"    GET /api/signals/history  — daily aggregates")
    print()

    server = HTTPServer(("", args.port), _make_handler(args.db))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
