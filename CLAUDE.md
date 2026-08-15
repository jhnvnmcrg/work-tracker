# work-tracker

Personal Daily Time Record (DTR) + payslip system for Philippine payroll. Manual
time entry, semi-monthly payslips with statutory deductions, leave/holiday
tracking, analytics, and a read-only AI assistant.

## Stack

TanStack Start (React 19, file routes, Nitro SSR) · Clerk auth · Neon Postgres +
Drizzle · shadcn/ui + Tailwind 4 · `@tanstack/ai` via OpenRouter · Vitest.

## Conventions

- **Package manager: npm.** Path alias `#/*` → `./src/*`.
- **Biome**, not Prettier/ESLint: **tabs**, **double quotes**. Run `npm run check`.
  Note `src/styles.css` and `src/routeTree.gen.ts` are excluded from Biome.
- **shadcn base is `radix`** (confirmed via `npx shadcn@latest info --json`), so
  primitives use `asChild`, `<Select>` with inline children, and
  `<ToggleGroup type="single">` — *not* the Base UI `render` / `items` / `multiple`
  APIs. Add components with `npx shadcn@latest add <name>`.
- `src/routeTree.gen.ts` is generated. Never edit it; run `npm run generate-routes`.

## Domain rules that are easy to get wrong

- **Pay periods are 1–16 and 17–end-of-month.** Not 1-15/16-EOM. The second
  cutoff is 12/13/14/15 days depending on the month. Enforced by a CHECK
  constraint on `pay_periods`.
- **Times are integer minutes since local midnight**, anchored to a `date`
  string — never `timestamptz`, never a JS `Date`. Values may exceed 1440 for a
  punch after midnight (1530 = 01:30 next day).
- **Money is integer centavos; rates are integer parts-per-million.** No floats,
  no `numeric` strings in arithmetic. Everything goes through `mulDivRound`.
  `SUM(bigint)` comes back from Postgres as a *string* — use `parseCentavos()`.
- **All date math uses `Date.UTC` / `getUTC*`.** A bare `getDay()` shifts the
  whole cutoff assignment and only reproduces on a server in another timezone.
- **Base pay is half-month flat**: `floor(monthly/2)`, remainder to cutoff 2.
  With a flat base you must *not* also add regular pay per worked day — late,
  undertime and absence are itemized subtractions.
- **Statutory contributions are computed before the tax base**, because they're
  excluded from taxable compensation. `reducesTaxableGross` is deliberately
  decoupled from `section`.
- Working-days factor is **313** (covers holidays, not rest days). SSS /
  PhilHealth / Pag-IBIG are all withheld on the **1–16** cutoff.
- **The factor must agree with the work schedule.** 313 = 365 − 52 Sundays, i.e.
  a *six-day* week; 261 is the five-day equivalent. Pairing 313 with a Mon–Fri
  schedule means a flat base earns ₱2,250 per workday while an absence deducts
  only ₱1,725.24 — absences under-deduct by about a quarter. `computePayslip`
  raises a non-blocking `factor_schedule_mismatch` warning when the two disagree
  by more than 5%.

## Hard architectural constraints

- **Nothing under `src/lib/payroll/` may import `#/db`.** The engine is pure so
  it can be unit-tested without a database and so snapshot replay works.
- **Every server function is created via `protectedFn` from `src/server/fn.ts`**,
  never raw `createServerFn`. It injects the Clerk `userId` server-side.
- `context.userId` from `beforeLoad` is client-reachable — use it for rendering
  and cache keys only, never as a server-function argument.
- **The AI assistant is read-only at the database-grant level** (`DATABASE_URL_READONLY`,
  a SELECT-only role). Tools under `src/lib/ai/tools/` import `db-readonly`, never
  `#/db`. No tool input schema may contain a user identifier.

## Commands

```
npm run dev            # port 3000
npm run typecheck      # tsc --noEmit
npm run check          # biome
npm test               # vitest run
npm run db:generate    # after changing src/db/schema/
npm run db:migrate     # apply — never db:push, this holds financial records
npm run db:studio

npm run verify:dtr      # DTR write path against a real database
npm run verify:leave    # leave, balances and holiday interaction
npm run verify:payroll  # statutory tables, payslip persistence, DTR locking
npm run verify:dashboard # aggregation and anomaly detection
```

The `verify:*` scripts exist because unit tests cannot reach SQL-level faults
(column naming, constraints, cascades). They call the same functions the server
functions call — `fileLeaveFor`, `cancelLeaveFor` — so they cannot drift from
the real path. Each writes and then removes a throwaway user.

`@tanstack/ai` ships its own authoritative docs at
`node_modules/@tanstack/ai/skills/ai-core/` — read those, not the website.

## Operational gotchas found the hard way

- **`DATABASE_URL` points at Neon's `-pooler` host.** DDL over PgBouncer
  transaction pooling *hangs* rather than failing, so `drizzle.config.ts` strips
  `-pooler` for migrations (override with `DATABASE_URL_UNPOOLED`). The app
  itself is fine on the pooler.
- **drizzle-kit emits foreign keys before indexes.** A composite FK target must
  therefore be a table `unique()` constraint, not a `uniqueIndex()`, or the
  migration fails with "no unique constraint matching given keys".
- **The snake_case converter splits digit boundaries** — `workingDaysFactorX100`
  becomes `working_days_factor_x_100`. That column is named explicitly.
- **Never hand-build `excluded.<column>` for an upsert.** Under
  `casing: "snake_case"` drizzle applies the transform when it builds the query,
  while column objects still carry their TypeScript names (`keyAsName: true`), so
  the clause emits camelCase and fails with *column excluded.amInMinute does not
  exist*. `upsertRecords` uses delete-then-insert inside one transaction instead.
  Unit tests cannot catch this class of bug — `npm run verify:dtr` does.
- **Vitest uses its own `vitest.config.ts`**, not `vite.config.ts`, so tests do
  not load the React compiler or claim a Neon database.
- Biome's `includes` must stay anchored (`src/**`, not `**/src/**`) or it
  reformats the vendored skill templates under `.agents/`.

The dev database is a Neon Launchpad claim that **expires after 72 hours**.
