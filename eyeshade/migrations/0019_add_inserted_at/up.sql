select execute($$

insert into migrations (id, description) values ('0019', 'add_inserted_at');

alter table transactions add column
inserted_at timestamp with time zone
not null
default current_timestamp;

create index transactions_inserted_at on transactions(inserted_at);

$$) where not exists (select * from migrations where id = '0019');