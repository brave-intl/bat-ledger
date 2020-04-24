select execute($$

/* NOTE: This index should be dropped in production CONCURRENTLY. However */
/* because we we run migrations in a single transaction (see bin/migrate-down.sh) */
/* and you cannot use CONCURRENTLY in a transaction, we have to remove CONCURRENTLY */
/* for the sake of our dev and test environments */

/* drop index concurrently vote_surveyor_id_idx; */

drop index vote_surveyor_id_idx;

$$) where exists (select * from migrations where id = '0014');

