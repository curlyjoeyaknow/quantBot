INSTALL sqlite;
LOAD sqlite;

-- Change these:
-- SET chat_id = '1976645587';

-- DuckDB doesn't have session vars like Postgres, so just edit the string.

WITH s AS (
  SELECT chat_id, message_id, bot_reply_id_1, bot_reply_id_2, mint, UPPER(ticker) AS ticker
  FROM sqlite_scan('tele.db', 'user_calls')
  WHERE chat_id = '1976645587'
),
d AS (
  SELECT chat_id, message_id, bot_reply_id_1, bot_reply_id_2, mint, UPPER(ticker) AS ticker
  FROM user_calls_d
  WHERE chat_id = '1976645587'
)
SELECT
  COALESCE(s.message_id, d.message_id) AS message_id,
  s.bot_reply_id_1 AS sqlite_rick, d.bot_reply_id_1 AS duck_rick,
  s.bot_reply_id_2 AS sqlite_phanes, d.bot_reply_id_2 AS duck_phanes,
  s.mint AS sqlite_mint, d.mint AS duck_mint,
  s.ticker AS sqlite_ticker, d.ticker AS duck_ticker
FROM s
FULL OUTER JOIN d USING (chat_id, message_id)
WHERE
  s.message_id IS NULL OR d.message_id IS NULL
  OR COALESCE(s.bot_reply_id_1, -1) != COALESCE(d.bot_reply_id_1, -1)
  OR COALESCE(s.bot_reply_id_2, -1) != COALESCE(d.bot_reply_id_2, -1)
  OR COALESCE(s.mint, '') != COALESCE(d.mint, '')
  OR COALESCE(s.ticker, '') != COALESCE(d.ticker, '')
ORDER BY message_id
LIMIT 200;

