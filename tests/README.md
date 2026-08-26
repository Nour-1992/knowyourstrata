# Tests

## `date_math_test.py`

Regression tests for the date calculators, driven through the **real shipped
pages** in a headless browser rather than a re-implementation of the arithmetic.
A test that re-derives the answer only proves it agrees with itself; this proves
the page a council actually loads gives the answer the statute requires.

Covers the cases that break naive date handling and look fine the rest of the
year: **leap years, 28-day Februaries, the turn of the year, and both daylight
saving transitions.** Leap and non-leap cases are deliberately paired on the
same input day so a regression shows up as the two answers converging.

Every case runs under **two timezones** (`America/Vancouver` and
`Pacific/Auckland` — opposite hemispheres, different DST direction, often a
different calendar date). The pages build dates from local components and step
them with `setDate()`, which is timezone independent; running the pair is what
proves it, and would catch a regression to UTC-based arithmetic immediately.

Expected values are derived from the section cited on each page:

| Tool | Rule | Authority |
|---|---|---|
| `bc/agm-notice` | 16 days, +4 for deemed receipt when mailed | SPA ss. 45, 61; Interpretation Act s. 25 |
| `bc/records-deadline` | 14 days for s. 35 records; 7 for bylaws/rules; 7 for a Form B | SPA ss. 36(3), 59(1) |
| `on/records-request-deadline` | 30 days for the board's response | Condominium Act s. 55; O. Reg. 48/01 s. 13.3(6) |

### Running

```bash
pip install playwright
playwright install chromium
python3 tests/date_math_test.py
```

Exit code 0 means every assertion passed. A failure prints the case, the reason
it exists, and the expected-versus-actual answer.

### Adding a tool

Append to `CASES`: the page path, the input field ids and values, the id of the
element holding the answer, the expected text, and one line on *why the case
exists*. That last field is not decoration — it is what tells the next person
whether a failure is a bug or a stale expectation.

Not yet covered: `on/notice-of-meeting-deadline`,
`on/reserve-fund-study-deadline`, `bc/depreciation-report-deadline`. These take
more inputs and branch more; they are the obvious next additions.

## `events_test.py`

Asserts the funnel counter actually fires. Analytics that quietly stops working
is worse than none, because you keep making decisions from a number that has
stopped moving.

Checks that running a calculator sends `tool_used` with the right tool, that
each pack page sends `pack_view` with the right province, and that clicking
checkout sends `pack_click` — plus that the payload contains **nothing but**
`name` and `detail`, so nothing identifying can creep in unnoticed.

It also asserts the two things the counter must *not* do: fire on a page with no
calculator, and fire at all when the browser sends Global Privacy Control.

This suite paid for itself on the first run. `pack_click` had been bound to
`a[href*="buy.stripe.com"]`, but checkout is a `<button id="buyBtn">` that sets
`location.href` — so the selector matched nothing and the most important step in
the funnel would have silently recorded zero for ever. Both are bound now.

```bash
python3 tests/events_test.py
```
