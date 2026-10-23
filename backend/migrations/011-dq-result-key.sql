-- ADR-0006: re-key ops_dq_results by execution identity (table, check, run time), as dqResultKey() in
-- data-quality-service.mjs does, so a result the source updates in place overwrites its row instead of adding one.
-- Duplicates keep the newest fetched row. Claimed occurrences and alert occurrences follow the new key, so failures
-- already acted on are not alerted again. Forward-only and safe to run twice: re-keyed rows map to themselves.
-- The file-store twin is 011-dq-result-key.mjs.
CREATE TEMP TABLE dq_rekey ON COMMIT DROP AS
SELECT project_id, result_key AS old_key, updated_at,
  'dq-result:' || left(encode(sha256(convert_to(concat_ws(chr(31), coalesce(data->>'tableId', ''), coalesce(data->>'checkId', ''), coalesce(data->>'executedAt', '')), 'UTF8')), 'hex'), 40) AS new_key
FROM ops_dq_results;

INSERT INTO ops_alert_occurrences (project_id, occurrence_key, at)
SELECT o.project_id, 'dq:' || k.new_key, min(o.at)
FROM ops_alert_occurrences o JOIN dq_rekey k ON k.project_id = o.project_id AND o.occurrence_key = 'dq:' || k.old_key
WHERE k.new_key <> k.old_key
GROUP BY o.project_id, k.new_key
ON CONFLICT (project_id, occurrence_key) DO NOTHING;

UPDATE ops_alerts a SET data = jsonb_set(a.data, '{occurrences}', (
  SELECT jsonb_agg(CASE WHEN k.new_key IS NULL THEN o ELSE o || jsonb_build_object('resultKey', k.new_key, 'key', 'dq:' || k.new_key) END ORDER BY e.n)
  FROM jsonb_array_elements(a.data->'occurrences') WITH ORDINALITY e(o, n)
  LEFT JOIN dq_rekey k ON k.project_id = a.project_id AND k.old_key = o->>'resultKey' AND k.new_key <> k.old_key))
WHERE a.trigger = 'dqFailed' AND jsonb_typeof(a.data->'occurrences') = 'array' AND jsonb_array_length(a.data->'occurrences') > 0
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.data->'occurrences') o JOIN dq_rekey k ON k.project_id = a.project_id AND k.old_key = o->>'resultKey' AND k.new_key <> k.old_key);

DELETE FROM ops_dq_results r USING (
  SELECT project_id, old_key, row_number() OVER (PARTITION BY project_id, new_key ORDER BY updated_at DESC, old_key) AS rank FROM dq_rekey
) d WHERE d.rank > 1 AND r.project_id = d.project_id AND r.result_key = d.old_key;

UPDATE ops_dq_results r SET result_key = k.new_key, data = r.data || jsonb_build_object('key', k.new_key)
FROM dq_rekey k WHERE r.project_id = k.project_id AND r.result_key = k.old_key AND k.new_key <> k.old_key;
