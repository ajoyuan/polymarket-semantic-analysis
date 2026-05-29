import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query
from db import get_db, DATA_SOURCES

router = APIRouter(prefix="/api/trades", tags=["Trades"])

@router.get("/{market_id}/timeseries")
def get_market_timeseries(
    market_id: str,
    interval: str = Query("1 hour", description="Time interval: '15 minute', '1 hour', '1 day'"),
    con: duckdb.DuckDBPyConnection = Depends(get_db)
):
    """
    Fetch time-series data for a specific market.
    """

    query = f"""
        SELECT 
            time_bucket(INTERVAL '{interval}', to_timestamp(timestamp)) AS time_window,
            AVG(price) AS avg_price,
            MIN(price) AS min_price,
            MAX(price) AS max_price,
            SUM(usd_amount) AS total_volume,
            COUNT(*) AS transaction_count
        FROM read_parquet('{DATA_SOURCES["quant"]}')
        WHERE market_id = '{market_id}'
        GROUP BY time_window
        ORDER BY time_window ASC
    """
    
    try:
        df = con.execute(query).df()
        df['time_window'] = df['time_window'].astype(str)
        
        return {
            "market_id": market_id,
            "interval": interval,
            "data_points": len(df),
            "series": df.to_dict(orient="records")
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))