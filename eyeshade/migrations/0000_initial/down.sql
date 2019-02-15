select execute($$

delete from migrations where id = '0000';
drop table migrations;

$$) where table_exists('public', 'migrations');
