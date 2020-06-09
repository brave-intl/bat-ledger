select execute($$

insert into migrations (id, description) values ('0015', 'account_balances');

drop materialized view account_balances;

create view account_balances(
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

$$) where not exists (select * from migrations where id = '0015');
