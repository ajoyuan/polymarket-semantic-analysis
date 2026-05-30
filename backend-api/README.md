# Backend

A FastAPI-based backend service for analyzing Polymarket data and data visualization.

## Instruction

### Setup Backend

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

### Setup Frontend
### 1. Open the Project
Open the Frontend project folder in your preferred code editor (I used Visual Studio Code).

### 2. Open the Terminal
Open an integrated Bash terminal at the root of the project directory (ajoyuan). 

To do so, create a new terminal and ensure "bash" is selected in the terminal dropdown.

### 3. Ensure all necessary packages are installed
Enter the following command into the bash terminal:

npm install

### 4. Run the Application
Run the following command in the bash terminal to start the Vite development server:

npm run dev

### 5. Access the website
A link should appear in the terminal. 

example link: http://localhost:5173/

Copy paste the link into your browser or use crtl + click to directly open the link.

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

frontend/
├── main.jsx              
├── App.jsx                
└── routers/
    ├── DashboardHeader.py     # Frontpage
    ├── DualAxisChart.py       # Time-series trade data and z-score
    ├── KPIGrid.py             # Tracks Max-zscore, total transactions, ARIMAX coefficient, and lifespan of market anomalies
    └── SankeyChart.py         # Global market distribution vizualization

```
  **Framework**: [FastAPI](https://fastapi.tiangolo.com/) 0.136.1  
  **Database**: [DuckDB](https://duckdb.org/) 1.5.2 with httpfs extension  
  **Server**: [Uvicorn](https://www.uvicorn.org/) 0.47.0
