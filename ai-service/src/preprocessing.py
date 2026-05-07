"""
NSL-KDD Preprocessing Pipeline
ai-service/src/preprocessing.py

Responsibilities:
  1. Map 23 fine-grained NSL-KDD labels → 3 classes (Normal / DoS / PortScan)
  2. Build a scikit-learn ColumnTransformer pipeline:
     - OneHotEncode categoricals (protocol_type, service, flag)
     - StandardScale continuous + binary features
  3. Fit a LabelEncoder for consistent integer ↔ string label conversion
  4. Provide fit / transform / save / load for training and inference

This module is imported by both the training script and the FastAPI
inference service, ensuring identical preprocessing in both paths.

Model artifacts produced (saved to ai-service/model/):
  ├── classifier.pkl        # the trained Random Forest (saved by train.py)
  ├── scaler.pkl            # fitted ColumnTransformer (OHE + StandardScaler)
  ├── label_encoder.pkl     # LabelEncoder: 0=DoS, 1=Normal, 2=PortScan
  └── feature_columns.json  # ordered list of feature names (commit this)
"""

from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler, LabelEncoder

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# 1. CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

# Alphabetical order — matches sklearn LabelEncoder default sort
# 0=DoS, 1=Normal, 2=PortScan
CLASS_NAMES: list[str] = ["DoS", "Normal", "PortScan"]
NUM_CLASSES: int = len(CLASS_NAMES)

# 41 original NSL-KDD feature columns (no label, no difficulty_level)
FEATURE_NAMES: list[str] = [
    "duration", "protocol_type", "service", "flag",
    "src_bytes", "dst_bytes", "land", "wrong_fragment", "urgent",
    "hot", "num_failed_logins", "logged_in", "num_compromised",
    "root_shell", "su_attempted", "num_root", "num_file_creations",
    "num_shells", "num_access_files", "num_outbound_cmds",
    "is_host_login", "is_guest_login",
    "count", "srv_count", "serror_rate", "srv_serror_rate",
    "rerror_rate", "srv_rerror_rate", "same_srv_rate", "diff_srv_rate",
    "srv_diff_host_rate",
    "dst_host_count", "dst_host_srv_count", "dst_host_same_srv_rate",
    "dst_host_diff_srv_rate", "dst_host_same_src_port_rate",
    "dst_host_srv_diff_host_rate", "dst_host_serror_rate",
    "dst_host_srv_serror_rate", "dst_host_rerror_rate",
    "dst_host_srv_rerror_rate",
]

# Categorical columns → one-hot encoded
CATEGORICAL_COLS: list[str] = ["protocol_type", "service", "flag"]

# Zero-variance features to drop before fitting
# (num_outbound_cmds is 100% zeros, is_host_login has 1 positive in 125K)
DROP_COLS: list[str] = ["num_outbound_cmds", "is_host_login"]

# Everything else is numeric (continuous + binary indicators)
NUMERIC_COLS: list[str] = [
    c for c in FEATURE_NAMES
    if c not in CATEGORICAL_COLS and c not in DROP_COLS
]

# ─────────────────────────────────────────────────────────────────────────────
# 2. LABEL MAPPING — 23 fine-grained labels → 3 classes
# ─────────────────────────────────────────────────────────────────────────────

# DoS attacks in NSL-KDD
_DOS_LABELS: set[str] = {
    "neptune", "back", "land", "pod", "smurf", "teardrop",
    "apache2", "udpstorm", "processtable", "mailbomb",
}

# Probe / PortScan attacks in NSL-KDD
_PROBE_LABELS: set[str] = {
    "portsweep", "ipsweep", "nmap", "satan", "mscan", "saint",
}

# R2L and U2R — too few samples (<1% combined), not in our 3-class spec.
# These rows are dropped during preprocessing.
_R2L_LABELS: set[str] = {
    "guess_passwd", "ftp_write", "imap", "phf", "multihop",
    "warezmaster", "warezclient", "spy", "xlock", "xsnoop",
    "snmpguess", "snmpgetattack", "httptunnel", "sendmail", "named",
}
_U2R_LABELS: set[str] = {
    "buffer_overflow", "loadmodule", "rootkit", "perl",
    "sqlattack", "xterm", "ps",
}
_DROP_LABELS: set[str] = _R2L_LABELS | _U2R_LABELS


def map_label(raw_label: str) -> str | None:
    """
    Map a fine-grained NSL-KDD label to one of the 3 target classes.

    Returns None for R2L/U2R labels (to be filtered out by the caller).
    """
    lbl = raw_label.strip().lower()
    if lbl == "normal":
        return "Normal"
    if lbl in _DOS_LABELS:
        return "DoS"
    if lbl in _PROBE_LABELS:
        return "PortScan"
    if lbl in _DROP_LABELS:
        return None  # signal caller to drop this row
    # Unknown label — treat as None so it's dropped safely
    logger.warning("Unknown NSL-KDD label '%s' — dropping row", raw_label)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# 3. LABEL ENCODER
# ─────────────────────────────────────────────────────────────────────────────

def build_label_encoder() -> LabelEncoder:
    """
    Build and fit a LabelEncoder on the 3 target classes.

    Alphabetical sort produces: 0=DoS, 1=Normal, 2=PortScan
    """
    le = LabelEncoder()
    le.fit(CLASS_NAMES)  # already sorted alphabetically
    return le


# ─────────────────────────────────────────────────────────────────────────────
# 4. DATA LOADING
# ─────────────────────────────────────────────────────────────────────────────

# Column lists for the two file formats
_TRAIN_COLS = FEATURE_NAMES + ["label", "difficulty_level"]  # 43 columns
_TEST_COLS = FEATURE_NAMES + ["label"]                       # 42 columns


def load_nsl_kdd(
    train_path: str | Path,
    test_path: str | Path | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    """
    Load NSL-KDD train (and optionally test) files.

    Applies label mapping and drops R2L/U2R rows automatically.
    Returns DataFrames with columns: [FEATURE_NAMES..., 'label']
    """
    # ── Train ────────────────────────────────────────────────────────────────
    train = pd.read_csv(
        train_path, sep="\t", header=None, names=_TRAIN_COLS,
    )
    # Drop difficulty_level — not a feature, not available at inference time
    train.drop(columns=["difficulty_level"], inplace=True)

    train = _apply_label_mapping(train, split_name="train")

    # ── Test (optional) ──────────────────────────────────────────────────────
    test = None
    if test_path is not None:
        test = pd.read_csv(
            test_path, sep="\t", header=None, names=_TEST_COLS,
        )
        test = _apply_label_mapping(test, split_name="test")

    return train, test


def _apply_label_mapping(df: pd.DataFrame, split_name: str) -> pd.DataFrame:
    """Map raw labels → 3 classes, drop R2L/U2R."""
    df["label"] = df["label"].apply(map_label)

    n_before = len(df)
    df = df.dropna(subset=["label"]).reset_index(drop=True)
    n_dropped = n_before - len(df)

    if n_dropped > 0:
        logger.info(
            "%s: dropped %d R2L/U2R rows (%.1f%%) → %d rows remain",
            split_name, n_dropped, n_dropped / n_before * 100, len(df),
        )

    return df


# ─────────────────────────────────────────────────────────────────────────────
# 5. SKLEARN PREPROCESSING PIPELINE (scaler.pkl)
# ─────────────────────────────────────────────────────────────────────────────

def build_scaler() -> ColumnTransformer:
    """
    Build the feature preprocessing pipeline (saved as scaler.pkl).

    Numeric columns  → StandardScaler
    Categorical cols → OneHotEncoder (handle unseen values gracefully)

    The returned ColumnTransformer accepts a DataFrame with FEATURE_NAMES
    columns and outputs a dense numpy array ready for the classifier.
    """
    scaler = ColumnTransformer(
        transformers=[
            (
                "num",
                StandardScaler(),
                NUMERIC_COLS,
            ),
            (
                "cat",
                OneHotEncoder(
                    handle_unknown="ignore",  # unseen service/flag in test
                    sparse_output=False,
                    dtype=np.float64,
                ),
                CATEGORICAL_COLS,
            ),
        ],
        remainder="drop",  # drops DROP_COLS and anything unexpected
        verbose_feature_names_out=False,
    )
    return scaler


def get_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Extract just the feature columns from a loaded DataFrame."""
    return df[FEATURE_NAMES]


def get_labels(df: pd.DataFrame, le: LabelEncoder) -> np.ndarray:
    """Encode string labels to integers using the fitted LabelEncoder."""
    return le.transform(df["label"].values)


# ─────────────────────────────────────────────────────────────────────────────
# 6. SERIALIZATION — save/load model artifacts
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_MODEL_DIR = Path(__file__).resolve().parent.parent / "model"


def save_artifact(obj: object, name: str, model_dir: Path | None = None) -> Path:
    """Serialize any sklearn object to model_dir/name."""
    d = model_dir or DEFAULT_MODEL_DIR
    d.mkdir(parents=True, exist_ok=True)
    path = d / name
    joblib.dump(obj, path)
    size = path.stat().st_size
    if size > 1024 * 1024:
        logger.info("Saved %s → %s (%.1f MB)", name, path, size / (1024 * 1024))
    else:
        logger.info("Saved %s → %s (%.1f KB)", name, path, size / 1024)
    return path


def load_artifact(name: str, model_dir: Path | None = None) -> object:
    """Deserialize a sklearn object from model_dir/name."""
    d = model_dir or DEFAULT_MODEL_DIR
    path = d / name
    if not path.exists():
        raise FileNotFoundError(f"Artifact not found: {path}")
    obj = joblib.load(path)
    logger.info("Loaded %s ← %s", name, path)
    return obj


# ─────────────────────────────────────────────────────────────────────────────
# 7. CLI — run directly to verify the pipeline
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    )

    DATA_DIR = Path(__file__).resolve().parent.parent / "data"
    train_path = DATA_DIR / "KDDTrain+.txt"
    test_path = DATA_DIR / "KDDTest+.txt"

    # ── Load & map labels ────────────────────────────────────────────────────
    print("=" * 70)
    print("  PREPROCESSING PIPELINE — VERIFICATION")
    print("=" * 70)

    train, test = load_nsl_kdd(train_path, test_path)
    le = build_label_encoder()

    print(f"\n📊 After label mapping:")
    print(f"   Train: {len(train):,} rows")
    if test is not None:
        print(f"   Test:  {len(test):,} rows")

    print(f"\n🏷️ LabelEncoder mapping:")
    for i, cls in enumerate(le.classes_):
        print(f"   {i} = {cls}")

    print(f"\n🏷️ Train class distribution:")
    for cls_name in CLASS_NAMES:
        n = (train["label"] == cls_name).sum()
        pct = n / len(train) * 100
        print(f"   {cls_name:10s} → {n:>6,} ({pct:5.1f}%)")

    # ── Fit scaler ───────────────────────────────────────────────────────────
    print(f"\n⚙️  Building scaler...")
    scaler = build_scaler()

    X_train = get_feature_matrix(train)
    y_train = get_labels(train, le)

    X_train_transformed = scaler.fit_transform(X_train)

    print(f"   Input shape:  {X_train.shape}")
    print(f"   Output shape: {X_train_transformed.shape}")
    print(f"   Features after one-hot: {X_train_transformed.shape[1]}")

    # Show feature name breakdown
    try:
        feature_names_out = scaler.get_feature_names_out()
        n_num = len(NUMERIC_COLS)
        n_cat = len(feature_names_out) - n_num
        print(f"   ├─ Numeric (scaled):    {n_num}")
        print(f"   └─ Categorical (OHE):   {n_cat}")
    except Exception:
        pass

    # ── Transform test set ───────────────────────────────────────────────────
    if test is not None:
        X_test = get_feature_matrix(test)
        X_test_transformed = scaler.transform(X_test)
        print(f"\n   Test transform: {X_test.shape} → {X_test_transformed.shape}")

    # ── Sanity checks ────────────────────────────────────────────────────────
    print(f"\n✅ Sanity checks:")
    print(f"   NaN in output:      {np.isnan(X_train_transformed).sum()}")
    print(f"   Inf in output:      {np.isinf(X_train_transformed).sum()}")
    print(f"   Label range:        {y_train.min()} – {y_train.max()}")
    print(f"   Label dtype:        {y_train.dtype}")
    print(f"   Unique labels:      {np.unique(y_train)}")

    # ── Save artifacts ───────────────────────────────────────────────────────
    save_artifact(scaler, "scaler.pkl")
    save_artifact(le, "label_encoder.pkl")

    print(f"\n{'=' * 70}")
    print(f"  PREPROCESSING PIPELINE — READY ✅")
    print(f"{'=' * 70}")
