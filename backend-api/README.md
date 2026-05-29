# Backend

A FastAPI-based backend service for analyzing Polymarket data and data visualization.

## Instruction

### Setup

1. Clone the repository and navigate to the backend directory
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the FastAPI server:

    ```bash
    uvicorn main:app --reload
    ```
    API Docs will be available at: http://localhost:8000/docs


## Project Structure

```
backend-api/
├── main.py              
├── db.py                # database connection
├── requirements.txt     
└── routers/
    ├── dashboard.py     # Dashboard endpoints
    ├── markets.py       # Market analysis endpoints
    ├── trades.py        # Time-series trade data endpoints
    └── users.py         # User behavior analytics endpoints

```
  **Framework**: [FastAPI](https://fastapi.tiangolo.com/) 0.136.1  
  **Database**: [DuckDB](https://duckdb.org/) 1.5.2 with httpfs extension  
  **Server**: [Uvicorn](https://www.uvicorn.org/) 0.47.0
