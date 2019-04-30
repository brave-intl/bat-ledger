select execute($$

drop table potential_payments_ads;
delete from migrations where id = '0007';

$$) where exists (select * from migrations where id = '0007');
