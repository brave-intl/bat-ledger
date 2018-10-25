select execute($$

insert into migrations (id, description) values ('0006', 'owners');

create table owners(
  owner text primary key,
  created_at timestamp with time zone not null default current_timestamp,
  updated_at timestamp with time zone not null default current_timestamp,

  visible boolean DEFAULT FALSE,
  authorized boolean DEFAULT FALSE,
  provider text not null,
  altcurrency text,
  default_currency text not null,
  parameters jsonb
);

$$) where not exists (select * from migrations where id = '0006');
