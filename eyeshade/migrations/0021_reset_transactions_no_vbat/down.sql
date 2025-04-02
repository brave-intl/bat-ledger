select execute($$

-- Rename the existing table
DROP TABLE IF EXISTS transactions;
ALTER TABLE old_transactions RENAME TO transactions;

delete from migrations where id = '0021';

$$) where exists (select * from migrations where id = '0021');
