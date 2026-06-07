# Polymarket Semantic Analysis

A visual-analytics dashboard for studying [Polymarket](https://polymarket.com) prediction
markets through the lens of **semantic market types**. Every market is classified by a
fine-tuned RoBERTa model into one of three behavioral categories — **Stochastic**,
**Objective Outcome**, and **Decision-Agent** — and the dashboard lets you explore how
those types differ in trading dynamics, crowd consensus, volatility, and how *certain* the
market ultimately became about its outcome.

## Description

This project has three parts:

1. **`backend/` — the ML / data pipeline (offline).** A set of Python scripts that take the
   raw Polymarket dataset (hosted on Hugging Face: `SII-WANGZJ/Polymarket_data`), train and
   run a `roberta-large` classifier to label each market by type, enrich markets with event
   tags from the Polymarket Gamma API, and compute per-market **certainty scores**
   (TWAP/VWAP/last-price weighted). It produces the Parquet files that the serving layer
   reads, plus a gallery of static analysis plots under `backend/results/`.

2. **`backend-api/` — the serving API (online).** A [FastAPI](https://fastapi.tiangolo.com/)
   application backed by an in-memory [DuckDB](https://duckdb.org/) engine. DuckDB queries
   the pipeline's Parquet outputs directly (locally) and, for some endpoints, the original
   dataset on Hugging Face over HTTP (via the `httpfs` extension). It exposes JSON endpoints
   under `/api/dashboard`, `/api/markets`, `/api/trades`, and `/api/users`.

3. **`frontend/` — the dashboard (UI).** A [React 19](https://react.dev/) +
   [Vite](https://vitejs.dev/) single-page app that visualizes the API data with
   [D3](https://d3js.org/): a Sankey flow of market category → predicted type, a KPI grid
   (transactions, ARIMAX impact, max z-score, lifespan anomaly, TWAP certainty), a dual-axis
   price/z-score time series, and a certainty-vs-volume ridgeline plot.

The dashboard reads from the API at `http://localhost:8000`. The API reads from local
Parquet files in `backend-api/data/`. The Daata pipeline (`backend/`) is what *generates* those
Parquet files; you only need to run it if you want to regenerate the data from scratch — the
prebuilt Parquet files are already checked in under `backend-api/data/`.


## Installation

### Prerequisites

- **Python 3.10+** (the pipeline uses `transformers` / `torch`; a GPU is recommended for
  training but not required for serving)
- **Node.js 18+** and npm

### Backend API Data (`backend-api/`) — required to serve the dashboard

📦 **Download Data Here** - [Link](https://ucdavis.box.com/s/eu3d52knd8kzyqjfpxse1ec1n94mdog2)

These local Parquet files must exist in `backend-api/data/` (~1.1 GB total):

| File | Size | Used by | Purpose |
|------|------|---------|---------|
| `dashboard_catalog.parquet` | ~2.4 MB | `/api/dashboard/catalog` | List of markets shown in the dashboard selector |
| `dashboard_timeseries.parquet` | ~703 MB | `/api/dashboard/timeseries` | Per-market price / z-score time series |
| `market_uncertainty.parquet` | ~88 MB | `/api/dashboard/uncertainty`, `/certainty_volume_ridgeline` | TWAP/VWAP/last-price certainty scores per market |
| `markets_classified_with_event_tags.parquet` | ~342 MB | `/api/markets/*` | Classified markets enriched with event tags |

### 1. Backend API

Dependencies for both the API and the Data pipeline live in a single `requirements.txt`
at the project root.

```bash
python -m venv .venv && source .venv/bin/activate    # optional but recommended
pip install -r requirements.txt
```

Key dependencies: FastAPI 0.136, Uvicorn 0.47, DuckDB 1.5, pandas, numpy.

### 2. Frontend

```bash
cd frontend
npm install
```

Key dependencies: React 19, Vite 6, d3 / d3-sankey, tailwindcss.

## Development

### Run the demo (API + dashboard)

**Start the API** (serves on `http://localhost:8000`):

```bash
cd backend-api
uvicorn main:app --reload
```

Verify it is up: open <http://localhost:8000/docs> for the interactive Swagger UI, or
<http://localhost:8000/> which returns `{"message": "Polymarket Visual Analytics API is running"}`.

**Start the dashboard** (serves on `http://localhost:5173`):

```bash
cd frontend
npm run dev
```

Open the printed URL (e.g. <http://localhost:5173/>) in your browser. The dashboard loads
the market catalog from the API, and you can:

- Switch between the **Macro** and **Certainty vs Volume** tabs.
- Click nodes/links in the **Sankey** chart to filter by market category or predicted type
  (click again to unselect).
- Select a market to view its **time series** and **KPI** cards, including the TWAP
  certainty score.
- Inspect the **ridgeline** plot of certainty distributions across traded-volume bands.


### Data pipeline (`backend/`) (optional)

📦 **Download Data Here** - [Link](https://ucdavis.box.com/s/v7teax2zcngecx4ollh217fzqczysih3)

Unzip the data into `backend/data/`.

| Input | Notes |
|-------|-------|
| `SII-WANGZJ/Polymarket_data` (Hugging Face) | Raw markets, trades, quant, and users Parquet files — downloaded automatically by the scripts |
| `backend/data/polymarket_training_dataset.csv` | Labeled CSV used to train the classifier (`train.py`) |
| `backend/data/polymarket_dataset_test.csv` | Labeled CSV used to test the classifier (`test.py`) |
| Polymarket Gamma API (`gamma-api.polymarket.com`) | Live source for event tags (`fetch_event_tags.py`) |


Run from the `backend/src/` directory. Each script reads/writes Parquet under `backend/data/`:

```bash
cd backend/src

python train.py                          # train roberta-large classifier -> backend/models/
python classify_markets.py                # label every market -> markets_classified.parquet
python fetch_event_tags.py                # enrich with Gamma event tags
python calculate_uncertainty_with_tags.py # compute certainty scores -> market_uncertainty.parquet
python process_zscore_and_volatility.py   # compute z-score and volatility time series -> dashboard_timeseries.parquet, dashboard_catalog.parquet
```

After regenerating, copy the relevant outputs from `backend/data/` into `backend-api/data/`
so the API serves the new data.

## Project structure

```
.
├── backend/            # offline ML + data pipeline
│   ├── src/            # train, classify, fetch tags, compute certainty, plotting
│   ├── data/           # pipeline inputs/outputs (Parquet, CSV)
│   ├── models/         # fine-tuned roberta-large checkpoints
│   └── results/        # static plots + classification summaries
├── backend-api/        # FastAPI + DuckDB serving layer
│   ├── main.py         # app entry + CORS + router registration
│   ├── db.py           # DuckDB connection + DATA_SOURCES (local + HF)
│   ├── data/           # Parquet files served to the dashboard
│   └── routers/        # dashboard / markets / trades / users endpoints
└── frontend/           # React + Vite + D3 dashboard
    └── src/
        ├── App.jsx
        └── components/ # KPIGrid, SankeyChart, Timelinechart, CertaintyVolumeRidgeline, DashboardHeader
```
