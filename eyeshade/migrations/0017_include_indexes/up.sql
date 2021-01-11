select execute($$

insert into migrations (id, description) values ('0017', 'include_indexes');

-- CREATE INDEX transactions_with_type_filter_idx
-- ON transactions (from_account, to_account, transaction_type)
-- INCLUDE (created_at, description, channel, amount, settlement_currency, settlement_amount);

$$) where not exists (select * from migrations where id = '0017');
