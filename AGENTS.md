# Project instructions

Before changing this repository, read these files in order:

1. `docs/PROJECT_MEMORY.md`
2. `docs/REFACTORING_ROADMAP.md`
3. the specification marked as the current step in `docs/PROJECT_MEMORY.md`

## Working rules

- Keep the application deployable as a static GitHub Pages site unless a task
  explicitly changes that decision.
- Treat `supabase/schema.sql` as the current complete schema snapshot. Schema
  updates must preserve existing rows unless the task explicitly requires data
  removal and the user confirms it.
- Never put admin, view, fleet, database-password, secret, or `service_role`
  values in tracked files. `js/config.js` may contain only the public Supabase
  project URL and publishable/anon key.
- Preserve the existing role model: viewer, fleet commander, and main
  administrator. UI hiding is not authorization; every protected operation
  must also be checked by a Supabase RPC.
- When changing timer lifecycle rules or structure types, update every source of
  truth documented in `docs/PROJECT_MEMORY.md` until the shared-domain refactor
  removes that duplication.
- Add or update automated tests for every behavior change. Once refactoring
  step 1 is complete, all tests must run from the repository without absolute
  machine-specific paths.
- After completing a roadmap step, update its status in
  `docs/PROJECT_MEMORY.md` and `docs/REFACTORING_ROADMAP.md`, record important
  decisions, and mark the next specification as current.
- Keep changes incremental. Do not combine a behavior rewrite, visual redesign,
  and database schema update in one step unless the specification requires it.

