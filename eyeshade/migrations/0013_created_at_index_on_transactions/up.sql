select execute($$
insert into migrations (id, description) values ('0013', 'created_at_index_on_transactions');


/* NOTE: This index was created in production CONCURRENTLY. However */
/* because we we run migrations in a single transaction (see bin/migrate-up.sh) */
/* and you cannot use CONCURRENTLY in a transaction, we have to remove CONCURRENTLY */
/* for the sake of our dev and test environments */

/* create index concurrently transactions_created_at_idx on transactions(created_at); */

create index transactions_created_at_idx on transactions(created_at);

$$) where not exists (select * from migrations where id = '0013');

