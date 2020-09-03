select execute($$

DROP INDEX IF EXISTS balance_snapshots_created_at_idx;

delete from migrations where id = '0018';

$$) where exists (select * from migrations where id = '0018');
