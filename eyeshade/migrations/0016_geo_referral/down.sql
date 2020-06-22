select execute($$

delete from migrations where id = '0016';

$$) where exists (select * from migrations where id = '0016');
