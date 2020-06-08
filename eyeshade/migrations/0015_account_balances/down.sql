select execute($$

drop view account_balances;

delete from migrations where id = '0015';

create materialized view account_balances(
  account_type,
  account_id,
  balance
) as
  select
    account_transactions.account_type,
    account_transactions.account_id,
    coalesce(sum(account_transactions.amount), 0.0)
  from account_transactions
  group by (account_transactions.account_type, account_transactions.account_id);

create unique index on account_balances(account_type, account_id);

$$) where exists (select * from migrations where id = '0015');
