-- REAL run (commits). Idempotent: spaces reused by name; content only into empty spaces.
\set ON_ERROR_STOP on
\i /private/tmp/claude-501/-Users-aadityamadala-Documents-code-clint-v2/8c6cb36a-3d95-4bf4-a7f5-1227b09f034b/scratchpad/seed-nsclc-lib.sql
begin;
\i /private/tmp/claude-501/-Users-aadityamadala-Documents-code-clint-v2/8c6cb36a-3d95-4bf4-a7f5-1227b09f034b/scratchpad/seed-nsclc-orch.sql
commit;
