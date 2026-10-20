"""Creates goldlens.duckdb with SYNTHETIC data so you can build the backtest
before Madiha's pipeline and Patil's signals are ready.
The 'signal' part below is only a stand-in for Patil's real output.
The numbers are fake: never show results from this data as real findings."""
import os
from itertools import combinations
import duckdb, numpy as np, pandas as pd

DB = "goldlens.duckdb"
if os.path.exists(DB):
    os.remove(DB)
con = duckdb.connect(DB)
for stmt in open("schema.sql").read().split(";"):
    if stmt.strip():
        con.execute(stmt)

rng = np.random.default_rng(42)
specs = [("GOLDM", 100, 10, 995, 3, 5), ("GOLDTEN", 10, 10, 999, 27, 31),
         ("GOLDGUINEA", 8, 8, 999, 27, 31), ("GOLDPETAL", 1, 1, 999, 27, 31)]
con.executemany("INSERT INTO contract_spec VALUES (?,?,?,?,?,?)", specs)

bdays = pd.bdate_range("2025-01-01", "2026-06-30")
base = pd.Series(100000 * np.exp(np.cumsum(rng.normal(0, 0.006, len(bdays)))), index=bdays)
factor = {"GOLDM": 999 / 995, "GOLDTEN": 1.0, "GOLDGUINEA": 10 / 8, "GOLDPETAL": 10.0}

contracts, prices, norms = [], [], []
cid = pid = 0
for p in pd.period_range("2025-01", "2026-08", freq="M"):
    for sym, *_ , in specs:
        day = 4 if sym == "GOLDM" else 28
        expiry = pd.Timestamp(p.year, p.month, day)
        days = bdays[(bdays >= expiry - pd.Timedelta(days=90)) & (bdays <= expiry)]
        if len(days) == 0:
            continue
        cid += 1
        contracts.append((cid, sym, expiry.date(), days[0].date(), days[-1].date()))
        s = 0.0
        for d in days:
            s = 0.9 * s + rng.normal(0, 60)
            norm = base[d] * (1 + 0.0005 * (expiry - d).days / 30) + s
            raw = norm / factor[sym]
            thin = bool(rng.random() < 0.10)
            vol = int(rng.integers(20, 200) if thin else rng.integers(500, 5000))
            pid += 1
            prices.append((pid, cid, d.date(), raw, raw * 1.001, raw * 0.999, raw, vol, vol * 3))
            norms.append((pid, norm, thin))

cdf = pd.DataFrame(contracts, columns=["contract_id", "symbol", "expiry_date", "listing_date", "last_trade_date"])
pdf = pd.DataFrame(prices, columns=["price_id", "contract_id", "trade_date", "open", "high", "low", "close", "volume", "open_interest"])
ndf = pd.DataFrame(norms, columns=["price_id", "price_per_10g_999", "thin_day"])
for name, df in [("contract", cdf), ("daily_price", pdf), ("normalized_price", ndf)]:
    con.register("tmp", df)
    con.execute(f"INSERT INTO {name} SELECT * FROM tmp")
    con.unregister("tmp")
con.execute("INSERT INTO backtest_run (run_id, start_date, end_date, z_threshold, cost_model) "
            "VALUES (1, '2025-01-01', '2026-06-30', 2.0, 'sample')")

# ---- stand-in for Patil's signal: nearest contract per symbol, pairwise spread z-score (data up to t only)
m = pdf.merge(cdf, on="contract_id").merge(ndf, on="price_id")
near = m.sort_values("expiry_date").groupby(["trade_date", "symbol"]).first().reset_index()
parts = []
for s1, s2 in combinations([x[0] for x in specs], 2):
    j = near[near.symbol == s1].merge(near[near.symbol == s2], on="trade_date", suffixes=("_1", "_2"))
    sw = j.contract_id_1 > j.contract_id_2
    pick = lambda c: np.where(sw, j[c + "_2"], j[c + "_1"])
    other = lambda c: np.where(sw, j[c + "_1"], j[c + "_2"])
    parts.append(pd.DataFrame({
        "trade_date": j.trade_date, "a": pick("contract_id"), "b": other("contract_id"),
        "pa": pick("price_per_10g_999"), "pb": other("price_per_10g_999"),
        "thin": j.thin_day_1 | j.thin_day_2, "ea": pick("expiry_date"), "eb": other("expiry_date")}))
sg = pd.concat(parts).sort_values(["a", "b", "trade_date"]).reset_index(drop=True)
sg["spread"] = sg.pa - sg.pb
grp = sg.groupby(["a", "b"])["spread"]
sg["mean"] = grp.transform(lambda x: x.rolling(20, min_periods=15).mean())
sg["std"] = grp.transform(lambda x: x.rolling(20, min_periods=15).std())
sg = sg.dropna().copy()
sg["z"] = (sg.spread - sg["mean"]) / sg["std"]
sg["cost_ok"] = (sg.spread - sg["mean"]).abs() > sg.pa * 0.0008
sg["liq"] = ~sg.thin
sg["alert"] = (sg.z.abs() >= 2.0) & sg.liq & sg.cost_ok
sg["gap"] = (pd.to_datetime(sg.ea) - pd.to_datetime(sg.eb)).abs().dt.days
sg = sg.sort_values("trade_date").reset_index(drop=True)
out = pd.DataFrame({"signal_id": range(1, len(sg) + 1), "run_id": 1, "trade_date": sg.trade_date,
                    "contract_a_id": sg.a, "contract_b_id": sg.b, "carry_gap_days": sg.gap,
                    "spread": sg.spread, "z_score": sg.z, "liquidity_ok": sg.liq,
                    "cost_ok": sg.cost_ok, "alert_raised": sg.alert, "strategy_version": "sample-v1"})
con.register("tmp", out)
con.execute("INSERT INTO signal SELECT * FROM tmp")
print(f"Created {DB}: {len(cdf)} contracts, {len(pdf)} daily prices, {len(out)} signals "
      f"({int(out.alert_raised.sum())} alerts)")