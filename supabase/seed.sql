-- Local and CI databases only: the hosted projects never run the seed.

-- The test-clock mark. private.now() honours curio.test_now only on a database carrying this
-- comment, and only the database's owner can change it (DB-CLK-01). Tests pin the time with
-- select set_config('curio.test_now', '<time>', true).
comment on database postgres is 'curio:test-clock';

-- The test cast (test specification §1) arrives with T09.
