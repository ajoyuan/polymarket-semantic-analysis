from __future__ import annotations

import argparse
import json
import random
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from tqdm import tqdm
from urllib3.util.retry import Retry

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = BACKEND_DIR / "data" / "markets_classified.parquet"
DEFAULT_OUTPUT = BACKEND_DIR / "data" / "markets_classified_with_event_tags.parquet"
DEFAULT_CACHE = BACKEND_DIR / "data" / "event_tags_cache.sqlite"
GAMMA_BASE = "https://gamma-api.polymarket.com"


class MinIntervalGate:
    """Serialize *starts* of HTTP calls so at most one request begins every `seconds` (global across workers)."""

    def __init__(self, seconds: float) -> None:
        self.seconds = max(0.0, float(seconds))
        self._lock = threading.Lock()
        self._next_ok = 0.0

    def wait(self) -> None:
        if self.seconds <= 0:
            return
        with self._lock:
            now = time.monotonic()
            if now < self._next_ok:
                time.sleep(self._next_ok - now)
            self._next_ok = time.monotonic() + self.seconds


def _sleep_for_429(response: requests.Response, attempt: int) -> None:
    raw = response.headers.get("Retry-After")
    if raw:
        try:
            wait = float(raw)
        except ValueError:
            wait = min(180.0, 2.0 ** min(attempt, 8))
    else:
        wait = min(180.0, 1.6 ** min(attempt, 12) + random.uniform(0.0, 0.75))
    time.sleep(wait)


def build_session() -> requests.Session:
    s = requests.Session()
    retries = Retry(
        total=5,
        backoff_factor=0.75,
        status_forcelist=(500, 502, 503, 504),
        allowed_methods=("GET",),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retries, pool_connections=16, pool_maxsize=16)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def init_cache_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS event_tags (
                event_id INTEGER PRIMARY KEY,
                tags_json TEXT NOT NULL,
                fetched_at REAL NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def load_cached_event_ids(path: Path) -> set[int]:
    if not path.exists():
        return set()
    conn = sqlite3.connect(path)
    try:
        cur = conn.execute("SELECT event_id FROM event_tags")
        return {int(r[0]) for r in cur.fetchall()}
    finally:
        conn.close()


def cache_batch_insert(path: Path, rows: list[tuple[int, str, float]]) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.executemany(
            "INSERT OR REPLACE INTO event_tags (event_id, tags_json, fetched_at) VALUES (?, ?, ?)",
            rows,
        )
        conn.commit()
    finally:
        conn.close()


def load_tags_for_event_ids(path: Path, event_ids: set[int], chunk_size: int = 8000) -> dict[int, list[Any]]:
    if not event_ids or not path.exists():
        return {}
    conn = sqlite3.connect(path)
    out: dict[int, list[Any]] = {}
    ids = list(event_ids)
    try:
        for i in range(0, len(ids), chunk_size):
            part = ids[i : i + chunk_size]
            placeholders = ",".join("?" * len(part))
            cur = conn.execute(
                f"SELECT event_id, tags_json FROM event_tags WHERE event_id IN ({placeholders})",
                part,
            )
            for row in cur:
                out[int(row[0])] = json.loads(row[1])
    finally:
        conn.close()
    return out


def fetch_tags_for_event(
    session: requests.Session,
    event_id: int,
    gate: MinIntervalGate | None = None,
    max_429_attempts: int = 60,
) -> tuple[int, list[Any]]:
    url = f"{GAMMA_BASE}/events/{event_id}/tags"
    n429 = 0
    while True:
        if gate:
            gate.wait()
        r = session.get(url, timeout=90)
        if r.status_code == 429:
            if n429 >= max_429_attempts:
                raise RuntimeError(
                    f"event_id={event_id}: exceeded {max_429_attempts} consecutive 429 responses; "
                    "try lowering --workers or increasing --min-interval, then rerun (cache resumes)."
                )
            _sleep_for_429(r, n429)
            n429 += 1
            continue
        if r.status_code == 404:
            return event_id, []
        r.raise_for_status()
        data = r.json()
        if not isinstance(data, list):
            return event_id, []
        return event_id, data


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="markets_classified parquet path")
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="output parquet path")
    p.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="SQLite cache for resume")
    p.add_argument("--workers", type=int, default=4, help="parallel HTTP workers (lower if you see 429)")
    p.add_argument(
        "--min-interval",
        type=float,
        default=0.25,
        help="minimum seconds between starting requests (global across workers); increase if rate-limited",
    )
    p.add_argument(
        "--max-429-attempts",
        type=int,
        default=60,
        help="max backoff retries per event for HTTP 429 before failing that event",
    )
    p.add_argument(
        "--max-events",
        type=int,
        default=0,
        help="if >0, only keep rows whose event_id is in the first N unique event_ids (sorted); "
        "only those events are fetched. Useful for debugging without scanning the full file.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.input.exists():
        print(f"Input not found: {args.input}", file=sys.stderr)
        return 1

    init_cache_db(args.cache)
    tqdm.write(f"Loading {args.input} ...")
    df = pd.read_parquet(args.input)
    if "event_id" not in df.columns:
        print("Column 'event_id' is required.", file=sys.stderr)
        return 1

    # Coerce ids (parquet may contain empty strings or mixed types)
    event_id_numeric = pd.to_numeric(df["event_id"], errors="coerce")
    bad_id_count = int(event_id_numeric.isna().sum())
    if bad_id_count:
        tqdm.write(f"Rows with missing/non-numeric event_id (tags will be []): {bad_id_count:,}")

    all_unique_sorted = sorted({int(x) for x in event_id_numeric.dropna().unique().tolist()})
    if args.max_events > 0:
        allowed = set(all_unique_sorted[: args.max_events])
        eid_int = event_id_numeric.astype("Int64")
        keep = eid_int.notna() & eid_int.isin(list(allowed))
        df = df.loc[keep].reset_index(drop=True)
        event_id_numeric = pd.to_numeric(df["event_id"], errors="coerce")
        unique_ids = sorted(allowed)
        tqdm.write(f"Debug mode: {len(df):,} rows, {len(unique_ids)} distinct event_id values")
    else:
        unique_ids = all_unique_sorted

    cached = load_cached_event_ids(args.cache)
    missing = [eid for eid in unique_ids if eid not in cached]
    tqdm.write(f"Unique event_id: {len(unique_ids):,} | cached: {len(cached):,} | to fetch: {len(missing):,}")

    if missing:
        session = build_session()
        gate = MinIntervalGate(args.min_interval)
        tqdm.write(
            f"HTTP pacing: workers={args.workers}, min_interval={args.min_interval}s, max_429_attempts={args.max_429_attempts}"
        )
        batch: list[tuple[int, str, float]] = []
        batch_size = 500

        def flush() -> None:
            if not batch:
                return
            cache_batch_insert(args.cache, batch)
            batch.clear()

        chunk_submit = 2000
        pbar = tqdm(total=len(missing), desc="Fetching event tags", unit="event")
        try:
            with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
                for chunk_start in range(0, len(missing), chunk_submit):
                    chunk = missing[chunk_start : chunk_start + chunk_submit]
                    futures = {
                        ex.submit(
                            fetch_tags_for_event,
                            session,
                            eid,
                            gate,
                            args.max_429_attempts,
                        ): eid
                        for eid in chunk
                    }
                    for fut in as_completed(futures):
                        eid = futures[fut]
                        try:
                            _, tags = fut.result()
                        except Exception as err:  # noqa: BLE001 — surface and stop with partial cache
                            flush()
                            tqdm.write(f"Failed on event_id={eid}: {err}")
                            raise
                        now = time.time()
                        batch.append((eid, json.dumps(tags), now))
                        if len(batch) >= batch_size:
                            flush()
                        pbar.update(1)
        finally:
            pbar.close()
        flush()

    needed_ids = {int(x) for x in event_id_numeric.dropna().unique().tolist()}
    tag_by_event = load_tags_for_event_ids(args.cache, needed_ids)

    def tags_for_numeric_id(v: Any) -> str:
        if pd.isna(v):
            return json.dumps([])
        return json.dumps(tag_by_event.get(int(v), []))

    df = df.copy()
    df["event_tags_json"] = event_id_numeric.map(tags_for_numeric_id)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    tqdm.write(f"Saving {len(df):,} rows to {args.output} ...")
    df.to_parquet(args.output, index=False)
    tqdm.write("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
