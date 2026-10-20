"""GoldLens walk-forward backtest (Piyush Rohra).

Replays history one day at a time. A signal seen on day t (computed from data up to t)
is executed on the NEXT trading day, so there is no look-ahead.
Prices used are the normalized settlement prices (Rs per 10 g at 999) of the contracts
actually held. Settlement is not a real fill, so slippage is charged as a cost
(higher on thin days).

Usage:
  python backtest.py --run-id 1
  python backtest.py --run-id 1 --start 2025-01-01 --end 2025-12-31   # tune here
  python backtest.py --run-id 1 --start 2026-01-01 --end 2026-06-30   # final unseen test
"""
import argparse, os
import duckdb, pandas as pd


def parse():
    p = argparse.ArgumentParser()
    p.add_argument("--db", default="goldlens.duckdb")
    p.add_argument("--run-id", type=int, default=1)
    p.add_argument("--start"); p.add_argument("--end")
    p.add_argument("--exit-z", type=float, default=0.5, help="close when |z| falls to this")
    p.add_argument("--max-hold", type=int, default=15, help="max trading days in a trade")
    p.add_argument("--expiry-buffer", type=int, default=3, help="days before expiry to stop/exit")
    p.add_argument("--fee-bps", type=float, default=1.0, help="brokerage+charges per fill")
    p.add_argument("--slip-bps", type=float, default=1.0, help="slippage per fill, normal day")
    p.add_argument("--thin-slip-bps", type=float, default=5.0, help="slippage per fill, thin day")
    p.add_argument("--qty", type=int, default=1, help="units per leg (Rs per 10 g equivalent)")
    return p.parse_args()


def main():
    a = parse()
    con = duckdb.connect(a.db)
    run = con.execute("SELECT start_date, end_date FROM backtest_run WHERE run_id=?", [a.run_id]).fetchone()
    if run is None:
        raise SystemExit(f"run_id {a.run_id} not found in backtest_run")
    start = pd.Timestamp(a.start or run[0]).date()
    end = pd.Timestamp(a.end or run[1]).date()

    px = con.execute("""
        SELECT d.contract_id, d.trade_date, n.price_per_10g_999 AS price, n.thin_day, c.expiry_date
        FROM normalized_price n
        JOIN daily_price d ON d.price_id = n.price_id
        JOIN contract c ON c.contract_id = d.contract_id
        WHERE d.trade_date BETWEEN ? AND ?""", [start, end]).df()
    sig = con.execute("""SELECT * FROM signal WHERE run_id=? AND trade_date BETWEEN ? AND ?
                         ORDER BY trade_date""", [a.run_id, start, end]).df()
    if px.empty or sig.empty:
        raise SystemExit("No prices or signals in this date range.")
    px["trade_date"] = pd.to_datetime(px["trade_date"])
    sig["trade_date"] = pd.to_datetime(sig["trade_date"])

    price = {(r.contract_id, r.trade_date): r.price for r in px.itertuples()}
    thin = {(r.contract_id, r.trade_date): bool(r.thin_day) for r in px.itertuples()}
    expiry = {r.contract_id: pd.Timestamp(r.expiry_date) for r in px.drop_duplicates("contract_id").itertuples()}
    gold = px.groupby("trade_date")["price"].mean().to_dict()   # simple gold-level proxy
    dates = sorted(gold)
    idx = {d: i for i, d in enumerate(dates)}
    zl = {(r.contract_a_id, r.contract_b_id, r.trade_date): r.z_score for r in sig.itertuples()}
    by_date = {d: g for d, g in sig.groupby("trade_date")}
    buf = pd.Timedelta(days=a.expiry_buffer)

    def fee(cid, d):  # fees + slippage for one fill, in Rs
        slip = a.thin_slip_bps if thin[(cid, d)] else a.slip_bps
        return price[(cid, d)] * a.qty * (a.fee_bps + slip) / 1e4

    def close(pair, o, t):
        ca, cb = pair
        sa, sb = o["side_a"], -o["side_a"]
        pa1, pb1 = price[(ca, t)], price[(cb, t)]
        gross = a.qty * (sa * (pa1 - o["pa"]) + sb * (pb1 - o["pb"]))
        costs = o["c_in"] + fee(ca, t) + fee(cb, t)
        beta = (sa + sb) * a.qty * (gold[t] - gold[o["entry"]])   # net gold exposure x gold move
        return dict(signal_id=o["sid"], entry=o["entry"], exit=t, ca=ca, cb=cb, sa=sa,
                    pa0=o["pa"], pb0=o["pb"], pa1=pa1, pb1=pb1,
                    gross=gross, costs=costs, net=gross - costs, beta=beta)

    open_t, pend_in, pend_out, trades = {}, [], set(), []
    for t in dates:
        # 1) exits decided yesterday are filled today
        for pair in list(pend_out):
            if (pair[0], t) in price and (pair[1], t) in price:
                trades.append(close(pair, open_t.pop(pair), t)); pend_out.discard(pair)
        # 2) entries decided yesterday are filled today
        for pair, sid, z in pend_in:
            ca, cb = pair
            if pair in open_t or (ca, t) not in price or (cb, t) not in price:
                continue
            open_t[pair] = dict(sid=sid, entry=t, side_a=-1 if z > 0 else 1,   # z>0: A rich -> short A
                                pa=price[(ca, t)], pb=price[(cb, t)], c_in=fee(ca, t) + fee(cb, t))
        pend_in = []
        # 3) decisions using only today's information
        for pair, o in open_t.items():
            if pair in pend_out:
                continue
            z = zl.get((pair[0], pair[1], t))
            near = min(expiry[pair[0]], expiry[pair[1]])
            if (z is not None and abs(z) <= a.exit_z) or idx[t] - idx[o["entry"]] >= a.max_hold or t >= near - buf:
                pend_out.add(pair)
        for r in by_date.get(t, []).itertuples() if t in by_date else []:
            pair = (r.contract_a_id, r.contract_b_id)
            near = min(expiry[pair[0]], expiry[pair[1]])
            if r.alert_raised and pair not in open_t and t < near - buf and all(p[0] != pair for p in pend_in):
                pend_in.append((pair, r.signal_id, r.z_score))

    last = dates[-1]   # anything still open is closed at the end of the test period
    for pair in list(open_t):
        if (pair[0], last) in price and (pair[1], last) in price and open_t[pair]["entry"] < last:
            trades.append(close(pair, open_t.pop(pair), last))

    # ---- save to the database (re-running replaces this run's trades)
    con.execute("DELETE FROM trade_leg WHERE trade_id IN (SELECT trade_id FROM trade WHERE run_id=?)", [a.run_id])
    con.execute("DELETE FROM trade WHERE run_id=?", [a.run_id])
    tid = con.execute("SELECT coalesce(max(trade_id),0) FROM trade").fetchone()[0] + 1
    lid = con.execute("SELECT coalesce(max(leg_id),0) FROM trade_leg").fetchone()[0] + 1
    for tr in trades:
        con.execute("INSERT INTO trade VALUES (?,?,?,?,?,?,?,?,?)",
                    [tid, a.run_id, tr["signal_id"], tr["entry"].date(), tr["exit"].date(),
                     tr["gross"], tr["costs"], tr["net"], tr["beta"]])
        side = lambda s: "long" if s > 0 else "short"
        con.execute("INSERT INTO trade_leg VALUES (?,?,?,?,?,?,?)",
                    [lid, tid, tr["ca"], side(tr["sa"]), a.qty, tr["pa0"], tr["pa1"]])
        con.execute("INSERT INTO trade_leg VALUES (?,?,?,?,?,?,?)",
                    [lid + 1, tid, tr["cb"], side(-tr["sa"]), a.qty, tr["pb0"], tr["pb1"]])
        tid += 1; lid += 2

    # ---- metrics (gross vs net, strategy vs gold)
    os.makedirs("results", exist_ok=True)
    if not trades:
        print("No trades were made. That is a valid result: report it honestly."); return
    df = pd.DataFrame(trades).sort_values("exit").reset_index(drop=True)
    df["cum_gross"], df["cum_net"] = df.gross.cumsum(), df.net.cumsum()
    curve = pd.concat([pd.Series([0.0]), df.cum_net], ignore_index=True)
    m = {
        "run_id": a.run_id, "period": f"{start} to {end}", "trades": len(df),
        "hit_rate_net": round((df.net > 0).mean(), 3),
        "gross_pnl": round(df.gross.sum(), 2), "total_costs": round(df.costs.sum(), 2),
        "net_pnl": round(df.net.sum(), 2), "gold_exposure_pnl": round(df.beta.sum(), 2),
        "strategy_pnl_ex_gold": round(df.net.sum() - df.beta.sum(), 2),
        "avg_net_pnl_per_trade": round(df.net.mean(), 2),
        "max_drawdown": round((curve - curve.cummax()).min(), 2),
        "gold_change_pct_same_period": round((gold[dates[-1]] / gold[dates[0]] - 1) * 100, 2),
    }
    pd.Series(m).to_csv(f"results/metrics_run{a.run_id}.csv", header=False)
    df[["exit", "cum_gross", "cum_net"]].to_csv(f"results/equity_run{a.run_id}.csv", index=False)
    print(pd.Series(m).to_string())
    print(f"\nSaved results/metrics_run{a.run_id}.csv and results/equity_run{a.run_id}.csv")


if __name__ == "__main__":
    main()