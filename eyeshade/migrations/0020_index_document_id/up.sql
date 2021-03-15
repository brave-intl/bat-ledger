select execute($$

insert into migrations (id, description) values ('0020', 'index_document_id');

/* NOTE: This index was created in production CONCURRENTLY. However */
/* because we we run migrations in a single transaction (see bin/migrate-up.sh) */
/* and you cannot use CONCURRENTLY in a transaction, we have to remove CONCURRENTLY */
/* for the sake of our dev and test environments */

/* create index concurrently transactions_inserted_at on transactions(inserted_at); */

create index transactions_document_id on transactions(document_id);

$$) where not exists (select * from migrations where id = '0020');