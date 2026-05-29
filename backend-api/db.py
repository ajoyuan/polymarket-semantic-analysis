import duckdb
import logging
from pathlib import Path

# logging configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# connect to a DuckDB instance
con = duckdb.connect(database=':memory:', read_only=False)

BASE_DIR = Path(__file__).resolve().parent

DATA_SOURCES = {
    "markets": "https://huggingface.co/datasets/SII-WANGZJ/Polymarket_data/resolve/main/markets.parquet",
    "orderfilled1": "https://huggingface.co/datasets/SII-WANGZJ/Polymarket_data/resolve/main/orderfilled1.parquet",
    "orderfilled2": "https://huggingface.co/datasets/SII-WANGZJ/Polymarket_data/resolve/main/orderfilled2.parquet",
    "quant": "https://huggingface.co/datasets/SII-WANGZJ/Polymarket_data/resolve/main/quant.parquet",
    "trades": "https://huggingface.co/datasets/SII-WANGZJ/Polymarket_data/resolve/main/trades.parquet",
    "users": "https://huggingface.co/datasets/SII-WANGZJ/Polymarket_data/resolve/main/users.parquet",
    "markets_classified_with_event_tags": str(BASE_DIR / "data" / "markets_classified_with_event_tags.parquet"),
    "dashboard_catalog": str(BASE_DIR / "data" / "dashboard_catalog.parquet"),
    "dashboard_timeseries": str(BASE_DIR / "data" / "dashboard_timeseries.parquet")
}

def init_db():
    """
    database initialization function. 
    """
    logger.info("Initializing DuckDB and loading httpfs extension...")
    try:
        con.execute("INSTALL httpfs;")
        con.execute("LOAD httpfs;")
        
        # metadata cache
        con.execute("SET enable_http_metadata_cache=true;") 
        
        logger.info("DuckDB initialized successfully with httpfs.")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise e

def get_db():

    return con