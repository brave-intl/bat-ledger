select execute($$

insert into migrations (id, description) values ('0007', 'settlements');

create table settlements(
  settlement_id text,
  publisher text,
  hash text,
  address text,
  owner text,
  altcurrency text,
  probi numeric(28) not null check (probi > 0.0),
  fees numeric(28) not null check (fees > 0.0),
  amount numeric(28) not null check (amount > 0.0),
  commission numeric(28) not null check (commission > 0.0),
  fee numeric(28) not null check (fee > 0.0),
  type text
)

$$) where not exists (select * from migrations where id = '0007');
