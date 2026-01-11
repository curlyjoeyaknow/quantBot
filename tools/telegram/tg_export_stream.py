#!/usr/bin/env python3

import argparse

import json

import os

import sqlite3

from datetime import datetime, timezone



import ijson





def safe_str(x):

  if x is None:

    return ""

  s = str(x)

  return s.replace("\u0000", "").replace("\r\n", "\n")





def parse_intish(x):

  try:

    if x is None:

      return None

    if isinstance(x, bool):

      return None

    if isinstance(x, int):

      return x

    if isinstance(x, float):

      return int(x)

    if isinstance(x, str) and x.strip() != "":

      return int(float(x))

  except Exception:

    return None

  return None





def parse_ts_ms(msg):

  # Telegram export commonly has date_unixtime (string) and/or date (ISO-ish string)

  du = msg.get("date_unixtime")

  if du is not None:

    secs = parse_intish(du)

    if secs is not None and secs > 0:

      return secs * 1000



  d = msg.get("date")

  if isinstance(d, str) and d.strip() != "":

    s = d.strip()

    # Handle trailing Z

    if s.endswith("Z"):

      s = s[:-1] + "+00:00"

    try:

      # fromisoformat handles "YYYY-MM-DDTHH:MM:SS[.fff][+HH:MM]"

      dt = datetime.fromisoformat(s)

      if dt.tzinfo is None:

        dt = dt.replace(tzinfo=timezone.utc)

      return int(dt.timestamp() * 1000)

    except Exception:

      # fallback: try Date.parse-like subset

      try:

        dt = datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)

        return int(dt.timestamp() * 1000)

      except Exception:

        return None



  return None





def flatten_text(text_field):

  links = []

  if isinstance(text_field, str):

    return text_field, links

  if isinstance(text_field, list):

    out = []

    for part in text_field:

      if isinstance(part, str):

        out.append(part)

      elif isinstance(part, dict):

        t = safe_str(part.get("text"))

        out.append(t)

        href = part.get("href")

        if isinstance(href, str) and href.strip() != "":

          links.append({"text": t, "href": href.strip()})

      else:

        out.append(safe_str(part))

    return "".join(out), links

  if text_field is None:

    return "", links

  return safe_str(text_field), links





def looks_like_message(obj):

  if not isinstance(obj, dict):

    return False

  has_id = obj.get("id") is not None

  has_date = obj.get("date") is not None or obj.get("date_unixtime") is not None

  has_content = (

    obj.get("type") is not None

    or obj.get("text") is not None

    or obj.get("action") is not None

    or obj.get("actor") is not None

  )

  return (has_id or has_date) and has_content





def build_container(it, first_event):

  # it yields (prefix, event, value)

  # first_event is either ("start_map") or ("start_array") already consumed for the root container.

  if first_event not in ("start_map", "start_array"):

    raise ValueError(f"build_container called with invalid first_event={first_event}")



  root = {} if first_event == "start_map" else []

  stack = [root]

  key_stack = [None]  # for dicts



  depth = 1

  while depth > 0:

    prefix, event, value = next(it)



    if event == "map_key":

      key_stack[-1] = value

      continue



    def add_value(val):

      cur = stack[-1]

      if isinstance(cur, dict):

        k = key_stack[-1]

        cur[k] = val

        key_stack[-1] = None

      else:

        cur.append(val)



    if event == "start_map":

      new = {}

      add_value(new) if stack else None

      stack.append(new)

      key_stack.append(None)

      depth += 1

      continue



    if event == "start_array":

      new = []

      add_value(new) if stack else None

      stack.append(new)

      key_stack.append(None)

      depth += 1

      continue



    if event == "end_map" or event == "end_array":

      stack.pop()

      key_stack.pop()

      depth -= 1

      continue



    # scalar

    if event == "null":

      add_value(None)

    else:

      add_value(value)



  return root





def iter_full_export(in_path):

  # Streams: chats.list.item ... messages.item (objects)

  with open(in_path, "rb") as f:

    it = ijson.parse(f)



    chat_index = -1

    chat_id = None

    chat_name = None

    chat_type = None



    for prefix, event, value in it:

      if prefix == "chats.list.item" and event == "start_map":

        chat_index += 1

        chat_id = None

        chat_name = None

        chat_type = None

        continue



      if prefix == "chats.list.item.id" and event in ("string", "number"):

        chat_id = safe_str(value) or f"chat:{chat_index}"

        continue



      if prefix == "chats.list.item.name" and event == "string":

        chat_name = safe_str(value) or None

        continue



      if prefix == "chats.list.item.type" and event == "string":

        chat_type = safe_str(value) or None

        continue



      if prefix == "chats.list.item.messages.item" and event == "start_map":

        msg = build_container(it, "start_map")

        yield {

          "chat_index": chat_index,

          "chat_id": chat_id or f"chat:{chat_index}",

          "chat_name": chat_name,

          "chat_type": chat_type,

          "msg": msg,

        }





def iter_single_export(in_path):

  # Streams: messages.item (objects) at root

  with open(in_path, "rb") as f:

    it = ijson.parse(f)



    root_chat_id = None

    root_chat_name = None



    for prefix, event, value in it:

      # root fields sometimes exist

      if prefix == "id" and event in ("string", "number"):

        root_chat_id = safe_str(value)

      if prefix == "name" and event == "string":

        root_chat_name = safe_str(value)



      if prefix == "messages.item" and event == "start_map":

        msg = build_container(it, "start_map")

        yield {

          "chat_index": None,

          "chat_id": root_chat_id or "single_chat",

          "chat_name": root_chat_name,

          "chat_type": None,

          "msg": msg,

        }





def normalize(chat_meta, msg, include_raw_ok=False):

  if not isinstance(msg, dict):

    return None, {

      "error_code": "UNKNOWN_SHAPE",

      "error_message": "message is not an object",

      "raw": msg,

    }



  if not looks_like_message(msg):

    return None, {

      "error_code": "NOT_A_MESSAGE",

      "error_message": "node did not look like a Telegram message object",

      "raw": msg,

    }



  message_id = parse_intish(msg.get("id"))

  ts_ms = parse_ts_ms(msg)



  mtype = safe_str(msg.get("type") or "message") or "message"

  is_service = 1 if (mtype != "message" or msg.get("action") is not None or msg.get("actor") is not None) else 0



  from_name = safe_str(msg.get("from")) if msg.get("from") is not None else None

  from_id = safe_str(msg.get("from_id")) if msg.get("from_id") is not None else None



  text, links = flatten_text(msg.get("text"))



  reply_to = parse_intish(msg.get("reply_to_message_id"))



  norm = {

    "chat_id": chat_meta["chat_id"],

    "chat_name": chat_meta.get("chat_name"),

    "chat_type": chat_meta.get("chat_type"),

    "chat_index": chat_meta.get("chat_index"),

    "message_id": message_id,

    "ts_ms": ts_ms,

    "type": mtype,

    "is_service": bool(is_service),

    "from_name": from_name if from_name else None,

    "from_id": from_id if from_id else None,

    "text": text,

    "links": links,

    "reply_to_message_id": reply_to,

  }



  if include_raw_ok:

    norm["raw"] = msg



  # quarantine only if truly broken

  if message_id is None and ts_ms is None:

    return None, {

      "error_code": "MISSING_ID_AND_DATE",

      "error_message": "message missing both id and date/date_unixtime",

      "raw": msg,

    }



  return norm, None





def init_db(db_path, schema_path):

  conn = sqlite3.connect(db_path)

  conn.execute("PRAGMA journal_mode=WAL;")

  conn.execute("PRAGMA synchronous=NORMAL;")

  schema_sql = open(schema_path, "r", encoding="utf-8").read()

  conn.executescript(schema_sql)

  conn.commit()

  return conn





def main():

  ap = argparse.ArgumentParser()

  ap.add_argument("--in", dest="in_path", required=True, help="path to Telegram export result.json")

  ap.add_argument("--out-ok", default="data/normalized_messages.ndjson")

  ap.add_argument("--out-err", default="data/quarantine.ndjson")

  ap.add_argument("--sqlite", default=None, help="optional sqlite db path (e.g. tele.db)")

  ap.add_argument("--schema", default="tools/telegram/schema.sql")

  ap.add_argument("--chat-id", default=None, help="only ingest this chat_id (full exports)")

  ap.add_argument("--chat-name", default=None, help="only ingest chats whose name contains this substring (case-insensitive)")

  ap.add_argument("--max-messages", type=int, default=None)

  ap.add_argument("--include-raw-ok", action="store_true")

  ap.add_argument("--quiet", action="store_true")

  args = ap.parse_args()



  os.makedirs(os.path.dirname(args.out_ok) or ".", exist_ok=True)

  os.makedirs(os.path.dirname(args.out_err) or ".", exist_ok=True)



  ok_f = open(args.out_ok, "w", encoding="utf-8")

  err_f = open(args.out_err, "w", encoding="utf-8")



  conn = None

  cur = None

  if args.sqlite:

    conn = init_db(args.sqlite, args.schema)

    cur = conn.cursor()



  def chat_matches(meta):

    if args.chat_id and meta["chat_id"] != args.chat_id:

      return False

    if args.chat_name:

      name = meta.get("chat_name") or ""

      if args.chat_name.lower() not in name.lower():

        return False

    return True



  ok_count = 0

  err_count = 0

  skipped = 0

  seen = 0



  def write_ok(norm):

    nonlocal ok_count

    ok_f.write(json.dumps(norm, ensure_ascii=False) + "\n")

    ok_count += 1



  def write_err(meta, q):

    nonlocal err_count

    payload = {

      "chat_id": meta.get("chat_id"),

      "chat_name": meta.get("chat_name"),

      "chat_type": meta.get("chat_type"),

      "chat_index": meta.get("chat_index"),

      "message_id": parse_intish(q.get("raw", {}).get("id")) if isinstance(q.get("raw"), dict) else None,

      "ts_ms": parse_ts_ms(q.get("raw")) if isinstance(q.get("raw"), dict) else None,

      "error_code": q["error_code"],

      "error_message": q["error_message"],

      "raw": q.get("raw"),

    }

    err_f.write(json.dumps(payload, ensure_ascii=False) + "\n")

    err_count += 1



  def db_upsert_chat(meta):

    if not cur:

      return

    cur.execute(

      "INSERT OR REPLACE INTO tg_chats(chat_id, chat_name, chat_type, chat_index) VALUES (?,?,?,?)",

      (meta.get("chat_id"), meta.get("chat_name"), meta.get("chat_type"), meta.get("chat_index")),

    )



  def db_insert_norm(norm):

    if not cur:

      return

    cur.execute(

      "INSERT OR REPLACE INTO tg_norm(chat_id,message_id,ts_ms,from_name,from_id,type,is_service,text,links_json,norm_json,chat_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)",

      (

        norm["chat_id"],

        norm["message_id"] if norm["message_id"] is not None else -1,

        norm["ts_ms"],

        norm.get("from_name"),

        norm.get("from_id"),

        norm.get("type"),

        1 if norm.get("is_service") else 0,

        norm.get("text"),

        json.dumps(norm.get("links") or [], ensure_ascii=False),

        json.dumps(norm, ensure_ascii=False),

        norm.get("chat_name"),

      ),

    )



  def db_insert_quarantine(payload):

    if not cur:

      return

    cur.execute(

      "INSERT INTO tg_quarantine(chat_id,chat_name,message_id,ts_ms,error_code,error_message,raw_json) VALUES (?,?,?,?,?,?,?)",

      (

        payload.get("chat_id"),

        payload.get("chat_name"),

        payload.get("message_id"),

        payload.get("ts_ms"),

        payload.get("error_code"),

        payload.get("error_message"),

        json.dumps(payload.get("raw"), ensure_ascii=False),

      ),

    )



  def process_iter(it):

    nonlocal seen, skipped

    batch = 0

    for item in it:

      meta = {

        "chat_index": item.get("chat_index"),

        "chat_id": item.get("chat_id"),

        "chat_name": item.get("chat_name"),

        "chat_type": item.get("chat_type"),

      }



      if not chat_matches(meta):

        # still had to stream it, but we skip processing

        skipped += 1

        continue



      db_upsert_chat(meta)



      msg = item.get("msg")

      norm, q = normalize(meta, msg, include_raw_ok=args.include_raw_ok)



      if q and q["error_code"] == "NOT_A_MESSAGE":

        skipped += 1

        continue



      seen += 1

      if args.max_messages and seen > args.max_messages:

        break



      if norm is not None:

        write_ok(norm)

        db_insert_norm(norm)

      else:

        write_err(meta, q)

        # the written err payload is exactly what we wrote; rebuild quickly for db

        payload = {

          "chat_id": meta.get("chat_id"),

          "chat_name": meta.get("chat_name"),

          "message_id": parse_intish(msg.get("id")) if isinstance(msg, dict) else None,

          "ts_ms": parse_ts_ms(msg) if isinstance(msg, dict) else None,

          "error_code": q["error_code"],

          "error_message": q["error_message"],

          "raw": q.get("raw"),

        }

        db_insert_quarantine(payload)



      batch += 1

      if conn and batch >= 5000:

        conn.commit()

        batch = 0



      if not args.quiet and (ok_count + err_count) % 10000 == 0:

        print(f"processed={ok_count+err_count} ok={ok_count} err={err_count} skipped={skipped}")



    if conn:

      conn.commit()



  # Attempt full export first, then fallback to single-chat export

  if not args.quiet:

    print("Trying full-export shape: chats.list.*.messages.*")

  try:

    full_seen_before = ok_count + err_count

    process_iter(iter_full_export(args.in_path))

    full_seen_after = ok_count + err_count

    if full_seen_after == full_seen_before:

      # No processed msgs → try single

      if not args.quiet:

        print("No processed messages via full-export; trying single-chat shape: messages.*")

      process_iter(iter_single_export(args.in_path))

  except Exception as e:

    if not args.quiet:

      print(f"Full-export parse threw ({e}); trying single-chat shape...")

    process_iter(iter_single_export(args.in_path))



  ok_f.close()

  err_f.close()

  if conn:

    conn.close()



  if not args.quiet:

    print(f"DONE ok={ok_count} err={err_count} skipped={skipped}")

    print(f"OK  -> {args.out_ok}")

    print(f"ERR -> {args.out_err}")

    if args.sqlite:

      print(f"DB  -> {args.sqlite}")





if __name__ == "__main__":

  main()

