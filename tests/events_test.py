#!/usr/bin/env python3
"""
Funnel instrumentation tests.

Analytics that quietly stops firing is worse than none, because you go on
making decisions from a number that has stopped moving. These tests assert that
the three browser-side events actually leave the page, carry the right name and
detail, and that nothing identifying rides along with them.

They also assert the two things the counter must NOT do: fire on a page with no
calculator, and fire at all when the visitor sends Global Privacy Control.

Run:  python3 tests/events_test.py
Needs: playwright
"""
import asyncio
import http.server
import json
import os
import socketserver
import sys
import threading
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8913


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = urlparse(path).path
        fs = os.path.join(ROOT, p.lstrip('/'))
        if os.path.isdir(fs) and os.path.isfile(os.path.join(fs, 'index.html')):
            return os.path.join(fs, 'index.html')
        if not os.path.isfile(fs) and os.path.isfile(fs + '.html'):
            return fs + '.html'
        return fs

    def do_POST(self):
        if urlparse(self.path).path == '/api/event':
            try:
                n = int(self.headers.get('content-length') or 0)
                if n:
                    self.rfile.read(n)
            except Exception:
                pass
            self.send_response(204)
            self.end_headers()
            return
        self.send_error(501, "Unsupported method ('POST')")

    def log_message(self, *a):
        pass


async def main():
    from playwright.async_api import async_playwright

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    problems = []
    checks = 0

    def check(label, cond, detail=''):
        nonlocal checks
        checks += 1
        if cond:
            print(f'  PASS  {label}')
        else:
            print(f'  FAIL  {label}   {detail}')
            problems.append(f'{label}  {detail}')

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()

        async def collect(path, action=None, gpc=False):
            """Load a page, optionally act, and return the event payloads sent."""
            ctx = await browser.new_context()
            if gpc:
                await ctx.add_init_script(
                    "Object.defineProperty(navigator,'globalPrivacyControl',"
                    "{get:()=>true,configurable:true});")
            page = await ctx.new_page()
            sent = []

            async def on_route(route):
                try:
                    sent.append(json.loads(route.request.post_data or '{}'))
                except Exception:
                    sent.append({'unparsed': route.request.post_data})
                await route.fulfill(status=204, body='')

            await page.route('**/api/event', on_route)
            await page.goto(f'http://127.0.0.1:{PORT}{path}', wait_until='load')
            await page.wait_for_timeout(200)
            if action:
                await action(page)
                await page.wait_for_timeout(250)
            await ctx.close()
            return sent

        print('\n── tool_used ' + '─' * 48)
        async def run_calc(p):
            await p.fill('#meeting', '2026-10-15')
            await p.click('#calc')
        sent = await collect('/bc/agm-notice', run_calc)
        check('running a calculator sends exactly one event', len(sent) == 1, str(sent))
        if sent:
            check('name is tool_used', sent[0].get('name') == 'tool_used', str(sent[0]))
            check('detail identifies the tool', sent[0].get('detail') == 'bc/agm-notice', str(sent[0]))
            check('payload carries nothing but name and detail',
                  set(sent[0].keys()) == {'name', 'detail'}, str(sent[0].keys()))

        print('\n── pack_view ' + '─' * 48)
        sent = await collect('/bc/starter-pack')
        views = [e for e in sent if e.get('name') == 'pack_view']
        check('opening the BC pack page sends pack_view', len(views) == 1, str(sent))
        if views:
            check("detail is 'bc'", views[0].get('detail') == 'bc', str(views[0]))
        sent = await collect('/on/starter-pack')
        views = [e for e in sent if e.get('name') == 'pack_view']
        check("Ontario pack page sends detail 'on'",
              len(views) == 1 and views[0].get('detail') == 'on', str(sent))

        print('\n── pack_click ' + '─' * 47)
        async def click_buy(p):
            # Checkout is a <button id="buyBtn"> that sets location.href, not an
            # anchor. Block the outbound navigation so the page survives long
            # enough to observe the beacon, then click exactly as a buyer would.
            await p.route('**buy.stripe.com/**', lambda r: asyncio.ensure_future(r.abort()))
            await p.click('#buyBtn')

        sent = await collect('/bc/starter-pack', click_buy)
        clicks = [e for e in sent if e.get('name') == 'pack_click']
        check('clicking the checkout link sends pack_click', len(clicks) >= 1, str(sent))
        if clicks:
            check("pack_click detail is 'bc'", clicks[0].get('detail') == 'bc', str(clicks[0]))

        print('\n── must not fire ' + '─' * 44)
        sent = await collect('/about')
        check('a page with no calculator sends nothing', sent == [], str(sent))

        sent = await collect('/bc/starter-pack', gpc=True)
        check('Global Privacy Control suppresses everything', sent == [], str(sent))

        sent = await collect('/bc/agm-notice', run_calc, gpc=True)
        check('GPC suppresses tool_used too', sent == [], str(sent))

        await browser.close()

    print()
    if problems:
        print(f'{len(problems)} FAILED of {checks}\n')
        for p in problems:
            print(' *', p)
        sys.exit(1)
    print(f'All {checks} instrumentation assertions passed.')


if __name__ == '__main__':
    asyncio.run(main())
