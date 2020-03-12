select execute($$

drop table balance_snapshots;
drop table balance_snapshot_accounts;

delete from migrations where id = '0012';

$$) where exists (select * from migrations where id = '0012');
