#!/usr/bin/env python3
"""
telegram_json_to_event_log.py

Input: Telegram export JSON file (like result.json)
Output: append-only JSONL event log partitioned by chat_id + day

Events emitted:
- message_created: always for each message
- message_edited: if 'edited' field present (separate event)
- message_forwarded: if 'forwarded_from' present (separate event)

Design goals:
- No semantics. No token extraction. No normalization beyond copying fields.
- Deterministic event_id hashing for replay/idempotency.
- Append-only outputs (never mutate existing lines).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

try:
    import zstandard as zstd  # type: ignore
except Exception:
    zstd = None


ISO_FMT = "%Y-%m-%dT%H:%M:%S"


def _parse_naive_iso(s: Optional[str]) -> Optional[dt.datetime]:
    """
    Telegram exports often store timestamps like '2026-01-20T02:08:14' (no timezone).
    We treat them as UTC-naive and later write with 'Z' suffix in JSONL for clarity.
    """
    if not s:
        return None
    try:
        return dt.datetime.strptime(s, ISO_FMT)
    except Exception:
        # best-effort: try fromisoformat (can handle fractional seconds)
        try:
            return dt.datetime.fromisoformat(s)
        except Exception:
            return None


def _to_utc_z(ts: Optional[dt.datetime]) -> Optional[str]:
    if ts is None:
        return None
    # keep naive but label as Z for downstream consistency
    return ts.strftime(ISO_FMT) + "Z"


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _event_id(chat_id: int, message_id: int, event_type: str, ts: str, edited_ts: Optional[str]) -> str:
    base = f"{chat_id}|{message_id}|{event_type}|{ts}|{edited_ts or ''}"
    return "sha256:" + _sha256_hex(base)


@dataclass(frozen=True)
class OutputTarget:
    path: Path
    compress: bool


def _open_append(target: OutputTarget):
    target.path.parent.mkdir(parents=True, exist_ok=True)

    if target.compress:
        if zstd is None:
            raise RuntimeError("zstandard is not installed but --compress=zstd was requested.")
        # Append to .zst: easiest is to append unframed streams; zstd supports concatenated frames.
        # We'll open in binary append and write frames per line batch.
        f = open(target.path, "ab")
        cctx = zstd.ZstdCompressor(level=10)
        stream = cctx.stream_writer(f)
        return f, stream  # caller must close both
    else:
        f = open(target.path, "a", encoding="utf-8")
        return f, None


def _close_append(f, stream):
    try:
        if stream is not None:
            stream.flush(zstd.FLUSH_FRAME)
            stream.close()
    finally:
        f.close()


def _emit_jsonl_line(obj: Dict[str, Any], f, stream):
    line = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"
    if stream is not None:
        stream.write(line.encode("utf-8"))
    else:
        f.write(line)


def _iter_messages(doc: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    msgs = doc.get("messages", [])
    if not isinstance(msgs, list):
        return []
    for m in msgs:
        if isinstance(m, dict):
            yield m


def _target_for(chat_id: int, day: str, out_dir: Path, compress: str) -> OutputTarget:
    base = out_dir / "raw" / "telegram" / "events" / f"chat_id={chat_id}"
    fname = f"events_{day}.jsonl"
    if compress == "zstd":
        fname += ".zst"
        return OutputTarget(path=base / fname, compress=True)
    if compress == "none":
        return OutputTarget(path=base / fname, compress=False)
    raise ValueError(f"Unknown compress mode: {compress}")


def _build_event_common(
    *,
    chat_id: int,
    message: Dict[str, Any],
    event_type: str,
    timestamp_z: str,
    edited_timestamp_z: Optional[str],
    ingestor_version: str,
    ingested_at_z: str,
) -> Dict[str, Any]:
    message_id = int(message.get("id"))
    from_name = message.get("from")
    from_id = message.get("from_id")
    reply_to_message_id = message.get("reply_to_message_id")

    evt = {
        "event_id": _event_id(chat_id, message_id, event_type, timestamp_z, edited_timestamp_z),
        "event_type": event_type,
        "chat_id": chat_id,
        "message_id": message_id,
        "from_id": from_id,
        "from_name": from_name,
        "timestamp": timestamp_z,
        "edited_timestamp": edited_timestamp_z,
        "reply_to_message_id": reply_to_message_id,
        "forwarded_from": message.get("forwarded_from"),
        "forwarded_from_id": message.get("forwarded_from_id"),
        # raw payload fields preserved verbatim for audit/replay
        "raw_text": message.get("text"),
        "raw_text_entities": message.get("text_entities"),
        "inline_bot_buttons": message.get("inline_bot_buttons"),
        "ingested_at": ingested_at_z,
        "ingestor_version": ingestor_version,
    }
    return evt


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-json", required=True, help="Path to Telegram export JSON")
    ap.add_argument("--out-dir", required=True, help="Output base directory")
    ap.add_argument("--compress", choices=["none", "zstd"], default="zstd")
    ap.add_argument("--ingestor-version", default="telegram_raw_v1")
    args = ap.parse_args()

    in_path = Path(args.input_json)
    out_dir = Path(args.out_dir)

    doc = json.loads(in_path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        raise SystemExit("Input JSON must be an object")

    chat_id = doc.get("id")
    if chat_id is None:
        raise SystemExit("Input JSON missing top-level 'id' (chat_id)")
    chat_id = int(chat_id)

    now = dt.datetime.utcnow()
    ingested_at_z = _to_utc_z(now)

    # Partition by message date (YYYY-MM-DD)
    writers: Dict[str, Tuple[Any, Any, OutputTarget]] = {}

    def get_writer(day: str):
        if day in writers:
            return writers[day]
        target = _target_for(chat_id, day, out_dir, args.compress)
        f, stream = _open_append(target)
        writers[day] = (f, stream, target)
        return writers[day]

    try:
        for m in _iter_messages(doc):
            if m.get("type") != "message":
                continue
            if "id" not in m or "date" not in m:
                continue

            date_ts = _parse_naive_iso(m.get("date"))
            if date_ts is None:
                continue
            day = date_ts.strftime("%Y-%m-%d")
            timestamp_z = _to_utc_z(date_ts)

            edited_ts = _parse_naive_iso(m.get("edited"))
            edited_timestamp_z = _to_utc_z(edited_ts)

            f, stream, _target = get_writer(day)

            # message_created
            evt_created = _build_event_common(
                chat_id=chat_id,
                message=m,
                event_type="message_created",
                timestamp_z=timestamp_z,
                edited_timestamp_z=None,
                ingestor_version=args.ingestor_version,
                ingested_at_z=ingested_at_z,
            )
            _emit_jsonl_line(evt_created, f, stream)

            # message_forwarded (separate event if forwarded metadata exists)
            if m.get("forwarded_from") or m.get("forwarded_from_id"):
                evt_fwd = _build_event_common(
                    chat_id=chat_id,
                    message=m,
                    event_type="message_forwarded",
                    timestamp_z=timestamp_z,
                    edited_timestamp_z=None,
                    ingestor_version=args.ingestor_version,
                    ingested_at_z=ingested_at_z,
                )
                _emit_jsonl_line(evt_fwd, f, stream)

            # message_edited (separate event if edited timestamp exists)
            if edited_timestamp_z is not None:
                evt_edit = _build_event_common(
                    chat_id=chat_id,
                    message=m,
                    event_type="message_edited",
                    timestamp_z=timestamp_z,
                    edited_timestamp_z=edited_timestamp_z,
                    ingestor_version=args.ingestor_version,
                    ingested_at_z=ingested_at_z,
                )
                _emit_jsonl_line(evt_edit, f, stream)

    finally:
        for _day, (f, stream, _target) in writers.items():
            _close_append(f, stream)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
