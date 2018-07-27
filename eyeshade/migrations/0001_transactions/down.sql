drop materialized view account_balances;
drop view account_transactions;
drop table transactions;

drop type account_type;
drop type transaction_type;

delete from migrations where id = '0001';
