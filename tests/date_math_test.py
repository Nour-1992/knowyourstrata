#!/usr/bin/env python3
"""
Date-math regression tests for the Know Your Strata calculators.

Why this exists
---------------
Every claim on this site is that the number is right. The date tools are the
ones where "right" is easiest to get subtly wrong: February, leap years, the
turn of the year, and daylight-saving transitions all break naive date
arithmetic in ways that look fine on an ordinary Tuesday in June.

These tests drive the *real shipped pages* in a real browser rather than
re-implementing the arithmetic. A test that re-derives the answer would only
prove the test agrees with itself; this proves the page a council actually
loads produces the answer the statute requires.

Every expected value below is derived from the section cited on the page:

  bc/agm-notice              20 days (16 + 4 deemed receipt) for mailed notice,
                             16 when handed over  -- SPA ss. 45, 61 + Interpretation Act s. 25
  bc/records-deadline        14 days for s. 35 records, 7 for bylaws/rules,
                             7 for a Form B          -- SPA ss. 36(3), 59(1)
  on/records-request-deadline 30 days for the board's response
                                                     -- Condominium Act s. 55, O. Reg. 48/01 s. 13.3(6)

Each case runs under two very different timezones. The pages build dates from
local components and step them with setDate(), which should be timezone- and
DST-independent; running Vancouver against Auckland (a different UTC offset,
different DST hemisphere, and often a different calendar date) is what proves
it, and would catch a regression to UTC-based arithmetic immediately.

Run:  python3 tests/date_math_test.py
Needs: playwright  (pip install playwright && playwright install chromium)
"""
import asyncio
import http.server
import os
import socketserver
import sys
import threading
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8912
TIMEZONES = ['America/Vancouver', 'Pacific/Auckland']

# page, {field id: value}, result element id, expected text
CASES = [
    # ── BC AGM / SGM notice ──────────────────────────────────────────────
    ('/bc/agm-notice', {'meeting': '2026-10-15', 'method': '4'}, 'deadline',
     'Friday, September 25, 2026',
     'mailed notice: 16 + 4 deemed receipt; the worked example on the homepage'),
    ('/bc/agm-notice', {'meeting': '2026-10-15', 'method': '0'}, 'deadline',
     'Tuesday, September 29, 2026',
     'handed over: 16 days, no deemed-receipt addition'),
    ('/bc/agm-notice', {'meeting': '2024-03-01', 'method': '0'}, 'deadline',
     'Wednesday, February 14, 2024',
     'LEAP: counting back across 29 February'),
    ('/bc/agm-notice', {'meeting': '2026-03-01', 'method': '0'}, 'deadline',
     'Friday, February 13, 2026',
     'NON-LEAP: same input day, one day earlier than the leap year'),
    ('/bc/agm-notice', {'meeting': '2027-01-05', 'method': '0'}, 'deadline',
     'Sunday, December 20, 2026',
     'counting back across the turn of the year'),
    ('/bc/agm-notice', {'meeting': '2026-11-10', 'method': '0'}, 'deadline',
     'Sunday, October 25, 2026',
     'spans the end of daylight saving'),
    ('/bc/agm-notice', {'meeting': '2026-03-20', 'method': '0'}, 'deadline',
     'Wednesday, March 4, 2026',
     'spans the start of daylight saving'),

    # ── BC records request ───────────────────────────────────────────────
    ('/bc/records-deadline', {'kind': 'general', 'received': '2026-02-20'}, 'deadline',
     'Friday, March 6, 2026',
     'NON-LEAP: 14 days across a 28-day February'),
    ('/bc/records-deadline', {'kind': 'general', 'received': '2024-02-20'}, 'deadline',
     'Tuesday, March 5, 2024',
     'LEAP: same input day, one day earlier than the non-leap year'),
    ('/bc/records-deadline', {'kind': 'bylaws', 'received': '2026-12-28'}, 'deadline',
     'Monday, January 4, 2027',
     'bylaws are the 1-week exception, across the year boundary'),
    ('/bc/records-deadline', {'kind': 'formb', 'received': '2026-11-01'}, 'deadline',
     'Sunday, November 8, 2026',
     'Form B is 1 week under s. 59(1), starting on the DST change day'),

    # ── Ontario records request, board's response ────────────────────────
    ('/on/records-request-deadline', {'received': '2026-01-31'}, 'deadline1',
     'Monday, March 2, 2026',
     'NON-LEAP: 30 days from a month-end into March'),
    ('/on/records-request-deadline', {'received': '2024-01-31'}, 'deadline1',
     'Friday, March 1, 2024',
     'LEAP: same input day lands a day earlier in the calendar'),
    ('/on/records-request-deadline', {'received': '2026-12-15'}, 'deadline1',
     'Thursday, January 14, 2027',
     '30 days across the turn of the year'),
]


class Handler(http.server.SimpleHTTPRequestHandler):
    """Approximate Cloudflare Pages: /bc/quorum serves bc/quorum.html."""
    def translate_path(self, path):
        p = urlparse(path).path
        fs = os.path.join(ROOT, p.lstrip('/'))
        if os.path.isdir(fs) and os.path.isfile(os.path.join(fs, 'index.html')):
            return os.path.join(fs, 'index.html')
        if not os.path.isfile(fs) and os.path.isfile(fs + '.html'):
            return fs + '.html'
        return fs

    def do_POST(self):
        # Emulate the /api/event Pages Function so the counter beacon behaves
        # here the way it does in production. Anything else stays a 501, so a
        # real unexpected POST is still visible.
        from urllib.parse import urlparse as _u
        if _u(self.path).path == '/api/event':
            try:
                n = int(self.headers.get('content-length') or 0)
                if n: self.rfile.read(n)
            except Exception:
                pass
            self.send_response(204); self.end_headers(); return
        self.send_error(501, "Unsupported method ('POST')")

    def log_message(self, *a):
        pass


async def main():
    from playwright.async_api import async_playwright

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    failures = []
    passed = 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        for tz in TIMEZONES:
            ctx = await browser.new_context(timezone_id=tz, locale='en-CA')
            page = await ctx.new_page()
            js_errors = []
            page.on('pageerror', lambda e: js_errors.append(str(e)))

            print(f'\n── {tz} ' + '─' * (58 - len(tz)))
            for url, fields, result_id, expected, why in CASES:
                js_errors.clear()
                await page.goto(f'http://127.0.0.1:{PORT}{url}', wait_until='load')

                for field_id, value in fields.items():
                    tag = await page.evaluate(
                        f"() => document.getElementById({field_id!r}).tagName")
                    if tag == 'SELECT':
                        await page.select_option(f'#{field_id}', value)
                    else:
                        await page.fill(f'#{field_id}', value)

                await page.click('#calc')
                await page.wait_for_timeout(120)
                got = (await page.inner_text(f'#{result_id}')).strip()

                label = f'{url}  {fields}'
                if got == expected and not js_errors:
                    passed += 1
                    print(f'  PASS  {url:32s} -> {got}')
                else:
                    detail = f'expected {expected!r}, got {got!r}'
                    if js_errors:
                        detail += f' | JS errors: {js_errors[:2]}'
                    failures.append(f'[{tz}] {label}\n         {why}\n         {detail}')
                    print(f'  FAIL  {url:32s} -> {got}   (want {expected})')
            await ctx.close()
        await browser.close()

    print()
    if failures:
        print(f'{len(failures)} FAILED, {passed} passed\n')
        for f in failures:
            print(' *', f)
        sys.exit(1)
    print(f'All {passed} date-math assertions passed '
          f'({len(CASES)} cases x {len(TIMEZONES)} timezones).')


if __name__ == '__main__':
    asyncio.run(main())
