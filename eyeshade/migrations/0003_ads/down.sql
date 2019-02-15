select execute($$

delete from migrations where id = '0003';

drop materialized view account_balances;
drop view account_transactions;

create type account_type as enum ('channel', 'owner', 'uphold', 'internal');
create type transaction_type as enum ('contribution', 'referral', 'contribution_settlement', 'referral_settlement', 'fees', 'scaleup', 'manual');

alter table transactions drop constraint check_from_account_type;
alter table transactions drop constraint check_to_account_type;

alter table transactions alter column from_account_type type account_type using from_account_type::text::account_type;
alter table transactions alter column to_account_type type account_type using to_account_type::text::account_type;

alter table transactions drop constraint check_transaction_type;

alter table transactions alter column transaction_type type transaction_type using transaction_type::text::transaction_type;

create view account_transactions(
  created_at,
  description,
  transaction_type,
  document_id,
  account_type,
  account_id,
  amount,
  channel,
  settlement_currency,
  settlement_amount,
  settlement_destination_type,
  settlement_destination
) as
  select
    transactions.created_at,
    transactions.description,
    transactions.transaction_type,
    transactions.document_id,
    transactions.from_account_type,
    transactions.from_account,
    (0.0 - transactions.amount),
    transactions.channel,
    transactions.settlement_currency,
    transactions.settlement_amount,
    transactions.to_account_type,
    transactions.to_account
  from transactions where transaction_type in ('contribution_settlement', 'referral_settlement')
union all
  select
    transactions.created_at,
    transactions.description,
    transactions.transaction_type,
    transactions.document_id,
    transactions.from_account_type,
    transactions.from_account,
    (0.0 - transactions.amount),
    transactions.channel,
    transactions.settlement_currency,
    transactions.settlement_amount,
    null,
    null
  from transactions where transaction_type not in ('contribution_settlement', 'referral_settlement')
union all
  select
    transactions.created_at,
    transactions.description,
    transactions.transaction_type,
    transactions.document_id,
    transactions.to_account_type,
    transactions.to_account,
    transactions.amount,
    transactions.channel,
    transactions.settlement_currency,
    transactions.settlement_amount,
    null,
    null
  from transactions;

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

refresh materialized view account_balances;

$$) where exists (select * from migrations where id = '0003');
