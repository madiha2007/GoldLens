"""
GoldLens — Signal Engine (Piyush Patil).

Convenience entry-point that re-exports the public API from the signals
package.  Run directly or import into notebooks / other scripts:

    # CLI
    python -m signals.signal_engine --db goldlens.duckdb --run-id 1

    # Library
    from signals.signal_engine import generate_signals
    table = generate_signals(con)
"""

from .generate import (                    # noqa: F401 — re-export
    generate_signals,
    write_signals_to_db,
    main,
    DEFAULT_Z_THRESHOLD,
    DEFAULT_ROLLING_WINDOW,
    DEFAULT_ROLLING_MIN_PERIODS,
    DEFAULT_COST_BPS,
)
from .contract_specs import SPECS, NORM_FACTOR  # noqa: F401
from .normalizer import normalize_prices       # noqa: F401
from .liquidity import flag_thin_days          # noqa: F401
from .pairing import pair_contracts, carry_adjustment  # noqa: F401
from .term_structure import fit_daily_curve, decompose_spread  # noqa: F401


if __name__ == "__main__":
    main()
