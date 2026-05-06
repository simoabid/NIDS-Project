"""
Pydantic schemas — request/response contracts for the AI service.
Keep in sync with backend/src/types/events.ts (AlertPayload).
"""

from typing import Literal
from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    """
    Features extracted from a single network flow.
    Field names mirror the CICIDS2017 dataset columns used for training.
    """
    sourceIp:        str   = Field(..., description="Source IP address")
    destinationIp:   str   = Field(..., description="Destination IP address")
    sourcePort:      int   = Field(..., ge=0, le=65535)
    destinationPort: int   = Field(..., ge=0, le=65535)
    protocol:        str   = Field(..., description="e.g. TCP, UDP, ICMP")
    packetSize:      int   = Field(..., ge=0, description="Bytes")
    # Phase 2: add flow-level features (duration, flags, byte rates, etc.)
    # duration:      float = 0.0
    # flowBytes:     float = 0.0
    # flowPackets:   float = 0.0


class PredictResponse(BaseModel):
    """Mirrors the AlertPayload interface on the frontend."""
    attackType:  Literal["Normal", "DoS", "PortScan", "Unknown"]
    confidence:  float = Field(..., ge=0.0, le=1.0)
    label:       int   = Field(..., description="0=Normal 1=Attack")


class HealthResponse(BaseModel):
    status:    str
    timestamp: float
    mode:      str
