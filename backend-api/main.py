from fastapi import FastAPI
from contextlib import asynccontextmanager
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

# register routers
app.include_router(market_router)
app.include_router(trades_router)
app.include_router(users_router)
app.include_router(dashboard_router)

@app.get("/")
def root():
    return {"message": "Polymarket Visual Analytics API is running"}