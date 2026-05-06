"""
AI Service — FastAPI stub
src/main.py

Phase 1: Returns a fixed "Normal" prediction so the full stack boots.
Phase 2: Replace predict() body with real model inference via predictor.py.

Redis Streams consumer (also Phase 2):
  - XREAD from 'stream:packets'
  - Run predictor.predict(features)
  - XADD to 'stream:alerts'
"""

import os
import time
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .schemas import PredictRequest, PredictResponse

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("ai-service")

# ── App lifecycle ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("🤖  AI service starting (stub mode — no model loaded)")
    logger.info("    Redis URL : %s", os.getenv("REDIS_URL", "not configured"))
    yield
    logger.info("AI service shutting down")


app = FastAPI(
    title="NIDS AI Service",
    description="Inference microservice — classifies network traffic as Normal or Attack",
    version="0.1.0",
    lifespan=lifespan,
)

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Health check — used by Docker and the backend's AI_SERVICE_URL probe."""
    return {"status": "ok", "timestamp": time.time(), "mode": "stub"}


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    """
    Classify a single flow of network traffic.

    Phase 1 stub: always returns 'Normal' with 1.0 confidence.
    Phase 2: load model in lifespan, call predictor.predict(request.features).
    """
    logger.debug("Received predict request: %s", request)

    # TODO Phase 2: replace with real inference
    # from .predictor import predict as run_model
    # return run_model(request)

    return PredictResponse(
        attackType="Normal",
        confidence=1.0,
        label=0,
    )


@app.exception_handler(Exception)
async def global_exception_handler(_request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})
