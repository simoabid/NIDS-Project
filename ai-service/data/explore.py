"""
NSL-KDD Dataset — Exploration Script
ai-service/data/explore.py

Run once to understand the data before writing training scripts.
Covers: schema, types, missing values, class distribution, feature
statistics, correlations, and categorical cardinality.

Usage:
    cd ai-service
    source .venv/bin/activate
    python data/explore.py
"""

import os
import sys
import pandas as pd
import numpy as np

# ─────────────────────────────────────────────────────────────────────────────
# 1. COLUMN DEFINITIONS
# ─────────────────────────────────────────────────────────────────────────────

# 41 original features + label + difficulty_level (train only)
FEATURE_NAMES = [
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

CATEGORICAL_COLS = ["protocol_type", "service", "flag"]
BINARY_COLS = [
    "land", "logged_in", "root_shell", "su_attempted",
    "is_host_login", "is_guest_login",
]
CONTINUOUS_COLS = [
    c for c in FEATURE_NAMES
    if c not in CATEGORICAL_COLS and c not in BINARY_COLS
]

# NSL-KDD attack-type → category mapping
DOS_ATTACKS = {
    "neptune", "back", "land", "pod", "smurf", "teardrop",
    "apache2", "udpstorm", "processtable", "mailbomb",
}
PROBE_ATTACKS = {
    "portsweep", "ipsweep", "nmap", "satan", "mscan", "saint",
}
R2L_ATTACKS = {
    "guess_passwd", "ftp_write", "imap", "phf", "multihop",
    "warezmaster", "warezclient", "spy", "xlock", "xsnoop",
    "snmpguess", "snmpgetattack", "httptunnel", "sendmail", "named",
}
U2R_ATTACKS = {
    "buffer_overflow", "loadmodule", "rootkit", "perl",
    "sqlattack", "xterm", "ps",
}


def attack_category(label: str) -> str:
    """Map a fine-grained NSL-KDD label to one of 5 categories."""
    lbl = label.strip().lower()
    if lbl == "normal":
        return "Normal"
    if lbl in DOS_ATTACKS:
        return "DoS"
    if lbl in PROBE_ATTACKS:
        return "Probe"
    if lbl in R2L_ATTACKS:
        return "R2L"
    if lbl in U2R_ATTACKS:
        return "U2R"
    return "Unknown"


def binary_label(label: str) -> int:
    """0 = Normal, 1 = Attack."""
    return 0 if label.strip().lower() == "normal" else 1


# ─────────────────────────────────────────────────────────────────────────────
# 2. LOAD DATA
# ─────────────────────────────────────────────────────────────────────────────

DATA_DIR = os.path.dirname(os.path.abspath(__file__))

train_path = os.path.join(DATA_DIR, "KDDTrain+.txt")
test_path = os.path.join(DATA_DIR, "KDDTest+.txt")

if not os.path.exists(train_path) or not os.path.exists(test_path):
    print("❌  KDDTrain+.txt and/or KDDTest+.txt not found in data/")
    print("    Download them first (see README).")
    sys.exit(1)

# Train has 43 columns (41 features + label + difficulty_level)
train_cols = FEATURE_NAMES + ["label", "difficulty_level"]
train = pd.read_csv(train_path, sep="\t", header=None, names=train_cols)

# Test has 42 columns (41 features + label, no difficulty_level)
test_cols = FEATURE_NAMES + ["label"]
test = pd.read_csv(test_path, sep="\t", header=None, names=test_cols)

# Derive columns
train["attack_cat"] = train["label"].apply(attack_category)
train["is_attack"] = train["label"].apply(binary_label)
test["is_attack"] = test["label"].apply(binary_label)


# ─────────────────────────────────────────────────────────────────────────────
# 3. PRINT HELPERS
# ─────────────────────────────────────────────────────────────────────────────

SEP = "=" * 72


def section(title: str) -> None:
    print(f"\n{SEP}")
    print(f"  {title}")
    print(SEP)


# ─────────────────────────────────────────────────────────────────────────────
# 4. EXPLORATION
# ─────────────────────────────────────────────────────────────────────────────

print(SEP)
print("  NSL-KDD DATASET — FULL EXPLORATION")
print(SEP)

# ── 4.1 Shape & Schema ──────────────────────────────────────────────────────

section("4.1  SHAPE & SCHEMA")

print(f"  Train : {train.shape[0]:>7,} rows × {len(train_cols)} raw columns")
print(f"  Test  : {test.shape[0]:>7,} rows × {len(test_cols)} raw columns")
print(f"  Total : {train.shape[0] + test.shape[0]:>7,} rows")
print()
print(f"  Feature columns    : {len(FEATURE_NAMES)}")
print(f"    ├─ Categorical   : {len(CATEGORICAL_COLS)}  {CATEGORICAL_COLS}")
print(f"    ├─ Binary (0/1)  : {len(BINARY_COLS)}  {BINARY_COLS}")
print(f"    └─ Continuous    : {len(CONTINUOUS_COLS)}")
print()
print("  Column dtypes (train):")
for dtype, count in train[FEATURE_NAMES].dtypes.value_counts().items():
    print(f"    {str(dtype):15s} → {count} columns")

# ── 4.2 Missing Values ──────────────────────────────────────────────────────

section("4.2  MISSING VALUES")

train_missing = train[FEATURE_NAMES + ["label"]].isnull().sum()
test_missing = test[FEATURE_NAMES + ["label"]].isnull().sum()

train_total = train_missing.sum()
test_total = test_missing.sum()

if train_total == 0 and test_total == 0:
    print("  ✅  Zero missing values in both train and test sets.")
else:
    print(f"  Train missing: {train_total}")
    if train_total > 0:
        for col in train_missing[train_missing > 0].index:
            print(f"    {col}: {train_missing[col]}")
    print(f"  Test missing: {test_total}")
    if test_total > 0:
        for col in test_missing[test_missing > 0].index:
            print(f"    {col}: {test_missing[col]}")

# ── 4.3 Categorical Features ────────────────────────────────────────────────

section("4.3  CATEGORICAL FEATURES")

for col in CATEGORICAL_COLS:
    train_vals = sorted(train[col].unique())
    test_vals = sorted(test[col].unique())
    only_train = set(train_vals) - set(test_vals)
    only_test = set(test_vals) - set(train_vals)

    print(f"\n  {col}")
    print(f"    Train unique : {len(train_vals)}")
    print(f"    Test unique  : {len(test_vals)}")
    if only_train:
        print(f"    ⚠️  In train only: {sorted(only_train)}")
    if only_test:
        print(f"    ⚠️  In test only : {sorted(only_test)}")

    print(f"    Value distribution (train top 15):")
    for val, cnt in train[col].value_counts().head(15).items():
        pct = cnt / len(train) * 100
        bar = "█" * int(pct / 2)
        print(f"      {val:20s} {cnt:>7,} ({pct:5.1f}%) {bar}")

# ── 4.4 Binary Features ─────────────────────────────────────────────────────

section("4.4  BINARY FEATURES")

for col in BINARY_COLS:
    ones = train[col].sum()
    pct = ones / len(train) * 100
    print(f"  {col:20s} → {ones:>6,} ones ({pct:5.2f}%)")

# ── 4.5 Label Distribution ──────────────────────────────────────────────────

section("4.5  LABEL DISTRIBUTION")

print("\n  Binary (Normal vs Attack):")
for name, df in [("Train", train), ("Test", test)]:
    n_normal = (df["is_attack"] == 0).sum()
    n_attack = (df["is_attack"] == 1).sum()
    total = len(df)
    print(f"    {name}: Normal={n_normal:>6,} ({n_normal/total*100:.1f}%)  "
          f"Attack={n_attack:>6,} ({n_attack/total*100:.1f}%)")

print("\n  Attack categories (train — fine-grained labels available):")
for cat in ["Normal", "DoS", "Probe", "R2L", "U2R", "Unknown"]:
    n = (train["attack_cat"] == cat).sum()
    if n > 0:
        pct = n / len(train) * 100
        bar = "█" * max(1, int(pct / 2))
        print(f"    {cat:8s} → {n:>6,} ({pct:5.1f}%) {bar}")

print("\n  All unique labels in train (23 attack types):")
for lbl, cnt in train["label"].value_counts().items():
    cat = attack_category(lbl)
    pct = cnt / len(train) * 100
    print(f"    {lbl:20s} [{cat:6s}]  {cnt:>6,}  ({pct:5.2f}%)")

print("\n  Test labels (binary only):")
for lbl, cnt in test["label"].value_counts().items():
    pct = cnt / len(test) * 100
    print(f"    {lbl:20s}  {cnt:>6,}  ({pct:5.1f}%)")

# ── 4.6 Continuous Feature Statistics ────────────────────────────────────────

section("4.6  CONTINUOUS FEATURE STATISTICS (train)")

stats = train[CONTINUOUS_COLS].describe().T
stats["skew"] = train[CONTINUOUS_COLS].skew()
stats["zeros%"] = (train[CONTINUOUS_COLS] == 0).sum() / len(train) * 100

# Show all with readable formatting
pd.set_option("display.max_rows", None)
pd.set_option("display.width", 120)
pd.set_option("display.float_format", lambda x: f"{x:>12.2f}")

print()
print(stats[["count", "mean", "std", "min", "25%", "50%", "75%", "max", "skew", "zeros%"]].to_string())

# ── 4.7 High-Variance & Skewed Features ─────────────────────────────────────

section("4.7  FEATURES NEEDING ATTENTION")

print("\n  Features with extreme skew (|skew| > 5):")
high_skew = stats[stats["skew"].abs() > 5].sort_values("skew", ascending=False)
for feat in high_skew.index:
    sk = high_skew.loc[feat, "skew"]
    print(f"    {feat:35s} skew = {sk:>10.1f}")

print("\n  Features that are >90% zeros:")
mostly_zero = stats[stats["zeros%"] > 90].sort_values("zeros%", ascending=False)
for feat in mostly_zero.index:
    z = mostly_zero.loc[feat, "zeros%"]
    print(f"    {feat:35s} zeros = {z:>5.1f}%")

print("\n  Features with very large range (max/mean > 1000):")
large_range = stats[(stats["mean"] > 0) & (stats["max"] / stats["mean"] > 1000)]
for feat in large_range.index:
    mn = large_range.loc[feat, "mean"]
    mx = large_range.loc[feat, "max"]
    print(f"    {feat:35s} mean={mn:>12.1f}  max={mx:>15.0f}  ratio={mx/mn:>10.0f}x")

# ── 4.8 Correlation with Attack Label ────────────────────────────────────────

section("4.8  TOP FEATURES CORRELATED WITH ATTACK LABEL")

corr = train[CONTINUOUS_COLS + BINARY_COLS + ["is_attack"]].corr()["is_attack"].drop("is_attack")
corr_sorted = corr.abs().sort_values(ascending=False)

print("\n  Top 15 features (absolute Pearson correlation with is_attack):")
for feat in corr_sorted.head(15).index:
    r = corr[feat]
    direction = "+" if r > 0 else "−"
    bar = "█" * int(abs(r) * 30)
    print(f"    {feat:35s} {direction}{abs(r):.3f}  {bar}")

print("\n  Bottom 5 features (weakest signal):")
for feat in corr_sorted.tail(5).index:
    r = corr[feat]
    print(f"    {feat:35s}  {abs(r):.4f}")

# ── 4.9 Feature Correlations (inter-feature) ────────────────────────────────

section("4.9  HIGHLY CORRELATED FEATURE PAIRS (|r| > 0.9)")

num_features = CONTINUOUS_COLS + BINARY_COLS
corr_matrix = train[num_features].corr()

seen = set()
pairs = []
for i, c1 in enumerate(num_features):
    for j, c2 in enumerate(num_features):
        if i >= j:
            continue
        r = corr_matrix.loc[c1, c2]
        if abs(r) > 0.9:
            pair = (c1, c2) if c1 < c2 else (c2, c1)
            if pair not in seen:
                seen.add(pair)
                pairs.append((c1, c2, r))

pairs.sort(key=lambda x: abs(x[2]), reverse=True)
if pairs:
    for c1, c2, r in pairs:
        print(f"    {c1:35s} ↔ {c2:35s}  r = {r:+.3f}")
    print(f"\n  → {len(pairs)} pairs found. Consider dropping one from each pair.")
else:
    print("  None found.")

# ── 4.10 Difficulty Level (Train only) ───────────────────────────────────────

section("4.10  DIFFICULTY LEVEL DISTRIBUTION (train only)")

print(f"  Range: {train['difficulty_level'].min()} – {train['difficulty_level'].max()}")
print(f"  Mean:  {train['difficulty_level'].mean():.1f}")
print()
print("  Distribution:")
diff_dist = train["difficulty_level"].value_counts().sort_index()
for level, cnt in diff_dist.items():
    pct = cnt / len(train) * 100
    bar = "█" * max(1, int(pct))
    print(f"    Level {level:>2d}: {cnt:>6,} ({pct:4.1f}%) {bar}")

# ── 4.11 Summary & Recommendations ──────────────────────────────────────────

section("4.11  SUMMARY & PREPROCESSING RECOMMENDATIONS")

print("""
  ✅ Dataset is clean — zero missing values in both splits.

  📋 Preprocessing checklist for training:

  1. ENCODE CATEGORICALS
     • protocol_type (3 values) → one-hot encode
     • service (70 values)      → one-hot encode
     • flag (11 values)         → one-hot encode
     ⚠️  Test set may have unseen service/flag values — use
        handle_unknown='ignore' in OneHotEncoder.

  2. SCALE CONTINUOUS FEATURES
     • src_bytes, dst_bytes have extreme ranges (0 → 1.3 billion)
     • Many features are heavily right-skewed
     → Use StandardScaler on all continuous + binary columns.

  3. HANDLE CLASS IMBALANCE
     • R2L (0.8%) and U2R (0.04%) are severely underrepresented.
     • For binary classification (Normal vs Attack): dataset is balanced.
     • For multi-class: consider class_weight='balanced' in the classifier.

  4. DROP LOW-SIGNAL FEATURES (optional)
     • num_outbound_cmds is 100% zeros — carries no information.
     • is_host_login is 99.99% zeros.
     • Consider removing these to reduce noise.

  5. HANDLE CORRELATED FEATURES (optional)
     • Several feature pairs have |r| > 0.9.
     • Dropping one from each pair reduces multicollinearity
       (matters for linear models, less so for Random Forest).

  6. LABEL ENCODING
     • Binary task: normal → 0, everything else → 1
     • Multi-class: map 23 labels → 5 categories (Normal/DoS/Probe/R2L/U2R)
     • Test set only has Attack/Normal — use binary for evaluation.
""")

print(SEP)
print("  EXPLORATION COMPLETE")
print(SEP)
