select execute($$

alter table surveyor_groups drop column virtual;

delete from migrations where id = '0011';

$$) where exists (select * from migrations where id = '0011');
