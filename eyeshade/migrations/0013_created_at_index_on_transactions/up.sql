select execute($$
insert into migrations (id, description) values ('0013', 'created_at_index_on_transactions');

create index concurrently transactions_created_at_idx on transactions(created_at);

$$) where not exists (select * from migrations where id = '0013');

