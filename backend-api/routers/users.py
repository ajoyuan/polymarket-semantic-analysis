import duckdb
from fastapi import APIRouter, Depends, HTTPException, Query
from db import get_db, DATA_SOURCES

router = APIRouter(prefix="/api/users", tags=["User"])

@router.get("/{market_id}/whales")
def get_market_whales(
    market_id: str,
    limit: int = Query(10, description="Number of top traders to return"),
    con: duckdb.DuckDBPyConnection = Depends(get_db)
):
    """
    Identify the top traders (whales) by USD volume in a specific market.
    Useful for bubble charts or proportional nodes in D3.
    """
    query = f"""
        SELECT 
            address,
            role,
            SUM(usd_amount) AS total_usd_volume,
            SUM(token_amount) AS total_tokens,
            AVG(price) AS avg_entry_price
        FROM read_parquet('{DATA_SOURCES["users"]}')
        WHERE market_id = '{market_id}'
        GROUP BY address, role
        ORDER BY total_usd_volume DESC
        LIMIT {limit}
    """
    
    try:
        df = con.execute(query).df()
        return {"whales": df.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{market_id}/role-distribution")
def get_role_distribution(
    market_id: str,
    con: duckdb.DuckDBPyConnection = Depends(get_db)
):
    """
    Analyze the volume distribution between Makers (liquidity providers) 
    and Takers (market consumers).
    """
    query = f"""
        SELECT 
            role,
            COUNT(DISTINCT address) AS unique_users,
            SUM(usd_amount) AS total_volume
        FROM read_parquet('{DATA_SOURCES["users"]}')
        WHERE market_id = '{market_id}'
        GROUP BY role
    """
    
    try:
        df = con.execute(query).df()
        return {"distribution": df.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))