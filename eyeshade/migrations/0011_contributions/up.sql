select execute($$

insert into migrations (id, description) values ('0011', 'contributions');

create table contributions(
  viewing_id text primary key,
  payment_id text,
  address text,
  payment_stamp time,
  surveyor_id text,
  altcurrency text,
  probi numeric(28) not null check (probi > 0.0),
  mature boolean,
  fee numeric(28) not null check (fee > 0.0),
  votes int,
  hash text
);

$$) where not exists (select * from migrations where id = '0011');
