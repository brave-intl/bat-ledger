select execute($$

insert into migrations (id, description) values ('0011', 'virtual_votes');

alter table surveyor_groups add virtual boolean not null default false;

$$) where not exists (select * from migrations where id = '0011');
