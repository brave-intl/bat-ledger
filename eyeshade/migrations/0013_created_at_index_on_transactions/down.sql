select execute($$

drop index concurrently transactions_created_at_idx;

$$) where exists (select * from migrations where id = '0013');

