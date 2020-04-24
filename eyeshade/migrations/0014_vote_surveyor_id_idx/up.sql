select execute($$
insert into migrations (id, description) values ('0014', 'vote_surveyor_id_idx');

/* NOTE: This index was created in production CONCURRENTLY. However */
/* because we we run migrations in a single transaction (see bin/migrate-up.sh) */
/* and you cannot use CONCURRENTLY in a transaction, we have to remove CONCURRENTLY */
/* for the sake of our dev and test environments */

/* create index vote_surveyor_id_idx on votes(surveyor_id); */
create index vote_surveyor_id_idx on votes(surveyor_id);

$$) where not exists (select * from migrations where id = '0014');

