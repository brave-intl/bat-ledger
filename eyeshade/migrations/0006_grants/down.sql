select execute($$

alter table grants drop constraint check_grant_type;
drop table grants;

delete from migrations where id = '0006';

$$) where exists (select * from migrations where id = '0006');
