INSERT INTO geo_referral_groups
  (id,name,active_at,currency,amount)
VALUES
  ('71341fc9-aeab-4766-acf0-d91d3ffb0bfa','Original','1970-01-01','USD',5),
  ('e48f310b-0e81-4b39-a836-4dda32d7df74','Group 1','2019-10-01','USD',7.5),
  ('6491bbe5-4d50-4c05-af5c-a2ac4a04d14e','Group 2','2019-10-01','USD',6.5),
  ('bda04a7e-ffe9-487c-b472-4b6d30cb5b16','Group 3','2019-10-01','USD',5),
  ('cf70e666-0930-485e-8c66-05e5969622d3','Group 4','2019-10-01','USD',2),
  ('211e57d3-a490-4cf3-b885-47a85f2e1dc0','Group 5','2019-10-01','USD',1)
ON CONFLICT DO NOTHING;