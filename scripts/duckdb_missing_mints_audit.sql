-- Missing Mints Audit for DuckDB Pipeline
-- Categorizes why calls don't have mint addresses

-- 1) Identify missing-mint calls
CREATE OR REPLACE TEMP VIEW missing_mint_calls AS
SELECT
  uc.*
FROM user_calls_d uc
WHERE uc.mint IS NULL OR TRIM(CAST(uc.mint AS VARCHAR)) = '';

-- 2) Attach message text from normalized messages
CREATE OR REPLACE TEMP VIEW missing_with_text AS
SELECT
  mmc.*,
  tn.text AS message_text,
  tn.reply_to_message_id
FROM missing_mint_calls mmc
LEFT JOIN tg_norm_d tn ON tn.message_id = mmc.message_id AND tn.chat_id = mmc.chat_id;

-- 3) Check caller_links for extraction attempts
CREATE OR REPLACE TEMP VIEW link_analysis AS
SELECT
  cl.trigger_message_id,
  cl.trigger_chat_id,
  COUNT(*) AS n_links,
  SUM(CASE WHEN cl.mint IS NOT NULL THEN 1 ELSE 0 END) AS n_links_with_mint,
  SUM(CASE WHEN cl.mint LIKE '0x%' THEN 1 ELSE 0 END) AS n_links_with_evm,
  SUM(CASE WHEN cl.mint IS NOT NULL AND cl.mint NOT LIKE '0x%' THEN 1 ELSE 0 END) AS n_links_with_solana,
  SUM(CASE WHEN cl.mint_validation_status IS NOT NULL THEN 1 ELSE 0 END) AS n_links_with_validation,
  SUM(CASE WHEN cl.mint_validation_status = 'pass2_rejected' OR cl.mint_validation_status = 'pass1_rejected' THEN 1 ELSE 0 END) AS n_links_rejected,
  LIST_DISTINCT(cl.mint_validation_reason) AS rejection_reasons
FROM caller_links_d cl
WHERE cl.mint_validation_reason IS NOT NULL
GROUP BY cl.trigger_message_id, cl.trigger_chat_id;

-- 4) Check if trigger text has address-like patterns
CREATE OR REPLACE TEMP VIEW trigger_pattern_analysis AS
SELECT
  message_id,
  chat_id,
  trigger_text,
  -- Check for Solana Base58 patterns (32-44 chars)
  CASE WHEN trigger_text ~ '[1-9A-HJ-NP-Za-km-z]{32,44}' THEN 1 ELSE 0 END AS has_base58_pattern,
  -- Check for EVM addresses (0x followed by 40 hex)
  CASE WHEN trigger_text ~ '0x[a-fA-F0-9]{40}' THEN 1 ELSE 0 END AS has_evm_pattern,
  -- Check for ticker patterns
  CASE WHEN trigger_text ~ '\$[A-Za-z0-9_]{2,20}' THEN 1 ELSE 0 END AS has_ticker_pattern,
  -- Check for URLs (might contain addresses)
  CASE WHEN trigger_text ~ 'https?://' THEN 1 ELSE 0 END AS has_url_pattern,
  -- Check for newlines (might split addresses)
  CASE WHEN trigger_text ~ '\n' THEN 1 ELSE 0 END AS has_newlines,
  -- Check for zero-width spaces (invisible characters)
  CASE WHEN trigger_text ~ '[\u200B-\u200D\uFEFF]' THEN 1 ELSE 0 END AS has_zero_width
FROM user_calls_d
WHERE mint IS NULL OR TRIM(CAST(mint AS VARCHAR)) = '';

-- 5) Classify each missing-mint call into a bucket
CREATE OR REPLACE TEMP VIEW missing_mint_buckets AS
SELECT
  mwt.*,
  COALESCE(la.n_links, 0) AS n_links,
  COALESCE(la.n_links_with_mint, 0) AS n_links_with_mint,
  COALESCE(la.n_links_with_evm, 0) AS n_links_with_evm,
  COALESCE(la.n_links_with_solana, 0) AS n_links_with_solana,
  COALESCE(la.n_links_rejected, 0) AS n_links_rejected,
  la.rejection_reasons,
  COALESCE(tpa.has_base58_pattern, 0) AS has_base58_pattern,
  COALESCE(tpa.has_evm_pattern, 0) AS has_evm_pattern,
  COALESCE(tpa.has_ticker_pattern, 0) AS has_ticker_pattern,
  COALESCE(tpa.has_url_pattern, 0) AS has_url_pattern,
  COALESCE(tpa.has_newlines, 0) AS has_newlines,
  COALESCE(tpa.has_zero_width, 0) AS has_zero_width,
  CASE
    -- No bot links at all
    WHEN COALESCE(la.n_links, 0) = 0 THEN 'NO_BOT_LINKS'
    -- Bot links exist but no mint extracted
    WHEN COALESCE(la.n_links, 0) > 0 AND COALESCE(la.n_links_with_mint, 0) = 0 THEN
      CASE
        -- Validation rejected candidates
        WHEN COALESCE(la.n_links_rejected, 0) > 0 THEN 'CANDIDATES_REJECTED_BY_VALIDATION'
        -- EVM found but not used
        WHEN COALESCE(la.n_links_with_evm, 0) > 0 THEN 'EVM_FOUND_BUT_NOT_ASSIGNED'
        -- Solana found but not used
        WHEN COALESCE(la.n_links_with_solana, 0) > 0 THEN 'SOLANA_FOUND_BUT_NOT_ASSIGNED'
        -- Patterns in trigger but not extracted
        WHEN COALESCE(tpa.has_base58_pattern, 0) = 1 OR COALESCE(tpa.has_evm_pattern, 0) = 1 THEN 'PATTERNS_IN_TRIGGER_BUT_NOT_EXTRACTED'
        -- No patterns at all
        ELSE 'NO_PATTERNS_FOUND'
      END
    -- Bot links have mints but call doesn't (join/dedupe issue)
    WHEN COALESCE(la.n_links_with_mint, 0) > 0 THEN 'MINTS_IN_LINKS_BUT_NOT_IN_CALL'
    -- Message text missing
    WHEN mwt.message_text IS NULL THEN 'MESSAGE_TEXT_MISSING'
    ELSE 'OTHER'
  END AS bucket
FROM missing_with_text mwt
LEFT JOIN link_analysis la ON la.trigger_message_id = mwt.message_id AND la.trigger_chat_id = mwt.chat_id
LEFT JOIN trigger_pattern_analysis tpa ON tpa.message_id = mwt.message_id AND tpa.chat_id = mwt.chat_id;

-- 6) Summary counts by bucket
SELECT
  '=' AS separator,
  'BUCKET SUMMARY' AS title,
  '' AS empty1,
  '' AS empty2,
  '' AS empty3
UNION ALL
SELECT
  bucket,
  CAST(COUNT(*) AS VARCHAR) AS n_calls,
  CAST(ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM missing_mint_buckets), 1) AS VARCHAR) || '%' AS pct,
  '' AS empty2,
  '' AS empty3
FROM missing_mint_buckets
GROUP BY bucket
ORDER BY COUNT(*) DESC;

-- 7) Show examples per bucket (top 10 per bucket)
SELECT
  '=' AS separator,
  'EXAMPLES BY BUCKET' AS title,
  '' AS empty1,
  '' AS empty2,
  '' AS empty3
UNION ALL
SELECT
  bucket,
  CAST(call_ts_ms AS VARCHAR) AS timestamp,
  caller_name,
  LEFT(COALESCE(trigger_text, message_text, ''), 100) AS text_snippet,
  CASE
    WHEN n_links_rejected > 0 THEN 'Rejected: ' || LEFT(COALESCE(rejection_reasons, ''), 50)
    WHEN has_base58_pattern = 1 THEN 'Has Base58 pattern'
    WHEN has_evm_pattern = 1 THEN 'Has EVM pattern'
    WHEN has_newlines = 1 THEN 'Has newlines'
    WHEN has_zero_width = 1 THEN 'Has zero-width chars'
    ELSE ''
  END AS notes
FROM missing_mint_buckets
ORDER BY bucket, call_ts_ms DESC
LIMIT 200;

