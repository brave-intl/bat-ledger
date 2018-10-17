select execute($$

insert into migrations (id, description) values ('0003', 'wallets');

create table wallets(
  payment_id text primary key,
  created_at timestamp with time zone not null default current_timestamp,
  address text,
  provider text,
  balances jsonb,
  keychains jsonb,
  payment_stamp time,
  altcurrency text
)

$$) where not exists (select * from migrations where id = '0003');
