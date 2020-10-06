select execute($$

insert into migrations (id, description) values ('0019', 'add_inserted_at');

alter table transactions add column
inserted_at timestamp with time zone
not null
default current_timestamp;

update transactions set inserted_at = created_at;

$$) where not exists (select * from migrations where id = '0019');