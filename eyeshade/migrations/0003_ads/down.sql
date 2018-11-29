

delete from migrations where id = '0003';

ALTER TYPE account_type REMOVE value 'payment_id';
ALTER TYPE transaction_type REMOVE value 'ad';
ALTER TYPE transaction_type REMOVE value 'ad_settlement';

refresh materialized view account_balances;
