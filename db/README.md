# Database

## `schema.sql`

The table behind the funnel counter (`functions/_lib/count.js`).

**This file contains no comments on purpose.** The Cloudflare D1 console
collapses pasted input onto a single line, so a `--` comment swallows the rest
of the statement and the console answers `incomplete input: SQLITE_ERROR`.
Explanation lives here instead; the `.sql` file's only job is to be pasted.

Run the two statements **one at a time**.

## Setting it up

1. **Storage & databases → D1 → Create database**, named `knowyourstrata`
2. Open it → **Console** → paste the `CREATE TABLE` line → Execute
3. Paste the `CREATE INDEX` line → Execute
4. Confirm: `SELECT name FROM sqlite_master WHERE type='table';` returns `events`
5. **Workers & Pages → knowyourstrata → Settings → Bindings** → D1 database,
   variable name **`DB`**, database `knowyourstrata`
6. **Settings → Variables** → `STATS_KEY`, a long random string, as a **secret**
7. **Redeploy.** Pages reads bindings and variables only on the *next*
   deployment. Until then the counter is a silent no-op.

## The data model, and why it is this shape

One row per `(day, name, detail)`:

| column | meaning |
|---|---|
| `day` | `YYYY-MM-DD`, UTC |
| `name` | `tool_used` · `pack_view` · `pack_click` · `subscribed` · `purchased` |
| `detail` | a tool slug, or `bc` / `on`, or empty — always from a closed list |
| `count` | running total |

**The shape is the privacy guarantee.** There is no column for a visitor id, a
session, an IP address, a user agent or a referrer, so none can be stored later
by accident. Two people doing the same thing on the same day are one row with
`count = 2`, and nothing distinguishes them. That is a real accuracy cost, paid
deliberately, and it is disclosed on `/privacy`.

`events_day_idx` exists because `/api/stats` always filters on a date range.

## Reading it back

```
https://knowyourstrata.com/api/stats?key=<STATS_KEY>&days=30
```

Or in the D1 console:

```sql
SELECT day, name, detail, count FROM events ORDER BY day DESC, name LIMIT 50;
```
