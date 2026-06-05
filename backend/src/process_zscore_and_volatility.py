"""Build the dashboard time-series + catalog parquet files (memory-optimized).

Memory-optimized port of the Colab notebook
``ECS273_final_project_data_processing_Zscore_and_price_volatility.ipynb``.
Same outputs and math as ``build_dashboard_data.py`` (the faithful port), but
designed for a *huge* quant.parquet that does not fit in RAM.

How it stays small:
  * DuckDB streams quant.parquet in a single filtered, **sorted** scan
    (ORDER BY market_id, timestamp; the sort spills to a temp dir on disk), so
    every market's trades arrive contiguously. We hold **one market at a time**
    in pandas instead of the whole file, and we never write per-market CSVs.
  * The volume-impact OLS is computed from streaming normal-equation sums over
    *all* trades (exact, no sample held in memory).
  * Per-market 30-min series are spilled to small staging parquets; the ARIMAX
    forecast is applied at the end with one DuckDB window query over those
    (small) staging files, so the big file is read only once.

Outputs land in --out-dir (defaults to backend/data, to avoid overwriting the live
files in backend-api/data that the FastAPI dashboard router reads):
  * dashboard_timeseries.parquet
  * dashboard_catalog.parquet
"""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import warnings
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from huggingface_hub import hf_hub_download

from dataset import BACKEND_DIR

warnings.filterwarnings("ignore")

DEFAULT_OUT_DIR = BACKEND_DIR / "data"
DEFAULT_META = BACKEND_DIR / "data" / "markets_classified_with_event_tags.parquet"

# quant.parquet lives on the Hugging Face dataset hub (~27 GB, 766M rows); it has the
# market_id/timestamp/price/usd_amount columns this script needs. Downloaded (and cached)
# on first run via hf_hub_download, matching calculate_uncertainty_with_tags.py.
HF_REPO = "SII-WANGZJ/Polymarket_data"
HF_QUANT_FILE = "quant.parquet"

# The only quant columns this pipeline needs (projected out at the source).
QUANT_COLUMNS = ["market_id", "timestamp", "price", "usd_amount"]

ALLOWED_SLUGS = {
    "sports", "politics", "crypto", "technology",
    "esports", "weather", "finance", "pop-culture",
}

# Category -> ARIMAX baseline exogenous term (learned offline, kept from the notebook).
BASELINE_EXOG = {
    "Decision-Agent": 0.1543,
    "Objective Outcome": 0.0836,
    "Stochastic": 0.0020,
}
DEFAULT_BASELINE_EXOG = 0.05
AR_L1 = 0.9633

# Fallbacks if the regression is degenerate (e.g. no usable rows).
DEFAULT_YES_IMPACT = 0.000015
DEFAULT_NO_IMPACT = 0.000015

# Columns we actually need from the (large) meta parquet.
META_COLUMNS = ["id", "question", "created_at", "end_date", "predicted_label", "event_tags_json"]


def hf_local(repo: str, filename: str) -> str:
    """Return the local cached path for an HF dataset file (downloads only if missing)."""
    print(f"[hf] Resolving {filename} from {repo} (downloads on first run, then cached) ...")
    path = hf_hub_download(repo_id=repo, filename=filename, repo_type="dataset")
    print(f"[hf] Using {path}")
    return path


def _spread_indices(total: int, n: int) -> list[int]:
    """N row-group indices spread evenly across [0, total). quant.parquet's early row
    groups are tiny (tens to thousands of rows) and later ones are ~1M+, so sampling
    across the file gives a representative, non-trivial slice for a quick test."""
    if n >= total:
        return list(range(total))
    if n <= 1:
        return [total // 2]
    return sorted({round(i * (total - 1) / (n - 1)) for i in range(n)})


def _read_limited_row_groups(args: argparse.Namespace, n: int) -> pa.Table:
    """Read N row groups (the four needed columns) spread across the file for a fast partial run.

    For the HF source this uses byte-range requests, so only those row groups are
    fetched over the network -- no full ~27 GB download.
    """
    if args.quant is not None:
        pf = pq.ParquetFile(args.quant)
        idx = _spread_indices(pf.num_row_groups, n)
        print(f"[limit] Reading {len(idx)}/{pf.num_row_groups} row groups from {args.quant} ...")
        return pf.read_row_groups(idx, columns=QUANT_COLUMNS)

    from huggingface_hub import HfFileSystem

    remote = f"datasets/{args.hf_repo}/{args.hf_file}"
    fs = HfFileSystem()
    with fs.open(remote) as f:
        pf = pq.ParquetFile(f)
        idx = _spread_indices(pf.num_row_groups, n)
        print(f"[limit] Range-reading {len(idx)} of {pf.num_row_groups} row groups "
              f"(indices {idx[:3]}{'...' if len(idx) > 3 else ''}) from hf://{remote} "
              "(no full download) ...")
        table = pf.read_row_groups(idx, columns=QUANT_COLUMNS)
    print(f"[limit] Loaded {table.num_rows:,} rows from {len(idx)} row groups.")
    return table


def build_quant_source(con: duckdb.DuckDBPyConnection, args: argparse.Namespace) -> None:
    """Register a `quant_src` relation in DuckDB: a lazy parquet view (full run) or an
    in-memory Arrow table of the first --limit-row-groups groups (partial test run)."""
    if args.limit_row_groups and args.limit_row_groups > 0:
        table = _read_limited_row_groups(args, args.limit_row_groups)
        con.register("quant_src", table)
        return

    if args.quant is not None:
        if not args.quant.exists():
            raise SystemExit(f"quant file not found: {args.quant}")
        path = str(args.quant)
    else:
        path = hf_local(args.hf_repo, args.hf_file)

    escaped = path.replace("'", "''")
    cols = ", ".join(QUANT_COLUMNS)
    con.execute(
        f"CREATE OR REPLACE VIEW quant_src AS SELECT {cols} FROM read_parquet('{escaped}')"
    )


def get_primary_category(tag_json_str: str) -> str | None:
    try:
        tags = json.loads(tag_json_str)
        for t in tags:
            if t.get("slug") in ALLOWED_SLUGS:
                return t.get("label")
    except Exception:
        pass
    return None


def build_catalog(meta_path: Path) -> pd.DataFrame:
    """Load only the needed meta columns; keep markets with a known category and >=1 day."""
    print("\n[catalog] Processing master catalog index ...")
    df_meta = pd.read_parquet(meta_path, columns=META_COLUMNS)

    df_meta["created_at"] = pd.to_datetime(df_meta["created_at"])
    df_meta["end_date"] = pd.to_datetime(df_meta["end_date"])
    duration_days = (df_meta["end_date"] - df_meta["created_at"]).dt.total_seconds() / 86400

    df_meta["category"] = df_meta["event_tags_json"].apply(get_primary_category)
    catalog = df_meta[df_meta["category"].notnull() & (duration_days >= 1.0)].copy()
    catalog["id"] = catalog["id"].astype(str)
    catalog = catalog.drop(columns=["event_tags_json"])

    print(f"[catalog] Tracking {catalog['id'].nunique()} viable markets.")
    return catalog


class OLSAccumulator:
    """Streaming normal equations for OLS: future_zscore ~ 1 + yes_vol + no_vol."""

    def __init__(self) -> None:
        # Symmetric X'X (3x3) and X'y (3) accumulated incrementally.
        self.xtx = np.zeros((3, 3), dtype=np.float64)
        self.xty = np.zeros(3, dtype=np.float64)

    def update(self, yes: np.ndarray, no: np.ndarray, y: np.ndarray) -> None:
        if len(y) == 0:
            return
        ones = np.ones(len(y))
        x = np.column_stack([ones, yes, no])
        self.xtx += x.T @ x
        self.xty += x.T @ y

    def solve(self) -> tuple[float, float]:
        try:
            coef = np.linalg.solve(self.xtx, self.xty)
            return float(coef[1]), float(coef[2])
        except Exception:
            print("[regression] Normal equations not solvable; using defaults.")
            return DEFAULT_YES_IMPACT, DEFAULT_NO_IMPACT


def compute_market_features(group: pd.DataFrame) -> pd.DataFrame:
    """Tick-test volume split + rolling volatility Z-score for a single market (sorted by ts)."""
    group = group.sort_values("timestamp")
    group["price_diff"] = group["price"].diff().fillna(0)
    group["yes_vol"] = np.where(group["price_diff"] >= 0, group["usd_amount"], 0)
    group["no_vol"] = np.where(group["price_diff"] < 0, group["usd_amount"], 0)
    group["returns"] = np.log(group["price"] / group["price"].shift(1).clip(lower=0.0001))

    roll_std = group['returns'].rolling(10).std()
    global_std = roll_std.std()
    
    if pd.isna(global_std) or global_std < 0.00001: 
        group['vol_zscore'] = 0
    else: 
        group['vol_zscore'] = ((roll_std - roll_std.mean()) / global_std).clip(lower=-20, upper=20)
    return group


def resample_market(group: pd.DataFrame, market_id: str) -> pd.DataFrame | None:
    """Apply the zombie filters and produce the 30-min series for one market.

    Returns the per-market staging frame (raw, unrounded values; ARIMAX added
    later in SQL), or None if the market is filtered out.
    """
    if len(group) < 50:
        return None
    if group["usd_amount"].sum() < 5000:
        return None
    if group["price"].max() - group["price"].min() < 0.10:
        return None

    group["is_yes_bet"] = np.where(group["price_diff"] >= 0, 1, 0)
    group["is_no_bet"] = np.where(group["price_diff"] < 0, 1, 0)
    group["datetime"] = pd.to_datetime(group["timestamp"], unit="s")
    group["trade_counter"] = 1

    hourly = group.set_index("datetime").resample("30min").agg({
        "price": "last", "vol_zscore": "last", "yes_vol": "sum", "no_vol": "sum",
        "trade_counter": "sum", "is_yes_bet": "sum", "is_no_bet": "sum",
    })
    hourly["price"] = hourly["price"].ffill()
    hourly["vol_zscore"] = hourly["vol_zscore"].ffill().fillna(0)
    for col in ("yes_vol", "no_vol", "trade_counter", "is_yes_bet", "is_no_bet"):
        hourly[col] = hourly[col].fillna(0)

    if len(hourly) < 24:
        return None

    # Drop markets that only traded at the very start/end (dead in the middle).
    timeline_length = len(hourly)
    if timeline_length > 20:
        total_trades = hourly["is_yes_bet"].sum() + hourly["is_no_bet"].sum()
        mid_start, mid_end = int(timeline_length * 0.20), int(timeline_length * 0.80)
        mid = hourly.iloc[mid_start:mid_end]
        middle_trades = mid["is_yes_bet"].sum() + mid["is_no_bet"].sum()
        if total_trades > 0 and (middle_trades / total_trades) < 0.05:
            return None

    # Raw (unrounded) values; rounding + ARIMAX are applied in the final SQL pass.
    web_series = pd.DataFrame({
        "market_id": market_id,
        # Epoch milliseconds, resolution-independent. (pandas 3 backs to_datetime(unit="s")
        # with datetime64[s], so the notebook's `.astype("int64") // 10**6` would yield
        # seconds//1e6 and collapse every timestamp -- force ms first, then to int.)
        "timestamp": hourly.index.astype("datetime64[ms]").astype("int64"),
        "price": hourly["price"].to_numpy(),
        "zscore": hourly["vol_zscore"].to_numpy(),
        "yes_volume": hourly["yes_vol"].to_numpy(),
        "no_volume": hourly["no_vol"].to_numpy(),
        "yes_count": hourly["is_yes_bet"].astype(int).to_numpy(),
        "no_count": hourly["is_no_bet"].astype(int).to_numpy(),
        "trade_count": hourly["trade_counter"].astype(int).to_numpy(),
    })

    if len(web_series) <= 10 or web_series["trade_count"].sum() < 50:
        return None
    return web_series


def stream_markets(
    con: duckdb.DuckDBPyConnection,
    valid_ids: set[str],
    staging_dir: Path,
    batch_rows: int,
    market_batch: int,
) -> tuple[set[str], float, float]:
    """Single streaming pass over `quant_src`: fit OLS sums + spill 30-min series per market.

    DuckDB returns the filtered trades ordered by (market_id, timestamp) so each
    market is contiguous; we keep at most one in-progress market plus one fetch
    batch in memory.
    """
    print("\n[stream] Scanning quant data (one market at a time) ...")
    con.register("valid_ids", pd.DataFrame({"id": sorted(valid_ids)}))

    reader = con.execute(
        """
        SELECT CAST(q.market_id AS VARCHAR) AS market_id,
               q.timestamp, q.price, q.usd_amount
        FROM quant_src q
        SEMI JOIN valid_ids v ON CAST(q.market_id AS VARCHAR) = v.id
        ORDER BY market_id, q.timestamp
        """
    ).fetch_record_batch(batch_rows)

    ols = OLSAccumulator()
    successful: set[str] = set()
    buffer: list[pd.DataFrame] = []
    batch_counter = 0
    seen = 0

    def flush_buffer() -> None:
        nonlocal batch_counter
        if not buffer:
            return
        batch_counter += 1
        pd.concat(buffer, ignore_index=True).to_parquet(
            staging_dir / f"stage_{batch_counter:05d}.parquet", index=False
        )
        buffer.clear()

    def handle_market(market_id: str, group: pd.DataFrame) -> None:
        nonlocal seen
        seen += 1
        if seen % 2000 == 0:
            print(f"   processed {seen} markets ({len(successful)} kept) ...")

        feats = compute_market_features(group)

        # OLS over ALL markets (matches the notebook's pre-filter sample population).
        future_z = feats["vol_zscore"].shift(-1)
        mask = feats["returns"].notna() & feats["vol_zscore"].notna() & future_z.notna()
        if mask.any():
            ols.update(
                feats.loc[mask, "yes_vol"].to_numpy(float),
                feats.loc[mask, "no_vol"].to_numpy(float),
                future_z[mask].to_numpy(float),
            )

        web_series = resample_market(feats, market_id)
        if web_series is not None:
            buffer.append(web_series)
            successful.add(market_id)
            if len(buffer) >= market_batch:
                flush_buffer()

    pending: pd.DataFrame | None = None
    for batch in reader:
        df = batch.to_pandas()
        if pending is not None and len(pending):
            df = pd.concat([pending, df], ignore_index=True)

        last_mid = df["market_id"].iloc[-1]
        tail = df["market_id"] == last_mid  # contiguous trailing (possibly partial) market
        complete = df[~tail]
        pending = df[tail].copy()

        for mid, g in complete.groupby("market_id", sort=False):
            handle_market(mid, g)

    if pending is not None and len(pending):
        for mid, g in pending.groupby("market_id", sort=False):
            handle_market(mid, g)

    flush_buffer()

    yes_impact, no_impact = ols.solve()
    print(f"[regression] YES impact: {yes_impact:.8f} | NO impact: {no_impact:.8f}")
    print(f"[stream] {seen} markets scanned, {len(successful)} kept.")
    return successful, yes_impact, no_impact


def write_timeseries(
    con: duckdb.DuckDBPyConnection,
    staging_dir: Path,
    catalog: pd.DataFrame,
    yes_impact: float,
    no_impact: float,
    out_path: Path,
) -> None:
    """Apply ARIMAX via a window query over the (small) staging files and write the result."""
    print("\n[forecast] Applying ARIMAX and writing the final time-series ...")

    baseline = catalog[["id", "predicted_label"]].copy()
    baseline["baseline_exog"] = (
        baseline["predicted_label"].map(BASELINE_EXOG).fillna(DEFAULT_BASELINE_EXOG)
    )
    con.register("baseline", baseline[["id", "baseline_exog"]])

    # ARIMAX uses the *unrounded* previous-step values (lag); outputs are rounded here
    # exactly as the notebook rounded them. Coefficients are inlined at full precision.
    con.execute(
        f"""
        COPY (
            WITH ts AS (
                SELECT
                    market_id, timestamp, price, zscore, yes_volume, no_volume,
                    yes_count, no_count, trade_count,
                    lag(zscore)      OVER w AS prev_z,
                    lag(yes_volume)  OVER w AS prev_yes,
                    lag(no_volume)   OVER w AS prev_no,
                    lag(trade_count) OVER w AS prev_tc
                FROM read_parquet($glob)
                WINDOW w AS (PARTITION BY market_id ORDER BY timestamp)
            )
            SELECT
                t.market_id,
                t.timestamp,
                round(t.price, 4)      AS price,
                round(t.zscore, 2)     AS zscore,
                round(t.yes_volume, 2) AS yes_volume,
                round(t.no_volume, 2)  AS no_volume,
                t.yes_count,
                t.no_count,
                t.trade_count,
                CASE WHEN t.prev_z IS NULL THEN NULL ELSE round(
                    COALESCE(b.baseline_exog, {DEFAULT_BASELINE_EXOG!r})
                    + t.prev_z * {AR_L1!r}
                        * (CASE WHEN t.prev_tc = 0 THEN 0.1
                                WHEN t.prev_tc <= 2 THEN 0.5 ELSE 1.0 END)
                    + t.prev_yes * {yes_impact!r}
                    + t.prev_no  * {no_impact!r}
                , 4) END AS arimax
            FROM ts t
            LEFT JOIN baseline b ON t.market_id = b.id
            ORDER BY t.market_id, t.timestamp
        ) TO $out (FORMAT PARQUET)
        """,
        {"glob": str(staging_dir / "*.parquet"), "out": str(out_path)},
    )
    print("[forecast] Time-series written.")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--quant", type=Path, default=None,
                   help="local quant parquet (market_id,timestamp,price,usd_amount); "
                        "if omitted, download from Hugging Face")
    p.add_argument("--hf-repo", default=HF_REPO, help="Hugging Face dataset repo for quant.parquet")
    p.add_argument("--hf-file", default=HF_QUANT_FILE, help="quant filename within the HF repo")
    p.add_argument("--limit-row-groups", type=int, default=0,
                   help="fast partial run: read N parquet row groups spread evenly across the "
                        "file (quant.parquet's later groups hold ~1M rows each). For the HF "
                        "source this range-reads only those groups, without downloading the "
                        "full ~27 GB file. 0 = full file.")
    p.add_argument("--meta", type=Path, default=DEFAULT_META,
                   help="markets_classified_with_event_tags parquet")
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR,
                   help="directory for dashboard_timeseries.parquet and dashboard_catalog.parquet")
    p.add_argument("--work-dir", type=Path, default=None,
                   help="scratch dir for staging + DuckDB sort spill (default: temp dir, auto-deleted)")
    p.add_argument("--memory-limit", default="4GB",
                   help="DuckDB memory limit before it spills the sort to disk")
    p.add_argument("--threads", type=int, default=4, help="DuckDB threads")
    p.add_argument("--batch-rows", type=int, default=500_000,
                   help="rows per streamed Arrow batch (smaller = less RAM)")
    p.add_argument("--market-batch", type=int, default=2000,
                   help="markets buffered before spilling a staging parquet")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.meta.exists():
        raise SystemExit(f"meta file not found: {args.meta}")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    work_dir = args.work_dir or Path(tempfile.mkdtemp(prefix="zscore_build_"))
    staging_dir = work_dir / "staging"
    spill_dir = work_dir / "duckdb_tmp"
    for d in (staging_dir, spill_dir):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute("PRAGMA enable_progress_bar")
    con.execute("SET preserve_insertion_order = false")
    con.execute(f"SET threads = {int(args.threads)}")
    con.execute(f"SET memory_limit = '{args.memory_limit}'")
    con.execute(f"SET temp_directory = '{spill_dir}'")
    con.execute("SET max_temp_directory_size = '200GB'")

    try:
        catalog = build_catalog(args.meta)
        valid_ids = set(catalog["id"].values)

        build_quant_source(con, args)
        successful, yes_impact, no_impact = stream_markets(
            con, valid_ids, staging_dir, args.batch_rows, args.market_batch
        )

        timeseries_path = args.out_dir / "dashboard_timeseries.parquet"
        catalog_path = args.out_dir / "dashboard_catalog.parquet"

        if not successful:
            raise SystemExit("No markets passed the filters; nothing to write.")

        write_timeseries(con, staging_dir, catalog, yes_impact, no_impact, timeseries_path)

        print("\n[catalog] Writing final catalog ...")
        final_catalog = catalog[catalog["id"].isin(successful)]
        final_catalog[["id", "question", "predicted_label", "category"]].to_parquet(
            catalog_path, index=False
        )
    finally:
        con.close()
        if args.work_dir is None:
            shutil.rmtree(work_dir, ignore_errors=True)

    print("\n" + "=" * 60)
    print(f"Done. Processed {len(successful)} high-quality markets.")
    print(f"  {timeseries_path}")
    print(f"  {catalog_path}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
