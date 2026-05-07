"""
Unit tests for the /predict endpoint — one test per attack class.
ai-service/tests/test_predict.py

These tests load the REAL model artifacts and call the endpoint directly
via FastAPI's TestClient (no mocking). They verify that known feature
vectors return the expected label with confidence > 0.8.

Feature vectors are extracted from actual NSL-KDD training rows that
the model classifies with 100% confidence during training.

Run:
    cd ai-service
    source .venv/bin/activate
    pytest tests/ -v
"""

import pytest
from fastapi.testclient import TestClient

from src.main import app


# ─────────────────────────────────────────────────────────────────────────────
# Test client fixture — loads model once for all tests
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    """
    Create a TestClient that triggers the lifespan (model loading).
    Shared across all tests in this module for performance.
    """
    with TestClient(app) as c:
        yield c


# ─────────────────────────────────────────────────────────────────────────────
# Known feature vectors — extracted from real NSL-KDD training rows
#
# These are verbatim rows from KDDTrain+.txt that the trained model
# classifies with 1.0 confidence. Using real data avoids flaky tests
# caused by synthetic vectors landing in decision boundary regions.
# ─────────────────────────────────────────────────────────────────────────────

# Normal: row 0 — FTP data transfer, clean host stats
NORMAL_FEATURES = {
    "duration": 0, "protocol_type": "tcp", "service": "ftp_data", "flag": "SF",
    "src_bytes": 491, "dst_bytes": 0, "land": 0, "wrong_fragment": 0,
    "urgent": 0, "hot": 0, "num_failed_logins": 0, "logged_in": 0,
    "num_compromised": 0, "root_shell": 0, "su_attempted": 0, "num_root": 0,
    "num_file_creations": 0, "num_shells": 0, "num_access_files": 0,
    "num_outbound_cmds": 0, "is_host_login": 0, "is_guest_login": 0,
    "count": 2, "srv_count": 2, "serror_rate": 0.0, "srv_serror_rate": 0.0,
    "rerror_rate": 0.0, "srv_rerror_rate": 0.0, "same_srv_rate": 1.0,
    "diff_srv_rate": 0.0, "srv_diff_host_rate": 0.0, "dst_host_count": 150,
    "dst_host_srv_count": 25, "dst_host_same_srv_rate": 0.17,
    "dst_host_diff_srv_rate": 0.03, "dst_host_same_src_port_rate": 0.17,
    "dst_host_srv_diff_host_rate": 0.0, "dst_host_serror_rate": 0.0,
    "dst_host_srv_serror_rate": 0.0, "dst_host_rerror_rate": 0.05,
    "dst_host_srv_rerror_rate": 0.0,
}

# DoS (neptune): row 2 — SYN flood, S0 flag, 100% serror_rate
DOS_FEATURES = {
    "duration": 0, "protocol_type": "tcp", "service": "private", "flag": "S0",
    "src_bytes": 0, "dst_bytes": 0, "land": 0, "wrong_fragment": 0,
    "urgent": 0, "hot": 0, "num_failed_logins": 0, "logged_in": 0,
    "num_compromised": 0, "root_shell": 0, "su_attempted": 0, "num_root": 0,
    "num_file_creations": 0, "num_shells": 0, "num_access_files": 0,
    "num_outbound_cmds": 0, "is_host_login": 0, "is_guest_login": 0,
    "count": 123, "srv_count": 6, "serror_rate": 1.0, "srv_serror_rate": 1.0,
    "rerror_rate": 0.0, "srv_rerror_rate": 0.0, "same_srv_rate": 0.05,
    "diff_srv_rate": 0.07, "srv_diff_host_rate": 0.0, "dst_host_count": 255,
    "dst_host_srv_count": 26, "dst_host_same_srv_rate": 0.1,
    "dst_host_diff_srv_rate": 0.05, "dst_host_same_src_port_rate": 0.0,
    "dst_host_srv_diff_host_rate": 0.0, "dst_host_serror_rate": 1.0,
    "dst_host_srv_serror_rate": 1.0, "dst_host_rerror_rate": 0.0,
    "dst_host_srv_rerror_rate": 0.0,
}

# PortScan (ipsweep): row 16 — ICMP sweep, high srv_diff_host_rate
PORTSCAN_FEATURES = {
    "duration": 0, "protocol_type": "icmp", "service": "eco_i", "flag": "SF",
    "src_bytes": 18, "dst_bytes": 0, "land": 0, "wrong_fragment": 0,
    "urgent": 0, "hot": 0, "num_failed_logins": 0, "logged_in": 0,
    "num_compromised": 0, "root_shell": 0, "su_attempted": 0, "num_root": 0,
    "num_file_creations": 0, "num_shells": 0, "num_access_files": 0,
    "num_outbound_cmds": 0, "is_host_login": 0, "is_guest_login": 0,
    "count": 1, "srv_count": 1, "serror_rate": 0.0, "srv_serror_rate": 0.0,
    "rerror_rate": 0.0, "srv_rerror_rate": 0.0, "same_srv_rate": 1.0,
    "diff_srv_rate": 0.0, "srv_diff_host_rate": 0.0, "dst_host_count": 1,
    "dst_host_srv_count": 16, "dst_host_same_srv_rate": 1.0,
    "dst_host_diff_srv_rate": 0.0, "dst_host_same_src_port_rate": 1.0,
    "dst_host_srv_diff_host_rate": 1.0, "dst_host_serror_rate": 0.0,
    "dst_host_srv_serror_rate": 0.0, "dst_host_rerror_rate": 0.0,
    "dst_host_srv_rerror_rate": 0.0,
}


# ─────────────────────────────────────────────────────────────────────────────
# Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestHealthEndpoint:
    """Verify the health endpoint reports model status."""

    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["mode"] == "inference"
        assert body["model"] == "RandomForest"


class TestPredictNormal:
    """Verify Normal traffic is classified correctly."""

    def test_normal_classification(self, client):
        resp = client.post("/predict", json={"features": NORMAL_FEATURES})
        assert resp.status_code == 200
        body = resp.json()
        assert body["attackType"] == "Normal"
        assert body["label"] == 1  # 0=DoS, 1=Normal, 2=PortScan
        assert body["confidence"] >= 0.8, (
            f"Normal confidence too low: {body['confidence']}"
        )

    def test_normal_response_shape(self, client):
        resp = client.post("/predict", json={"features": NORMAL_FEATURES})
        body = resp.json()
        assert "attackType" in body
        assert "confidence" in body
        assert "label" in body
        assert isinstance(body["confidence"], float)
        assert 0.0 <= body["confidence"] <= 1.0


class TestPredictDoS:
    """Verify DoS attacks are detected with high confidence."""

    def test_dos_classification(self, client):
        resp = client.post("/predict", json={"features": DOS_FEATURES})
        assert resp.status_code == 200
        body = resp.json()
        assert body["attackType"] == "DoS"
        assert body["label"] == 0  # 0=DoS
        assert body["confidence"] >= 0.8, (
            f"DoS confidence too low: {body['confidence']}"
        )


class TestPredictPortScan:
    """Verify PortScan attacks are detected with high confidence."""

    def test_portscan_classification(self, client):
        resp = client.post("/predict", json={"features": PORTSCAN_FEATURES})
        assert resp.status_code == 200
        body = resp.json()
        assert body["attackType"] == "PortScan"
        assert body["label"] == 2  # 2=PortScan
        assert body["confidence"] >= 0.8, (
            f"PortScan confidence too low: {body['confidence']}"
        )


class TestPredictEdgeCases:
    """Verify the endpoint handles edge cases gracefully."""

    def test_missing_features_defaults_to_zero(self, client):
        """Sending only a few features should still return a valid prediction."""
        partial = {
            "protocol_type": "tcp",
            "service": "http",
            "flag": "SF",
        }
        resp = client.post("/predict", json={"features": partial})
        assert resp.status_code == 200
        body = resp.json()
        assert body["attackType"] in ("Normal", "DoS", "PortScan", "Unknown")
        assert isinstance(body["confidence"], float)

    def test_empty_features_returns_prediction(self, client):
        """An empty features dict should not crash the endpoint."""
        resp = client.post("/predict", json={"features": {}})
        assert resp.status_code == 200
        body = resp.json()
        assert body["attackType"] in ("Normal", "DoS", "PortScan", "Unknown")

    def test_invalid_body_returns_422(self, client):
        """Sending no features key should return a validation error."""
        resp = client.post("/predict", json={"wrong_key": 123})
        assert resp.status_code == 422
