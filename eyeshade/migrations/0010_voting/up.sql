select execute($$

insert into migrations (id, description) values ('0010', 'voting');

create table voting(
  surveyor_id text primary key,
  publisher text,
  cohort text,
  counts int,
  exclude boolean,
  hash text,
  satoshis bigint,
  altcurrency text,
  probi numeric(28) not null check (probi > 0.0)
)

$$) where not exists (select * from migrations where id = '0001');
