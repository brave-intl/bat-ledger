select execute($$

delete from migrations where id = '0011';

drop table snapshots;

$$) where exists (select * from migrations where id = '0011');

