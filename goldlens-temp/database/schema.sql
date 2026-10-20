-- GoldLens database schema (DuckDB). Works in Postgres/Supabase with tiny changes
-- (DOUBLE -> DOUBLE PRECISION, current_timestamp stays the same).

CREATE TABLE contract_spec (
    symbol              VARCHAR PRIMARY KEY,
    trading_unit_g      INTEGER,
    quote_unit_g        INTEGER,
    purity              INTEGER,
    expiry_window_start INTEGER,
    expiry_window_end   INTEGER
);

CREATE TABLE contract (
    contract_id     INTEGER PRIMARY KEY,
    symbol          VARCHAR NOT NULL REFERENCES contract_spec(symbol),
    expiry_date     DATE NOT NULL,
    listing_date    DATE,
    last_trade_date DATE,
    UNIQUE (symbol, expiry_date)
);

CREATE TABLE daily_price (
    price_id      INTEGER PRIMARY KEY,
    contract_id   INTEGER NOT NULL REFERENCES contract(contract_id),
    trade_date    DATE NOT NULL,
    open          DOUBLE,
    high          DOUBLE,
    low           DOUBLE,
    close         DOUBLE,
    volume        BIGINT,
    open_interest BIGINT,
    UNIQUE (contract_id, trade_date)
);

CREATE TABLE normalized_price (
    price_id          INTEGER PRIMARY KEY REFERENCES daily_price(price_id),
    price_per_10g_999 DOUBLE NOT NULL,
    thin_day          BOOLEAN DEFAULT FALSE
);

CREATE TABLE backtest_run (
    run_id      INTEGER PRIMARY KEY,
    start_date  DATE,
    end_date    DATE,
    z_threshold DOUBLE,
    cost_model  VARCHAR,
    created_at  TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE signal (
    signal_id        INTEGER PRIMARY KEY,
    run_id           INTEGER NOT NULL REFERENCES backtest_run(run_id),
    trade_date       DATE NOT NULL,
    contract_a_id    INTEGER NOT NULL REFERENCES contract(contract_id),
    contract_b_id    INTEGER NOT NULL REFERENCES contract(contract_id),
    carry_gap_days   INTEGER,
    spread           DOUBLE,
    z_score          DOUBLE,
    liquidity_ok     BOOLEAN,
    cost_ok          BOOLEAN,
    alert_raised     BOOLEAN,
    strategy_version VARCHAR,
    CHECK (contract_a_id < contract_b_id),
    UNIQUE (run_id, trade_date, contract_a_id, contract_b_id)
);

CREATE TABLE trade (
    trade_id   INTEGER PRIMARY KEY,
    run_id     INTEGER NOT NULL REFERENCES backtest_run(run_id),
    signal_id  INTEGER NOT NULL REFERENCES signal(signal_id),
    entry_date DATE,
    exit_date  DATE,
    gross_pnl  DOUBLE,
    costs      DOUBLE,
    net_pnl    DOUBLE,
    beta_pnl   DOUBLE
);

CREATE TABLE trade_leg (
    leg_id      INTEGER PRIMARY KEY,
    trade_id    INTEGER NOT NULL REFERENCES trade(trade_id),
    contract_id INTEGER NOT NULL REFERENCES contract(contract_id),
    side        VARCHAR CHECK (side IN ('long', 'short')),
    quantity    INTEGER,
    entry_price DOUBLE,
    exit_price  DOUBLE
);

CREATE TABLE data_quality_log (
    log_id         INTEGER PRIMARY KEY,
    requested_date DATE,
    returned_date  DATE,
    status         VARCHAR,
    reason         VARCHAR
);