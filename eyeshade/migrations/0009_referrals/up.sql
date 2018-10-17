select execute($$

insert into migrations (id, description) values ('0009', 'referrals');

create table referrals(
  download_id text primary key,
  transaction_id text,
  publisher text,
  owner text,
  platform text,
  finalized time,
  altcurrency text,
  probi numeric(28) not null check (probi > 0.0),
  exclude boolean,
  hash text
)

$$) where not exists (select * from migrations where id = '0009');
