# Project instructions

The project is a completed and stable v1.0. Read `README.md` before changing it.

## Working rules

- Keep the application deployable as a static GitHub Pages site unless a task
  explicitly changes that decision.
- Treat `supabase/schema.sql` as the single complete and idempotent schema for
  new and existing Supabase databases.
- Preserve existing rows unless a task explicitly requires data removal and
  the user confirms it.
- Never put admin, view, fleet, database-password, secret, or `service_role`
  values in tracked files. `js/config.js` may contain only the public Supabase
  project URL and Publishable/anon key.
- Preserve the roles viewer, fleet commander, and main administrator. UI
  hiding is not authorization; every protected operation must be checked by a
  Supabase RPC.
- Keep lifecycle rules and allowed values synchronized between `js/core/`,
  `supabase/schema.sql`, and their tests.
- Add or update automated tests for every behavior change. All tests must run
  without machine-specific paths.
- Update `README.md` whenever setup, behavior, security, architecture, or
  operational limitations change.
- Do not add roadmap, migration, memory, or stage-specification files for
  completed work. Create a new design document only for a genuinely new,
  approved feature that cannot be explained clearly in the issue or commit.
- Keep changes incremental and avoid unrelated redesigns or refactors.

