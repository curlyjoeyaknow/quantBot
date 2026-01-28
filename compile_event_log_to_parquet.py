#!/usr/bin/env python3
"""
compile_event_log_to_parquet.py

Input: JSONL event logs emitted by telegram_json_to_event_log.py (optionally .zst)
Output: Canonical Parquet partitioned by chat_id + date, plus manifest JSONL.

Canonicalization scope:
- Structural normalization only.
- Preserves raw fields for audit.
- Extracts:
  - text_plain (best-effort concatenation)
  - text_links, cashtags, hashtags, mentioned_users
  - token_like_strings (regex-only, no semantics)

Idempotency:
- Each output parquet is content-hashed (sha256) and recorded in manifest.
- If an identical content hash already exists for the same output path, skip rewrite.
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import zstandard as zstd  # type: ignore
except Exception:
    zstd = None

try:
    import pyarrow as pa  # type: ignore
    import pyarrow.parquet as pq  # type: ignore
except Exception as e:
    raise SystemExit("pyarrow is required for Parquet compilation. Install pyarrow.") from e


ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"

BASE58_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")
EVM_RE = re.compile(r"\b0x[a-fA-F0-9]{40}\b")


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def _parse_ts_z(s: Optional[str]) -> Optional[dt.datetime]:
    if not s:
        return None
    try:
        return dt.datetime.strptime(s, ISO_FMT)
    except Exception:
        # tolerate no-Z
        try:
            if s.endswith("Z"):
                return dt.datetime.fromisoformat(s[:-1])
            return dt.datetime.fromisoformat(s)
        except Exception:
            return None


def _date_part(ts: Optional[dt.datetime]) -> Optional[str]:
    if ts is None:
        return None
    return ts.strftime("%Y-%m-%d")


def _iter_jsonl_events(path: Path) -> Iterable[Dict[str, Any]]:
    if path.suffix == ".zst":
        if zstd is None:
            raise RuntimeError(f"zstandard not installed but found compressed log: {path}")
        dctx = zstd.ZstdDecompressor()
        with open(path, "rb") as f:
            with dctx.stream_reader(f) as reader:
                buf = b""
                while True:
                    chunk = reader.read(1024 * 1024)
                    if not chunk:
                        break
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        if not line:
                            continue
                        yield json.loads(line.decode("utf-8"))
                if buf.strip():
                    yield json.loads(buf.decode("utf-8"))
    else:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                yield json.loads(line)


def _text_parts_from_raw(raw_text: Any) -> List[Dict[str, Any]]:
    """
    Telegram export 'text' can be:
      - string
      - list of strings and dicts: {"type": "...", "text": "...", "href": "..."}
    We normalize into a list of dict parts with keys: type, text, href (optional)
    """
    parts: List[Dict[str, Any]] = []
    if raw_text is None:
        return parts

    if isinstance(raw_text, str):
        parts.append({"type": "plain", "text": raw_text})
        return parts

    if isinstance(raw_text, list):
        for item in raw_text:
            if isinstance(item, str):
                parts.append({"type": "plain", "text": item})
            elif isinstance(item, dict):
                p = {
                    "type": item.get("type") or "unknown",
                    "text": item.get("text") if isinstance(item.get("text"), str) else "",
                }
                if "href" in item and isinstance(item.get("href"), str):
                    p["href"] = item["href"]
                parts.append(p)
            else:
                parts.append({"type": "plain", "text": str(item)})
        return parts

    # fallback
    parts.append({"type": "plain", "text": str(raw_text)})
    return parts


def _extract_from_entities(entities: Any) -> Tuple[List[str], List[str], List[str], List[str]]:
    links: List[str] = []
    cashtags: List[str] = []
    hashtags: List[str] = []
    mentions: List[str] = []

    if not isinstance(entities, list):
        return links, cashtags, hashtags, mentions

    for e in entities:
        if not isinstance(e, dict):
            continue
        t = e.get("type")
        txt = e.get("text")
        href = e.get("href")
        if t in ("link", "text_link") and isinstance(href, str):
            links.append(href)
        if isinstance(txt, str):
            if t == "cashtag":
                cashtags.append(txt)
            elif t == "hashtag":
                hashtags.append(txt)
            elif t in ("mention", "mention_name"):
                mentions.append(txt)
            elif t in ("link", "text_link") and txt.startswith("http"):
                links.append(txt)

    # dedupe preserving order
    def uniq(xs: List[str]) -> List[str]:
        seen = set()
        out = []
        for x in xs:
            if x in seen:
                continue
            seen.add(x)
            out.append(x)
        return out

    return uniq(links), uniq(cashtags), uniq(hashtags), uniq(mentions)


def _flatten_text_plain(parts: List[Dict[str, Any]]) -> str:
    # concatenate all visible 'text' fields
    return "".join([p.get("text", "") or "" for p in parts])


def _extract_links_from_parts(parts: List[Dict[str, Any]]) -> List[str]:
    out: List[str] = []
    for p in parts:
        href = p.get("href")
        if isinstance(href, str) and href:
            out.append(href)
        txt = p.get("text")
        if isinstance(txt, str) and txt.startswith("http"):
            out.append(txt)

    # dedupe
    seen = set()
    uniq = []
    for x in out:
        if x in seen:
            continue
        seen.add(x)
        uniq.append(x)
    return uniq


def _token_like_strings(text_plain: str) -> List[str]:
    # purely regex-based; NO semantics
    found = []
    found += BASE58_RE.findall(text_plain or "")
    found += EVM_RE.findall(text_plain or "")

    # dedupe preserve order
    seen = set()
    out = []
    for x in found:
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


@dataclass
class Row:
    event_id: str
    event_type: str
    chat_id: int
    message_id: int
    from_id: Optional[str]
    from_name: Optional[str]
    timestamp: Optional[dt.datetime]
    edited_timestamp: Optional[dt.datetime]
    reply_to_message_id: Optional[int]
    forwarded_from_id: Optional[str]
    text_plain: str
    text_links: List[str]
    cashtags: List[str]
    hashtags: List[str]
    mentioned_users: List[str]
    token_like_strings: List[str]
    raw_text: Any
    raw_text_entities: Any
    inline_bot_buttons: Any
    raw_event_ref: Optional[str]


def _rows_from_event_file(path: Path) -> Iterable[Row]:
    for evt in _iter_jsonl_events(path):
        event_id = evt.get("event_id")
        event_type = evt.get("event_type")
        chat_id = evt.get("chat_id")
        message_id = evt.get("message_id")
        if not isinstance(event_id, str) or not isinstance(event_type, str):
            continue
        if chat_id is None or message_id is None:
            continue

        ts = _parse_ts_z(evt.get("timestamp"))
        ets = _parse_ts_z(evt.get("edited_timestamp"))

        parts = _text_parts_from_raw(evt.get("raw_text"))
        text_plain = _flatten_text_plain(parts)

        links_from_parts = _extract_links_from_parts(parts)
        links_from_entities, cashtags, hashtags, mentions = _extract_from_entities(evt.get("raw_text_entities"))

        # merge links
        links = []
        for x in links_from_parts + links_from_entities:
            if x not in links:
                links.append(x)

        toks = _token_like_strings(text_plain)

        yield Row(
            event_id=event_id,
            event_type=event_type,
            chat_id=int(chat_id),
            message_id=int(message_id),
            from_id=evt.get("from_id"),
            from_name=evt.get("from_name"),
            timestamp=ts,
            edited_timestamp=ets,
            reply_to_message_id=evt.get("reply_to_message_id"),
            forwarded_from_id=evt.get("forwarded_from_id"),
            text_plain=text_plain,
            text_links=links,
            cashtags=cashtags,
            hashtags=hashtags,
            mentioned_users=mentions,
            token_like_strings=toks,
            raw_text=evt.get("raw_text"),
            raw_text_entities=evt.get("raw_text_entities"),
            inline_bot_buttons=evt.get("inline_bot_buttons"),
            raw_event_ref=str(path),
        )


def _pa_list_str(xs: List[List[str]]) -> pa.Array:
    return pa.array(xs, type=pa.list_(pa.string()))


def _write_parquet(rows: List[Row], out_path: Path) -> Tuple[int, Optional[str], Optional[str]]:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Build columns
    tbl = pa.table(
        {
            "event_id": pa.array([r.event_id for r in rows], type=pa.string()),
            "event_type": pa.array([r.event_type for r in rows], type=pa.string()),
            "chat_id": pa.array([r.chat_id for r in rows], type=pa.int64()),
            "message_id": pa.array([r.message_id for r in rows], type=pa.int64()),
            "from_id": pa.array([r.from_id for r in rows], type=pa.string()),
            "from_name": pa.array([r.from_name for r in rows], type=pa.string()),
            "timestamp": pa.array([r.timestamp for r in rows], type=pa.timestamp("ms")),
            "edited_timestamp": pa.array([r.edited_timestamp for r in rows], type=pa.timestamp("ms")),
            "reply_to_message_id": pa.array(
                [r.reply_to_message_id for r in rows],
                type=pa.int64(),
            ),
            "forwarded_from_id": pa.array([r.forwarded_from_id for r in rows], type=pa.string()),
            "text_plain": pa.array([r.text_plain for r in rows], type=pa.string()),
            "text_links": _pa_list_str([r.text_links for r in rows]),
            "cashtags": _pa_list_str([r.cashtags for r in rows]),
            "hashtags": _pa_list_str([r.hashtags for r in rows]),
            "mentioned_users": _pa_list_str([r.mentioned_users for r in rows]),
            "token_like_strings": _pa_list_str([r.token_like_strings for r in rows]),
            # Raw audit blobs (JSON-encoded strings to keep Parquet types sane)
            "raw_text_json": pa.array([json.dumps(r.raw_text, ensure_ascii=False) for r in rows], type=pa.string()),
            "raw_text_entities_json": pa.array([json.dumps(r.raw_text_entities, ensure_ascii=False) for r in rows], type=pa.string()),
            "inline_bot_buttons_json": pa.array([json.dumps(r.inline_bot_buttons, ensure_ascii=False) for r in rows], type=pa.string()),
            "raw_event_ref": pa.array([r.raw_event_ref for r in rows], type=pa.string()),
        }
    )

    pq.write_table(tbl, out_path, compression="zstd")

    # Get min/max timestamps for manifest
    ts_vals = [r.timestamp for r in rows if r.timestamp is not None]
    if ts_vals:
        min_ts = min(ts_vals).strftime("%Y-%m-%dT%H:%M:%S")
        max_ts = max(ts_vals).strftime("%Y-%m-%dT%H:%M:%S")
    else:
        min_ts = None
        max_ts = None

    return len(rows), min_ts, max_ts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events-dir", required=True, help="Base directory that contains raw/telegram/events/**")
    ap.add_argument("--out-dir", required=True, help="Base directory to write canon/telegram_events/**")
    ap.add_argument("--manifest-path", required=True, help="Where to append manifest JSONL")
    ap.add_argument("--glob", default="raw/telegram/events/**/events_*.jsonl*", help="Glob under --events-dir")
    args = ap.parse_args()

    base = Path(args.events_dir)
    out_base = Path(args.out_dir)
    manifest_path = Path(args.manifest_path)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    in_paths = sorted([Path(p) for p in glob.glob(str(base / args.glob), recursive=True)])
    if not in_paths:
        print(f"No input files found under {base} with glob {args.glob}", file=sys.stderr)
        return 2

    # Group rows by (chat_id, date)
    buckets: Dict[Tuple[int, str], List[Row]] = {}

    for p in in_paths:
        for r in _rows_from_event_file(p):
            day = _date_part(r.timestamp) or "unknown"
            key = (r.chat_id, day)
            buckets.setdefault(key, []).append(r)

    now_z = dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    with open(manifest_path, "a", encoding="utf-8") as mf:
        for (chat_id, day), rows in sorted(buckets.items()):
            # deterministic ordering: event_id stable
            rows.sort(key=lambda x: x.event_id)

            out_path = out_base / "canon" / "telegram_events" / f"chat_id={chat_id}" / f"date={day}" / "events.parquet"
            tmp_path = out_path.with_suffix(".parquet.tmp")

            row_count, min_ts, max_ts = _write_parquet(rows, tmp_path)
            file_hash = _sha256_file(tmp_path)

            # If destination exists and has same hash, discard tmp (idempotent no-op)
            if out_path.exists():
                existing_hash = _sha256_file(out_path)
                if existing_hash == file_hash:
                    tmp_path.unlink(missing_ok=True)
                    status = "deduped_same_hash"
                else:
                    tmp_path.replace(out_path)
                    status = "replaced_new_hash"
            else:
                tmp_path.replace(out_path)
                status = "created"

            manifest_row = {
                "kind": "canon.telegram_events",
                "chat_id": chat_id,
                "date": day,
                "path": str(out_path),
                "row_count": row_count,
                "min_timestamp": min_ts,
                "max_timestamp": max_ts,
                "file_hash": file_hash,
                "status": status,
                "written_at": now_z,
            }
            mf.write(json.dumps(manifest_row, ensure_ascii=False) + "\n")

    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(main())
