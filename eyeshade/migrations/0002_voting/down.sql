select execute($$

drop table votes;
drop table surveyor_groups;

delete from migrations where id = '0002';

$$) where exists (select * from migrations where id = '0002');
