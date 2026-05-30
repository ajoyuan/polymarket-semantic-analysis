import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query
from db import get_db, DATA_SOURCES
from typing import Optional
import pandas as pd

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