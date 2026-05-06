# ─────────────────────────────────────────────────────────────────────────────
# AI Service — Dockerfile
# Python 3.12 slim — minimal image, no ML frameworks in the stub.
# Phase 2 will add scikit-learn / tensorflow here.
# ─────────────────────────────────────────────────────────────────────────────

FROM python:3.12-slim AS base

# Security: non-root user
RUN addgroup --gid 1001 aigroup \
 && adduser  --uid 1001 --ingroup aigroup --disabled-password --no-create-home aiuser

WORKDIR /app

# Copy requirements first for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY src/ ./src/

RUN chown -R aiuser:aigroup /app
USER aiuser

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK \
  --interval=30s \
  --timeout=5s  \
  --start-period=20s \
  --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
