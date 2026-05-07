"""
Pydantic schemas — request/response contracts for the AI service.
Keep in sync with backend/src/types/events.ts (AlertPayload).
"""

from typing import Literal
from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    """
    Raw features for a single network flow.

    The `features` dict maps NSL-KDD feature names to numeric values.
    Column alignment, scaling, and encoding are handled server-side
    so the caller doesn't need to know the model's internal feature order.

    Example:
        {
            "features": {
                "duration": 0,
                "protocol_type": "tcp",
                "service": "http",
                "flag": "SF",
                "src_bytes": 215,
                "dst_bytes": 45076,
                ...
            }
        }
    """
    features: dict[str, float | int | str] = Field(
        ...,
        description="Key-value map of raw NSL-KDD feature names to their values. "
                    "Categorical features (protocol_type, service, flag) are strings; "
                    "all others are numeric.",
    )


class PredictResponse(BaseModel):
    """Mirrors the AlertPayload interface on the frontend."""
    attackType:  Literal["Normal", "DoS", "PortScan", "Unknown"]
    confidence:  float = Field(..., ge=0.0, le=1.0)
    label:       int   = Field(..., description="0=DoS, 1=Normal, 2=PortScan")


class HealthResponse(BaseModel):
    status:    str
    timestamp: float
    mode:      str
    model:     str | None = None
