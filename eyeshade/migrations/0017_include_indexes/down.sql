select execute($$

-- DROP INDEX IF EXISTS transactions_with_type_filter_idx;

delete from migrations where id = '0017';

$$) where exists (select * from migrations where id = '0017');
