import duckdb
from fastapi import APIRouter, Depends, HTTPException
from db import get_db, DATA_SOURCES

# Create a router
router = APIRouter(prefix="/api/markets",tags=["Markets"])

@router.get("/summary")
def get_market_summary(con: duckdb.DuckDBPyConnection = Depends(get_db)):
    """
    Get high-level summary for markets
    """
    query = f"""
        SELECT 
            predicted_label,
            COUNT(*) as total_count,
            SUM(volume) as total_volume,
            AVG(volume) as avg_volume
        FROM read_parquet('{DATA_SOURCES["markets_classified_with_event_tags"]}')
        GROUP BY predicted_label
    """
    try:
        df = con.execute(query).df()
        return {"summary": df.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/top-volume")
def get_top_markets(limit: int = 10, con: duckdb.DuckDBPyConnection = Depends(get_db)):
    """
    Fetch the highest-volume markets for macro dashboard insights
    """
    query = f"""
        SELECT 
            id, 
            predicted_label,
            question, 
            event_title, 
            volume, 
            closed, 
            created_at
        FROM read_parquet('{DATA_SOURCES["markets_classified_with_event_tags"]}')
        ORDER BY volume DESC
        LIMIT {limit}
    """
    try:
        df = con.execute(query).df()
        if 'created_at' in df.columns:
            df['created_at'] = df['created_at'].astype(str)
            
        return {"markets": df.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/search")
def search_markets(keyword: str, con: duckdb.DuckDBPyConnection = Depends(get_db)):
    """
    Search markets by keywords in the question or event title
    """
    query = f"""
        SELECT id, predicted_label, question, event_title, volume
        FROM read_parquet('{DATA_SOURCES["markets_classified_with_event_tags"]}')
        WHERE question ILIKE '%{keyword}%' 
           OR event_title ILIKE '%{keyword}%'
        ORDER BY volume DESC
        LIMIT 50
    """
    try:
        df = con.execute(query).df()
        return {"results": df.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))