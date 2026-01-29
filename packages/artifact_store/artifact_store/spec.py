from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

# Minimal, strict spec for sidecars. You can expand safely over time.
# Identity != Provenance. Identity is for dedupe and correctness; provenance is for debugging/repro.

@dataclass(frozen=True)
class ArtifactTypeSpec:
    artifact_type: str
    # Canonical columns (in order) to hash. Must exist in parquet for content_hash.
    canonical_cols: Sequence[str]
    # Sort keys (in order) to produce deterministic row stream.
    sort_keys: Sequence[str]
    # Optional casts (DuckDB SQL expressions) applied during content hashing.
    # Map col -> SQL expression template with "{col}" placeholder
    casts: Dict[str, str]

# You can add more specs as needed.
SPECS: Dict[str, ArtifactTypeSpec] = {

    "alerts_v1": ArtifactTypeSpec(
        artifact_type="alerts_v1",
        canonical_cols=(
            "alert_ts_utc",
            "chain",
            "mint",
            "alert_chat_id",
            "alert_message_id",
            "alert_id",
            "caller_name_norm",
            "caller_id",
            "mint_source",
            "bot_name",
            "run_id",
        ),
        sort_keys=(
            "alert_ts_utc",
            "chain",
            "mint",
            "alert_chat_id",
            "alert_message_id",
        ),
        casts={
            # Handle both VARCHAR (ISO string) and TIMESTAMP types
            # Cast to TIMESTAMP (handles ISO strings), then format to UTC ISO string
            "alert_ts_utc": "strftime(TRY_CAST({col} AS TIMESTAMP), '%Y-%m-%dT%H:%M:%S.%fZ')",
        },
    ),

    "alerts": ArtifactTypeSpec(
        artifact_type="alerts",
        canonical_cols=("alert_ts", "source", "message_id", "token_mint", "raw_text"),
        sort_keys=("alert_ts", "source", "message_id", "token_mint"),
        casts={
            # Handle both VARCHAR (ISO string) and TIMESTAMP types
            # Cast to TIMESTAMP (handles ISO strings), then format to UTC ISO string
            "alert_ts": "strftime(TRY_CAST({col} AS TIMESTAMP), '%Y-%m-%dT%H:%M:%S.%fZ')",
        },
    ),
    "ohlcv_slice": ArtifactTypeSpec(
        artifact_type="ohlcv_slice",
        canonical_cols=("ts", "open", "high", "low", "close", "volume"),
        sort_keys=("ts",),
        casts={
            # Handle both VARCHAR (ISO string) and TIMESTAMP types
            # Cast to TIMESTAMP (handles ISO strings), then format to UTC ISO string
            "ts": "strftime(TRY_CAST({col} AS TIMESTAMP), '%Y-%m-%dT%H:%M:%S.%fZ')",
        },
    ),
    "run_metrics": ArtifactTypeSpec(
        artifact_type="run_metrics",
        canonical_cols=("run_id", "metric_name", "metric_value", "ts"),
        sort_keys=("run_id", "metric_name", "ts"),
        casts={
            # Handle both VARCHAR (ISO string) and TIMESTAMP types
            # Cast to TIMESTAMP (handles ISO strings), then format to UTC ISO string
            "ts": "strftime(TRY_CAST({col} AS TIMESTAMP), '%Y-%m-%dT%H:%M:%S.%fZ')",
        },
    ),
}

def get_spec(artifact_type: str) -> ArtifactTypeSpec:
    if artifact_type not in SPECS:
        raise KeyError(
            f"Unknown artifact_type={artifact_type!r}. Add it to artifact_store/spec.py::SPECS"
        )
    return SPECS[artifact_type]

# ---- Alerts: append-only event log (truth) ----
# Dedup happens in derived caches, not in the event log itself.
SPECS["alerts_event_v1"] = ArtifactTypeSpec(
    artifact_type="alerts_event_v1",
    canonical_cols=(
        "alert_key",
        "event_ts_utc",
        "seen_at_utc",
        "ingest_source",
        "chain",
        "mint",
        "alert_chat_id",
        "alert_message_id",
        "alert_id",
        "caller_name",
        "caller_name_norm",
        "caller_id",
        "mint_source",
        "bot_name",
        "bot_message_id",
        "bot_ts_ms",
        "run_id",
    ),
    sort_keys=(
        "alert_key",
        "event_ts_utc",
        "seen_at_utc",
    ),
    casts={
        # Normalize timestamps to ISO-8601 strings so hashing order is deterministic.
        # Handle both VARCHAR (ISO string) and TIMESTAMP types
        "event_ts_utc": "strftime(TRY_CAST({col} AS TIMESTAMP), '%Y-%m-%dT%H:%M:%S.%fZ')",
        "seen_at_utc": "strftime(TRY_CAST({col} AS TIMESTAMP), '%Y-%m-%dT%H:%M:%S.%fZ')",
    },
)
