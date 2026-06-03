import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query
from db import get_db, DATA_SOURCES
from typing import Optional
import numpy as np
import pandas as pd
from scipy.stats import gaussian_kde

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])



@router.get("/catalog")
def get_dashboard_catalog(
    con: duckdb.DuckDBPyConnection = Depends(get_db)
):
    """
    Fetch all markets to show market options in the UI dropdowns and filters.
    """
    query = f"""
        SELECT id, question, predicted_label, category 
        FROM read_parquet('{DATA_SOURCES["dashboard_catalog"]}')
    """
    
    try:
        df = con.execute(query).df()
        return {"catalog": df.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.get("/timeseries")
def get_dashboard_timeseries(
    market_id: str,
    con: duckdb.DuckDBPyConnection = Depends(get_db)
):
    """
    Retrieve time-series data for a specific market.
    Provides prices, volume distributions, Z-scores, and ARIMAX outputs.
    """
    query = f"""
        SELECT 
            timestamp, 
            price, 
            zscore, 
            yes_volume, 
            no_volume, 
            yes_count, 
            no_count, 
            trade_count, 
            arimax
        FROM read_parquet('{DATA_SOURCES["dashboard_timeseries"]}')
        WHERE market_id = '{market_id}'
        ORDER BY timestamp ASC
    """
    
    try:
        df = con.execute(query).df()
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No time-series data found for market ID {market_id}")
        
        df = df.replace([float("inf"), float("-inf")], pd.NA)
        clean_records = df.astype(object).where(pd.notna(df), None).to_dict(orient="records")

        return {
            "market_id": market_id,
            "data_points": len(df),
            "series": clean_records
        }
    except HTTPException as he:
            raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/uncertainty")
def get_market_uncertainty(
    market_id: str,
    con: duckdb.DuckDBPyConnection = Depends(get_db)
):
    """
    Retrieve the price-uncertainty scores for a specific market.

    Uncertainty is a confidence measure derived from the resolved price
    (1 = fully decided, 0 = coin-flip). The TWAP-based score weights each
    trade by the time it held before the next trade.
    """
    query = f"""
        SELECT
            market_id,
            twap,
            uncertainty_twap,
            vwap,
            uncertainty_vwap,
            last_price,
            uncertainty_last
        FROM read_parquet('{DATA_SOURCES["market_uncertainty"]}')
        WHERE market_id = TRY_CAST(? AS BIGINT)
        LIMIT 1
    """

    try:
        df = con.execute(query, [market_id]).df()
        if df.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No uncertainty data found for market ID {market_id}"
            )

        df = df.replace([float("inf"), float("-inf")], pd.NA)
        record = df.astype(object).where(pd.notna(df), None).to_dict(orient="records")[0]

        return {
            "market_id": market_id,
            "uncertainty_twap": record["uncertainty_twap"],
            "twap": record["twap"],
            "metrics": record
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/certainty_volume_ridgeline")
def get_certainty_volume_ridgeline(
    con: duckdb.DuckDBPyConnection = Depends(get_db)
):
    """
    Ridgeline data: the distribution of certainty (TWAP) within each traded-volume
    band, per market type. The KDE is done here (the frontend only draws the curves),
    so the response is a set of ready-to-plot density arrays sharing one x-grid.

    Shape:
        {
          "x": [...RIDGELINE_GRID samples in 0..1...],
          "peak": <global max density, for a shared height scale across cells>,
          "bands": [{"label": "< $10"}, ...]   # bottom -> top
          "types": ["Stochastic", ...],
          "cells": [
            {"type": ..., "band": ..., "n": <count>, "density": [...] | null}
          ]
        }
    A cell's `density` is null when the band/type has too few markets (or zero
    variance) to estimate a KDE; the frontend renders those as an empty ridge.
    """

    VOLUME_BANDS = [
        (0, 10, "< $10"),
        (10, 100, "$10 – $100"),
        (100, 1_000, "$100 – $1k"),
        (1_000, 10_000, "$1k – $10k"),
        (10_000, 100_000, "$10k – $100k"),
        (100_000, 1_000_000, "$100k – $1M"),
        (1_000_000, None, "$1M+"),
    ]

    RIDGELINE_TYPES = ["Stochastic", "Objective Outcome", "Decision-Agent"]
    RIDGELINE_GRID = 100
    RIDGELINE_MIN_N = 50
    RIDGELINE_KDE_SAMPLE = 20000

    x = np.linspace(0, 1, RIDGELINE_GRID)
    rng = np.random.default_rng(0)  # deterministic subsampling
    try:
        # `label` is a reserved word in DuckDB, so alias predicted_label as `plabel`.
        df = con.execute(f"""
            SELECT uncertainty_twap AS c, volume AS v, predicted_label AS plabel
            FROM read_parquet('{DATA_SOURCES["market_uncertainty"]}')
            WHERE uncertainty_twap IS NOT NULL AND volume IS NOT NULL
              AND predicted_label IN ('Stochastic','Objective Outcome','Decision-Agent')
        """).df()

        cells = []
        peak = 0.0
        for lo, hi, band_label in VOLUME_BANDS:
            in_band = df["v"] >= lo if hi is None else (df["v"] >= lo) & (df["v"] < hi)
            for label in RIDGELINE_TYPES:
                c = df.loc[in_band & (df["plabel"] == label), "c"].to_numpy()

                if len(c) < RIDGELINE_MIN_N or np.ptp(c) == 0:
                    cells.append({"type": label, "band": band_label, "n": int(len(c)), "density": None})
                    continue

                sample = c if len(c) <= RIDGELINE_KDE_SAMPLE else rng.choice(c, RIDGELINE_KDE_SAMPLE, replace=False)
                dens = gaussian_kde(sample)(x)
                peak = max(peak, float(dens.max()))
                cells.append({
                    "type": label,
                    "band": band_label,
                    "n": int(len(c)),
                    "density": [round(float(d), 5) for d in dens],
                })

        return {
            "x": [round(float(v), 4) for v in x],
            "peak": peak,
            "bands": [{"label": b[2]} for b in VOLUME_BANDS],
            "types": RIDGELINE_TYPES,
            "cells": cells,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))