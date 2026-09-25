# Testing rules
- Integration tests use the real `acc_test` database via `resetTestDatabase()`; never point tests at dev/prod.
- Every new route gets: happy path, 401, 403 (wrong role), 400 (invalid input) tests.
- Agent tests use `MockProvider` scripted responses; no network calls in the default test run.
- Never skip or delete a failing test to get green — fix the cause.
