"""
Redis Streams Consumer — async background task
ai-service/src/consumer.py

Reads raw network flow features from the 'traffic:raw' Redis Stream,
runs each flow through the ML classifier, and publishes results to the
'alerts' Redis Pub/Sub channel for the backend to pick up.

Data flow:
  Zeek/Suricata → traffic:raw (Redis Stream)
                → AI Service (this consumer) → predict()
                → alerts (Redis Pub/Sub channel)
                → Backend (subscriber) → Socket.io → Frontend

The consumer runs as an asyncio background task inside the FastAPI
process, started via the lifespan context manager in main.py.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any

import numpy as np
import pandas as pd
import redis.asyncio as aioredis

logger = logging.getLogger("ai-service.consumer")

# ── Stream / channel names ────────────────────────────────────────────────────
STREAM_KEY = os.getenv("REDIS_STREAM_KEY", "traffic:raw")
ALERT_CHANNEL = os.getenv("REDIS_ALERT_CHANNEL", "alerts")
CONSUMER_GROUP = os.getenv("REDIS_CONSUMER_GROUP", "ai-consumers")
CONSUMER_NAME = os.getenv("REDIS_CONSUMER_NAME", f"ai-worker-{os.getpid()}")

# How many messages to read per XREADGROUP call
BATCH_SIZE = int(os.getenv("REDIS_BATCH_SIZE", "10"))

# Block for this many ms waiting for new messages (0 = forever)
BLOCK_MS = int(os.getenv("REDIS_BLOCK_MS", "2000"))


class RedisConsumer:
    """
    Async Redis Streams consumer for the AI service.

    Reads raw flow features, runs inference via module-level model globals
    from main.py, and publishes alert payloads to the 'alerts' Pub/Sub channel.
    """

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._redis: aioredis.Redis | None = None
        self._running = False
        self._processed = 0
        self._errors = 0

    async def connect(self) -> None:
        """Establish async Redis connection."""
        self._redis = aioredis.from_url(
            self._redis_url,
            decode_responses=True,
            socket_connect_timeout=10,
            retry_on_timeout=True,
        )
        # Verify connection
        await self._redis.ping()
        logger.info("Redis consumer connected to %s", self._redis_url)

    async def close(self) -> None:
        """Close Redis connection."""
        self._running = False
        if self._redis:
            await self._redis.aclose()
            logger.info(
                "Redis consumer disconnected (processed: %d, errors: %d)",
                self._processed, self._errors,
            )

    async def _ensure_consumer_group(self) -> None:
        """Create the consumer group if it doesn't exist."""
        try:
            await self._redis.xgroup_create(
                STREAM_KEY, CONSUMER_GROUP,
                id="0",        # read from beginning
                mkstream=True, # create the stream if it doesn't exist
            )
            logger.info(
                "Created consumer group '%s' on stream '%s'",
                CONSUMER_GROUP, STREAM_KEY,
            )
        except aioredis.ResponseError as e:
            if "BUSYGROUP" in str(e):
                # Group already exists — that's fine
                logger.debug("Consumer group '%s' already exists", CONSUMER_GROUP)
            else:
                raise

    async def run(self) -> None:
        """
        Main consumer loop — reads from the stream and processes messages.

        This method runs indefinitely until self._running is set to False
        or the task is cancelled.
        """
        if not self._redis:
            raise RuntimeError("Call connect() before run()")

        await self._ensure_consumer_group()
        self._running = True

        logger.info(
            "Consumer started — stream: %s, group: %s, consumer: %s",
            STREAM_KEY, CONSUMER_GROUP, CONSUMER_NAME,
        )

        while self._running:
            try:
                # Read new messages (> = only undelivered messages)
                messages = await self._redis.xreadgroup(
                    groupname=CONSUMER_GROUP,
                    consumername=CONSUMER_NAME,
                    streams={STREAM_KEY: ">"},
                    count=BATCH_SIZE,
                    block=BLOCK_MS,
                )

                if not messages:
                    continue  # block timeout — no new messages

                for stream_name, entries in messages:
                    for msg_id, data in entries:
                        await self._process_message(msg_id, data)

            except asyncio.CancelledError:
                logger.info("Consumer task cancelled — shutting down")
                break
            except aioredis.ConnectionError as e:
                logger.error("Redis connection lost: %s — retrying in 5s", e)
                self._errors += 1
                await asyncio.sleep(5)
            except Exception as e:
                logger.exception("Unexpected consumer error: %s", e)
                self._errors += 1
                await asyncio.sleep(1)

    async def _process_message(
        self, msg_id: str, data: dict[str, Any]
    ) -> None:
        """
        Process a single message from the stream.

        Expected message fields:
          - All 41 NSL-KDD features (key=feature_name, value=str)
          - Optional metadata: sourceIp, destinationIp, sourcePort,
            destinationPort, protocol, packetSize
        """
        # Import model globals from main (avoids circular import at module level)
        from .main import _classifier, _scaler, _label_encoder, _feature_columns

        if _classifier is None or _scaler is None or _label_encoder is None:
            logger.warning("Model not loaded — skipping message %s", msg_id)
            # ACK the message so it doesn't pile up
            await self._redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
            return

        try:
            t0 = time.perf_counter()

            # ── 1. Extract features ──────────────────────────────────────────
            # Categorical columns need string defaults — the OneHotEncoder
            # crashes with TypeError('isnan') if it receives numeric types.
            CATEGORICAL_DEFAULTS = {
                "protocol_type": "tcp",
                "service": "other",
                "flag": "SF",
            }

            row: dict[str, Any] = {}
            for col in _feature_columns:
                raw = data.get(col)
                if col in CATEGORICAL_DEFAULTS:
                    # Must stay as string for the OneHotEncoder
                    if raw is None or raw == "" or raw == "0":
                        row[col] = CATEGORICAL_DEFAULTS[col]
                    else:
                        row[col] = str(raw)
                else:
                    if raw is None:
                        row[col] = 0
                    else:
                        try:
                            row[col] = float(raw)
                        except (ValueError, TypeError):
                            row[col] = 0

            df = pd.DataFrame([row], columns=_feature_columns)

            # ── 2. Scale + predict ───────────────────────────────────────────
            X = _scaler.transform(df)
            pred_int = _classifier.predict(X)[0]
            proba = _classifier.predict_proba(X)[0]
            confidence = float(np.max(proba))
            attack_type = str(_label_encoder.inverse_transform([pred_int])[0])

            elapsed_ms = (time.perf_counter() - t0) * 1000

            # ── 3. Build alert payload (matches backend AlertPayload) ────────
            alert_payload = {
                "id": data.get("id", str(uuid.uuid4())),
                "sourceIp": data.get("sourceIp", "0.0.0.0"),
                "destinationIp": data.get("destinationIp", "0.0.0.0"),
                "sourcePort": int(data.get("sourcePort", 0)),
                "destinationPort": int(data.get("destinationPort", 0)),
                "protocol": data.get("protocol", "TCP"),
                "attackType": attack_type,
                "confidence": round(confidence, 4),
                "packetSize": int(data.get("packetSize", 0)),
                "timestamp": data.get("timestamp", _iso_now()),
            }

            # ── 4. Publish to alerts channel ─────────────────────────────────
            await self._redis.publish(
                ALERT_CHANNEL,
                json.dumps(alert_payload),
            )

            # ── 5. Acknowledge the message ───────────────────────────────────
            await self._redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)
            self._processed += 1

            # Log attacks at INFO level, normal traffic at DEBUG
            if attack_type != "Normal":
                logger.info(
                    "🚨 %s detected (%.1f%%) — %s:%s → %s:%s [%.1fms]",
                    attack_type, confidence * 100,
                    alert_payload["sourceIp"], alert_payload["sourcePort"],
                    alert_payload["destinationIp"], alert_payload["destinationPort"],
                    elapsed_ms,
                )
            else:
                logger.debug(
                    "✓ Normal (%.1f%%) — %s → %s [%.1fms]",
                    confidence * 100,
                    alert_payload["sourceIp"],
                    alert_payload["destinationIp"],
                    elapsed_ms,
                )

        except Exception as e:
            logger.exception("Failed to process message %s: %s", msg_id, e)
            self._errors += 1
            # ACK anyway to prevent infinite retry on malformed messages
            await self._redis.xack(STREAM_KEY, CONSUMER_GROUP, msg_id)

    @property
    def stats(self) -> dict[str, Any]:
        """Return consumer statistics."""
        return {
            "processed": self._processed,
            "errors": self._errors,
            "running": self._running,
            "stream": STREAM_KEY,
            "group": CONSUMER_GROUP,
            "consumer": CONSUMER_NAME,
        }


def _iso_now() -> str:
    """Return current UTC time in ISO 8601 format."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
