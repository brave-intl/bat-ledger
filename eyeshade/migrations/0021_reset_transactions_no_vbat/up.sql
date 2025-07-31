select execute($outer$

insert into migrations (id, description) values ('0021', 'reset_transactions_no_vbat');

-- DETERMINE THE FINAL BALANCE FOR EACH CHANNEL

DROP TABLE IF EXISTS temp_table_vbat_removal;
CREATE TEMPORARY TABLE temp_table_vbat_removal AS
SELECT
  votes.channel as channel,
  coalesce(sum(votes.amount), 0.0) as amount
FROM votes 
WHERE cohort = 'control' and amount is not null
GROUP BY channel;

 INSERT INTO temp_table_vbat_removal (channel, amount)
 SELECT 
   to_account AS channel,
   coalesce(sum(transactions.amount), 0.0) AS amount
 FROM transactions
 WHERE to_account_type = 'channel' AND transaction_type != 'contribution'
 GROUP BY channel, to_account;


INSERT INTO temp_table_vbat_removal (channel, amount)
SELECT 
  from_account AS channel,
  -coalesce(sum(transactions.amount), 0.0) AS amount
FROM transactions
WHERE from_account_type = 'channel'
GROUP BY channel, from_account;

DROP VIEW IF EXISTS temp_table_vbat_removal_view;
CREATE VIEW temp_table_vbat_removal_view AS SELECT * FROM temp_table_vbat_removal;


DROP TABLE IF EXISTS temp_table_balances_vbat_removal;
CREATE TEMPORARY TABLE temp_table_balances_vbat_removal AS
SELECT 
  channel, 
  SUM(amount) AS unrounded_balance, 
  GREATEST(SUM(amount), 0.0) AS balance 
FROM temp_table_vbat_removal 
GROUP BY channel;

SELECT SUM(balance) FROM temp_table_balances_vbat_removal;


DROP TABLE IF EXISTS temp_balances_past_last_payout_or_just_balance;
CREATE TEMPORARY TABLE temp_balances_past_last_payout_or_just_balance AS
WITH latest_payouts AS (
  SELECT 
    from_account AS channel,
    MAX(created_at) AS latest_payout_date
  FROM 
    transactions
  WHERE 
    from_account_type = 'channel'
  GROUP BY 
    from_account
),
vote_sums AS (
  SELECT 
    lp.channel,
    COALESCE(SUM(v.amount), 0) AS vote_sum
  FROM 
    latest_payouts lp
  LEFT JOIN 
    votes v ON v.channel = lp.channel
      AND v.cohort = 'control'
      AND v.amount IS NOT NULL
      AND v.amount > 0
      AND v.created_at > lp.latest_payout_date
  GROUP BY 
    lp.channel
)
SELECT 
  COALESCE(vs.channel, ttb.channel) AS channel,
  CASE 
    WHEN vs.channel IS NOT NULL THEN vs.vote_sum
    WHEN ttb.balance > 0 THEN ttb.balance
    ELSE 0
  END AS final_balance, 
  vs.vote_sum as VOTE_SUM,
  ttb.balance AS BALANCE_NO_PAYOUT,
  ABS(COALESCE(vs.vote_sum, 0) - COALESCE(ttb.balance, 0)) AS difference
FROM 
  temp_table_balances_vbat_removal ttb
FULL OUTER JOIN 
  vote_sums vs ON ttb.channel = vs.channel
WHERE ttb.balance > 0
ORDER BY difference DESC;

-- PRODUCES ROWS LIKE:
--   {
--     "channel": "mychannel.com",
--     "final_balance": 991.325000000000000000,
--     "vote_sum": null,
--     "balance_no_payout": 991.325000000000000000,
--     "difference": 991.325000000000000000
--   }
-- SELECT * FROM temp_balances_past_last_payout_or_just_balance;








DO $inner$
DECLARE
    fk_record RECORD;
    old_table_name TEXT := 'transactions';
    new_table_name TEXT := 'transactions_old';
BEGIN
    -- Step 1: Drop foreign keys referencing the transactions table
    FOR fk_record IN
        SELECT
            tc.table_name AS referencing_table,
            kcu.column_name AS referencing_column,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column,
            tc.constraint_name AS constraint_name
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
        WHERE
            tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = old_table_name
    LOOP
        -- Drop the foreign key constraint
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I;', fk_record.referencing_table, fk_record.constraint_name);
    END LOOP;
    -- Step 2: Rename the original transactions table
    EXECUTE format('ALTER TABLE %I RENAME TO %I;', old_table_name, new_table_name);
    -- Step 3: Recreate the transactions table with the original name
    EXECUTE format('CREATE TABLE %I (LIKE %I INCLUDING ALL);', old_table_name, new_table_name);
    -- Step 4: Recreate the foreign keys
    FOR fk_record IN
        SELECT
            tc.table_name AS referencing_table,
            kcu.column_name AS referencing_column,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column,
            tc.constraint_name AS constraint_name
        FROM
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
        WHERE
            tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = new_table_name
    LOOP
        -- Recreate the foreign key constraint to point to the new table
        EXECUTE format('
            ALTER TABLE %I
            ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I);',
            fk_record.referencing_table,
            fk_record.constraint_name,
            fk_record.referencing_column,
            old_table_name,
            fk_record.foreign_column
        );
    END LOOP;
END $inner$;


















-- POPULATE THE NEW TRANSACTIONS TABLE
INSERT INTO transactions (
    amount, channel, to_account_type, to_account,
    transaction_type, document_id, description,
    from_account_type, from_account
)
SELECT 
    final_balance, channel, 'channel', channel,
    'contribution', '2024-08-19_vbat-reset', 'votes from 2024-08-19_vbat-reset',
    'uphold', 'TODOINSERTUPHOLDWALLETID'
FROM temp_balances_past_last_payout_or_just_balance;


$outer$) where not exists (select * from migrations where id = '0021');
