"""
AI Service — FastAPI inference server
src/main.py

Loads trained model artifacts at startup, exposes /predict for real-time
network traffic classification (Normal / DoS / PortScan), and runs an
async Redis Streams consumer as a background task.

Model artifacts (must exist in ai-service/model/):
  ├── classifier.pkl        # trained Random Forest
  ├── scaler.pkl            # fitted ColumnTransformer (OHE + StandardScaler)
  ├── label_encoder.pkl     # LabelEncoder: 0=DoS, 1=Normal, 2=PortScan
  └── feature_columns.json  # ordered feature names

Data flow:
  traffic:raw (Redis Stream) → consumer → predict → alerts (Pub/Sub) → Backend
"""

import os
import asyncio
import time
import json
import logging
from pathlib import Path
from contextlib import asynccontextmanager

import numpy as np
import pandas as pd
import joblib
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

from .schemas import PredictRequest, PredictResponse
from .consumer import RedisConsumer

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("ai-service")

# ── Config ────────────────────────────────────────────────────────────────────
MODEL_DIR = Path(os.getenv("MODEL_DIR", Path(__file__).resolve().parent.parent / "model"))
REDIS_URL = os.getenv("REDIS_URL", "")

# ── Global model references (loaded once at startup) ─────────────────────────
_classifier: RandomForestClassifier | None = None
_scaler: ColumnTransformer | None = None
_label_encoder: LabelEncoder | None = None
_feature_columns: list[str] | None = None

# ── Global consumer reference ────────────────────────────────────────────────
_consumer: RedisConsumer | None = None
_consumer_task: asyncio.Task | None = None


def _load_model_artifacts() -> None:
    """Load all 4 model artifacts from MODEL_DIR into module-level globals."""
    global _classifier, _scaler, _label_encoder, _feature_columns

    logger.info("Loading model artifacts from %s", MODEL_DIR)

    classifier_path = MODEL_DIR / "classifier.pkl"
    scaler_path = MODEL_DIR / "scaler.pkl"
    le_path = MODEL_DIR / "label_encoder.pkl"
    features_path = MODEL_DIR / "feature_columns.json"

    # Validate all files exist before loading any
    for p in [classifier_path, scaler_path, le_path, features_path]:
        if not p.exists():
            raise FileNotFoundError(
                f"Missing model artifact: {p}. "
                "Run `python -m src.train` before starting the server."
            )

    t0 = time.perf_counter()

    _classifier = joblib.load(classifier_path)
    logger.info("  ✓ classifier.pkl  (%d estimators, %d features)",
                _classifier.n_estimators, _classifier.n_features_in_)

    _scaler = joblib.load(scaler_path)
    logger.info("  ✓ scaler.pkl")

    _label_encoder = joblib.load(le_path)
    logger.info("  ✓ label_encoder.pkl  (classes: %s)", list(_label_encoder.classes_))

    with open(features_path) as f:
        meta = json.load(f)
    _feature_columns = meta["all_features"]
    logger.info("  ✓ feature_columns.json  (%d features)", len(_feature_columns))

    elapsed = time.perf_counter() - t0
    logger.info("All artifacts loaded in %.2fs", elapsed)


# ── App lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """
    Load model at startup, start Redis consumer, clean up on shutdown.

    The consumer runs as a background asyncio task so it doesn't block
    the FastAPI event loop. If REDIS_URL is not configured, the consumer
    is skipped (the /predict endpoint still works for direct HTTP calls).
    """
    global _consumer, _consumer_task

    # ── Startup ──────────────────────────────────────────────────────────────
    _load_model_artifacts()
    logger.info("🤖  AI service ready — inference mode")

    # Start Redis consumer if REDIS_URL is configured
    if REDIS_URL:
        logger.info("Starting Redis Streams consumer...")
        logger.info("    Redis URL : %s", REDIS_URL)
        try:
            _consumer = RedisConsumer(REDIS_URL)
            await _consumer.connect()
            _consumer_task = asyncio.create_task(
                _consumer.run(),
                name="redis-consumer",
            )
            logger.info("✅ Redis consumer started as background task")
        except Exception as e:
            logger.error("❌ Failed to start Redis consumer: %s", e)
            logger.warning("   The /predict endpoint is still available for direct HTTP calls")
            _consumer = None
            _consumer_task = None
    else:
        logger.warning("REDIS_URL not configured — consumer disabled")
        logger.info("   The /predict endpoint is available for direct HTTP calls")

    yield  # ── Application is running ────────────────────────────────────────

    # ── Shutdown ─────────────────────────────────────────────────────────────
    if _consumer_task and not _consumer_task.done():
        logger.info("Cancelling Redis consumer task...")
        _consumer_task.cancel()
        try:
            await _consumer_task
        except asyncio.CancelledError:
            pass

    if _consumer:
        await _consumer.close()

    logger.info("AI service shut down")


app = FastAPI(
    title="NIDS AI Service",
    description="Inference microservice — classifies network traffic as Normal, DoS, or PortScan",
    version="0.2.0",
    lifespan=lifespan,
)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Health check — used by Docker and the backend's AI_SERVICE_URL probe."""
    model_loaded = _classifier is not None
    consumer_stats = _consumer.stats if _consumer else None
    return {
        "status": "ok",
        "timestamp": time.time(),
        "mode": "inference" if model_loaded else "no-model",
        "model": "RandomForest" if model_loaded else None,
        "consumer": consumer_stats,
    }


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest) -> PredictResponse:
    """
    Classify a single network flow.

    Accepts a dict of raw NSL-KDD features, applies the fitted scaler
    (OneHotEncoder + StandardScaler), runs the Random Forest classifier,
    and returns the predicted class with confidence score.
    """
    if _classifier is None or _scaler is None or _label_encoder is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        # ── 1. Build a single-row DataFrame with correct column order ────────
        row = {}
        for col in _feature_columns:
            val = request.features.get(col)
            if val is None:
                row[col] = 0
            else:
                row[col] = val

        df = pd.DataFrame([row], columns=_feature_columns)

        # ── 2. Transform through the fitted scaler ───────────────────────────
        X = _scaler.transform(df)

        # ── 3. Predict class and confidence ──────────────────────────────────
        pred_int = _classifier.predict(X)[0]
        proba = _classifier.predict_proba(X)[0]
        confidence = float(np.max(proba))

        # ── 4. Decode integer label → string ─────────────────────────────────
        attack_type = _label_encoder.inverse_transform([pred_int])[0]

        logger.debug(
            "Prediction: %s (%.2f%%) — probas: %s",
            attack_type, confidence * 100,
            {_label_encoder.inverse_transform([i])[0]: f"{p:.3f}" for i, p in enumerate(proba)},
        )

        return PredictResponse(
            attackType=attack_type,
            confidence=round(confidence, 4),
            label=int(pred_int),
        )

    except Exception as e:
        logger.exception("Prediction failed: %s", e)
        return PredictResponse(
            attackType="Unknown",
            confidence=0.0,
            label=-1,
        )


@app.exception_handler(Exception)
async def global_exception_handler(_request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})
