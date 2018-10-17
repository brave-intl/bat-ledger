select execute($$

insert into migrations (id, description) values ('0008', 'publishersV2');

create table publishersV2(
  publisher text,
  facet text,
  exclude boolean,
  tags jsonb
)

$$) where not exists (select * from migrations where id = '0008');
