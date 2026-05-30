
from fastapi import FastAPI
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware # <-- 1. ADD THIS IMPORT
from db import init_db, get_db
from routers.markets import router as market_router
from routers.trades import router as trades_router
from routers.users import router as users_router
from routers.dashboard import router as dashboard_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield
    print("Shutting down backend...")

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# register routers
app.include_router(market_router)
app.include_router(trades_router)
app.include_router(users_router)
app.include_router(dashboard_router)

@app.get("/")
def root():
    return {"message": "Polymarket Visual Analytics API is running"}