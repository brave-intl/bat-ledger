select execute($$

insert into migrations (id, description) values ('0012', 'grants');

create table grants(
  grant_id text primary key,
  promotion_id text,
  altcurrency text,
  probi numeric(28) not null check (probi > 0.0),
  payment_id text
);

$$) where not exists (select * from migrations where id = '0012');
