select execute($$

drop table owners;

delete from migrations where id = '0006';

$$) where exists (select * from migrations where id = '0006');
