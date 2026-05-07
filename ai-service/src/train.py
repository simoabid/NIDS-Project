"""
NSL-KDD Model Training — Random Forest Classifier
ai-service/src/train.py

Trains a 3-class classifier (Normal / DoS / PortScan) on NSL-KDD.
Uses the preprocessing pipeline from src/preprocessing.py to ensure
identical transforms at training and inference time.

Artifacts saved to ai-service/model/:
  ├── classifier.pkl        # the trained Random Forest
  ├── scaler.pkl            # fitted ColumnTransformer (OHE + StandardScaler)
  ├── label_encoder.pkl     # LabelEncoder: 0=DoS, 1=Normal, 2=PortScan
  └── feature_columns.json  # ordered list of feature names (commit this)

Usage:
    cd ai-service
    source .venv/bin/activate
    python -m src.train
"""

from __future__ import annotations

import json
import time
import logging
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    accuracy_score,
)

from .preprocessing import (
    load_nsl_kdd,
    build_scaler,
    build_label_encoder,
    get_feature_matrix,
    get_labels,
    save_artifact,
    CLASS_NAMES,
    FEATURE_NAMES,
    NUMERIC_COLS,
    CATEGORICAL_COLS,
    DROP_COLS,
    DEFAULT_MODEL_DIR,
)

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TRAIN_FILE = DATA_DIR / "KDDTrain+.txt"
TEST_FILE = DATA_DIR / "KDDTest+.txt"

# Random Forest hyperparameters — solid defaults for NSL-KDD
RF_PARAMS = {
    "n_estimators": 100,
    "max_depth": None,           # grow full trees
    "min_samples_split": 2,
    "min_samples_leaf": 1,
    "max_features": "sqrt",      # standard for classification
    "class_weight": "balanced",  # compensate PortScan being 9.3%
    "n_jobs": -1,                # use all CPU cores
    "random_state": 42,
    "verbose": 0,
}

# Cross-validation settings
CV_FOLDS = 5

SEP = "=" * 70


def section(title: str) -> None:
    print(f"\n{SEP}")
    print(f"  {title}")
    print(SEP)


# ─────────────────────────────────────────────────────────────────────────────
# Main training pipeline
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    t_start = time.perf_counter()

    print(SEP)
    print("  NSL-KDD MODEL TRAINING — Random Forest (3-class)")
    print(SEP)

    # ── 1. Load data ─────────────────────────────────────────────────────────
    section("1. LOADING DATA")

    train_df, test_df = load_nsl_kdd(TRAIN_FILE, TEST_FILE)
    le = build_label_encoder()

    print(f"   Train: {len(train_df):,} rows")
    if test_df is not None:
        print(f"   Test:  {len(test_df):,} rows (Normal only — binary labels)")

    print(f"\n   LabelEncoder: {dict(enumerate(le.classes_))}")
    print()
    for cls in CLASS_NAMES:
        n = (train_df["label"] == cls).sum()
        pct = n / len(train_df) * 100
        print(f"   {cls:10s} → {n:>6,} ({pct:5.1f}%)")

    # ── 2. Preprocess ────────────────────────────────────────────────────────
    section("2. PREPROCESSING")

    scaler = build_scaler()

    X_train_raw = get_feature_matrix(train_df)
    y_train = get_labels(train_df, le)

    t_prep = time.perf_counter()
    X_train = scaler.fit_transform(X_train_raw)
    t_prep = time.perf_counter() - t_prep

    print(f"   Input:     {X_train_raw.shape}")
    print(f"   Output:    {X_train.shape}")
    print(f"   Fit time:  {t_prep:.2f}s")

    # ── 3. Cross-validation ──────────────────────────────────────────────────
    section(f"3. CROSS-VALIDATION ({CV_FOLDS}-fold stratified)")

    cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=42)
    rf_cv = RandomForestClassifier(**RF_PARAMS)

    scoring = {
        "accuracy": "accuracy",
        "f1_macro": "f1_macro",
        "f1_weighted": "f1_weighted",
    }

    t_cv = time.perf_counter()
    cv_results = cross_validate(
        rf_cv, X_train, y_train,
        cv=cv,
        scoring=scoring,
        return_train_score=False,
        n_jobs=-1,
        verbose=0,
    )
    t_cv = time.perf_counter() - t_cv

    print(f"   CV completed in {t_cv:.1f}s\n")
    for metric in scoring:
        key = f"test_{metric}"
        scores = cv_results[key]
        print(f"   {metric:15s}:  {scores.mean():.4f} ± {scores.std():.4f}  "
              f"(per fold: {', '.join(f'{s:.4f}' for s in scores)})")

    # ── 4. Train final model on full training set ────────────────────────────
    section("4. TRAINING FINAL MODEL (full train set)")

    model = RandomForestClassifier(**RF_PARAMS)

    t_train = time.perf_counter()
    model.fit(X_train, y_train)
    t_train = time.perf_counter() - t_train

    print(f"   Estimators:  {model.n_estimators}")
    print(f"   Features:    {model.n_features_in_}")
    print(f"   Classes:     {[le.inverse_transform([c])[0] for c in model.classes_]}")
    print(f"   Train time:  {t_train:.2f}s")

    # ── 5. Evaluate on training set ──────────────────────────────────────────
    section("5. TRAIN SET EVALUATION")

    y_pred_train = model.predict(X_train)
    train_acc = accuracy_score(y_train, y_pred_train)

    print(f"   Train accuracy: {train_acc:.4f}")
    print()
    print("   Classification Report:")
    print(classification_report(
        y_train, y_pred_train,
        target_names=CLASS_NAMES,
        digits=4,
    ))

    print("   Confusion Matrix:")
    cm = confusion_matrix(y_train, y_pred_train)
    _print_confusion_matrix(cm, CLASS_NAMES)

    # ── 6. Feature importance (top 15) ───────────────────────────────────────
    section("6. TOP 15 FEATURE IMPORTANCES")

    importances = model.feature_importances_
    try:
        feature_names = scaler.get_feature_names_out()
    except Exception:
        feature_names = [f"f{i}" for i in range(len(importances))]

    indices = np.argsort(importances)[::-1][:15]
    for rank, idx in enumerate(indices, 1):
        name = feature_names[idx]
        imp = importances[idx]
        bar = "█" * int(imp * 100)
        print(f"   {rank:2d}. {name:40s} {imp:.4f}  {bar}")

    # ── 7. Test set evaluation (Normal-only) ─────────────────────────────────
    if test_df is not None and len(test_df) > 0:
        section("7. TEST SET EVALUATION (Normal-only subset)")
        print("   ⚠️  NSL-KDD test file uses binary labels (Attack/Normal).")
        print("      After our 3-class mapping, only Normal rows remain.")
        print(f"      Test rows available: {len(test_df):,}")
        print()

        X_test_raw = get_feature_matrix(test_df)
        X_test = scaler.transform(X_test_raw)
        y_test = get_labels(test_df, le)
        y_pred_test = model.predict(X_test)

        test_acc = accuracy_score(y_test, y_pred_test)
        print(f"   Test accuracy (Normal-only): {test_acc:.4f}")
        print()

        # Show what the model predicted for known-Normal rows
        print(f"   Model predictions for {len(test_df):,} Normal test rows:")
        for i, cls in enumerate(CLASS_NAMES):
            cnt = int((y_pred_test == i).sum())
            pct = cnt / len(test_df) * 100
            print(f"      {cls:10s} → {cnt:>5,} ({pct:5.1f}%)")
        print(f"\n   True Positive rate (Normal correctly identified): {test_acc:.1%}")

    # ── 8. Save all artifacts ────────────────────────────────────────────────
    section("8. SAVING ARTIFACTS")

    DEFAULT_MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # classifier.pkl
    clf_path = save_artifact(model, "classifier.pkl")
    clf_size = clf_path.stat().st_size / (1024 * 1024)

    # scaler.pkl
    scl_path = save_artifact(scaler, "scaler.pkl")
    scl_size = scl_path.stat().st_size / 1024

    # label_encoder.pkl
    le_path = save_artifact(le, "label_encoder.pkl")
    le_size = le_path.stat().st_size / 1024

    # feature_columns.json (text — commit this)
    feature_meta = {
        "description": "Feature columns expected by the NSL-KDD preprocessing pipeline",
        "all_features": FEATURE_NAMES,
        "numeric_cols": NUMERIC_COLS,
        "categorical_cols": CATEGORICAL_COLS,
        "dropped_cols": DROP_COLS,
        "n_raw_features": len(FEATURE_NAMES),
        "n_transformed_features": int(X_train.shape[1]),
        "class_names": CLASS_NAMES,
        "label_encoding": {cls: int(le.transform([cls])[0]) for cls in CLASS_NAMES},
    }
    feat_path = DEFAULT_MODEL_DIR / "feature_columns.json"
    with open(feat_path, "w") as f:
        json.dump(feature_meta, f, indent=2)
    print(f"   feature_columns.json → {feat_path}")

    # ── Summary ──────────────────────────────────────────────────────────────
    t_total = time.perf_counter() - t_start

    section("TRAINING COMPLETE")
    print(f"   Total time:        {t_total:.1f}s")
    print(f"   CV Accuracy:       {cv_results['test_accuracy'].mean():.4f} ± {cv_results['test_accuracy'].std():.4f}")
    print(f"   CV F1 (macro):     {cv_results['test_f1_macro'].mean():.4f} ± {cv_results['test_f1_macro'].std():.4f}")
    print(f"   Train Accuracy:    {train_acc:.4f}")
    print(f"   Model size:        {clf_size:.1f} MB")
    print(f"   Output features:   {model.n_features_in_}")
    print(f"\n   Artifacts saved to: {DEFAULT_MODEL_DIR}/")
    print(f"     ├── classifier.pkl        ({clf_size:.1f} MB)")
    print(f"     ├── scaler.pkl            ({scl_size:.1f} KB)")
    print(f"     ├── label_encoder.pkl     ({le_size:.1f} KB)")
    print(f"     └── feature_columns.json  (commit this)")
    print(SEP)


def _print_confusion_matrix(cm: np.ndarray, labels: list[str]) -> None:
    """Pretty-print a confusion matrix with labels."""
    header = "   " + " " * 15 + "".join(f"{lbl:>10s}" for lbl in labels)
    print(header)
    print("   " + " " * 15 + "-" * (10 * len(labels)))
    for i, label in enumerate(labels):
        row_vals = "".join(f"{cm[i, j]:>10,}" for j in range(len(labels)))
        print(f"   {label:>15s} |{row_vals}")
    print()


if __name__ == "__main__":
    main()
