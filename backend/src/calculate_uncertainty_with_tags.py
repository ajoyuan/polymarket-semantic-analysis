import duckdb
from huggingface_hub import hf_hub_download

from dataset import BACKEND_DIR

HF_REPO = "SII-WANGZJ/Polymarket_data"
CLASSIFIED = BACKEND_DIR / "data" / "markets_classified_with_event_tags.parquet"
OUTPUT_PATH = BACKEND_DIR / "data" / "market_uncertainty.parquet"


def hf_local(filename: str) -> str:
    """Return the local cached path for an HF dataset file (downloads only if missing)."""
    return hf_hub_download(repo_id=HF_REPO, filename=filename, repo_type="dataset")

QUERY = """
WITH eligible AS (
    SELECT
        CAST(id AS BIGINT) AS market_id,
        question,
        token1,
        token2,
        outcome_prices,
        predicted_label,
        event_tags_json
    FROM read_parquet($classified)
    -- Eligibility is "has matching trades", not the metadata `volume`: that column
    -- is Polymarket's market-metadata field, not computed from trades.parquet, and
    -- is 0/stale for plenty of markets that actually traded (e.g. market 1549770
    -- has volume=0 in metadata but 850 real trades). We therefore do NOT filter on
    -- volume here; the inner join to `agg` at the bottom drops any market with no
    -- matching trades. Only the shard predicate stays.
    WHERE hash(CAST(id AS BIGINT)) % $num_batches = $batch
),
-- Normalise to P(token1) and keep only eligible-market trades, joining on the
-- integer key, before the window touches the data.
norm AS (
    SELECT
        TRY_CAST(t.market_id AS BIGINT) AS market_id,
        t.timestamp,
        t.block_number,
        t.log_index,
        CASE WHEN t.asset_id = e.token1 THEN t.price
             WHEN t.asset_id = e.token2 THEN 1 - t.price
        END AS p,
        t.usd_amount
    FROM read_parquet($trades) t
    JOIN eligible e ON TRY_CAST(t.market_id AS BIGINT) = e.market_id
    WHERE t.asset_id IN (e.token1, e.token2)
),
trades AS (
    SELECT
        *,
        LEAD(timestamp) OVER (
            PARTITION BY market_id
            ORDER BY timestamp, block_number, log_index
        ) AS next_ts
    FROM norm
),
agg AS (
    SELECT
        market_id,
        -- Trade-derived volume: total USD traded across both tokens for this market.
        -- Replaces the unreliable metadata `volume` field from the markets file.
        sum(usd_amount) AS volume,
        arg_max(p, (timestamp, block_number, log_index)) AS last_price,
        CASE WHEN sum(usd_amount) = 0 THEN NULL
             ELSE sum(p * usd_amount) / sum(usd_amount)
        END AS vwap,
        CASE
            WHEN count(*) = 1 THEN any_value(p)
            WHEN max(timestamp) = min(timestamp) THEN avg(p)
            ELSE sum(CASE WHEN next_ts IS NOT NULL
                          THEN p * (next_ts - timestamp) ELSE 0 END)
                 / (max(timestamp) - min(timestamp))
        END AS twap
    FROM trades
    GROUP BY market_id
)
SELECT
    e.market_id,
    e.question,
    a.volume,
    a.last_price,
    abs(a.last_price - 0.5) * 2 AS uncertainty_last,
    a.twap,
    abs(a.twap - 0.5) * 2 AS uncertainty_twap,
    a.vwap,
    abs(a.vwap - 0.5) * 2 AS uncertainty_vwap,
    e.outcome_prices,
    e.predicted_label,
    e.event_tags_json
FROM agg a
JOIN eligible e USING (market_id)
"""


NUM_BATCHES = 8


def main() -> None:
    trades_path = hf_local("trades.parquet")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    parts_dir = OUTPUT_PATH.parent / ".uncertainty_parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    for stale in parts_dir.glob("part_*.parquet"):
        stale.unlink()

    spill_dir = OUTPUT_PATH.parent / ".duckdb_tmp"
    spill_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute("PRAGMA enable_progress_bar")
    con.execute("SET preserve_insertion_order = false")
    con.execute("SET threads = 4")
    con.execute("SET memory_limit = '10GB'")
    con.execute(f"SET temp_directory = '{spill_dir}'")
    con.execute("SET max_temp_directory_size = '200GB'")

    for batch in range(NUM_BATCHES):
        part_path = parts_dir / f"part_{batch:03d}.parquet"
        print(
            f"[batch {batch + 1}/{NUM_BATCHES}] aggregating uncertainty for "
            f"hash(market_id) % {NUM_BATCHES} == {batch} ..."
        )
        con.execute(
            f"COPY ({QUERY}) TO '{part_path}' (FORMAT parquet)",
            {
                "trades": trades_path,
                "classified": str(CLASSIFIED),
                "num_batches": NUM_BATCHES,
                "batch": batch,
            },
        )

    con.execute(
        f"COPY (SELECT * FROM read_parquet($parts)) TO '{OUTPUT_PATH}' (FORMAT parquet)",
        {"parts": str(parts_dir / "part_*.parquet")},
    )

    n = con.execute(
        "SELECT count(*) FROM read_parquet($out)", {"out": str(OUTPUT_PATH)}
    ).fetchone()[0]
    missing = con.execute(
        "SELECT count(*) FROM read_parquet($out) WHERE predicted_label IS NULL",
        {"out": str(OUTPUT_PATH)},
    ).fetchone()[0]
    print(f"\nDone. {n} markets written to {OUTPUT_PATH}")
    print(f"  {missing} without a predicted_label")


if __name__ == "__main__":
    main()
