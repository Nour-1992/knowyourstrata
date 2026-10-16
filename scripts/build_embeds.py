#!/usr/bin/env python3
"""
Keep the embed feature in step with scripts/tools.json.

  1. Fills the calculator picker on /embed (embed.html) between the
     embed-options markers, grouped by province.
  2. Puts one "Add this calculator to your website" line under the calculator
     on every tool page, linking to /embed with that tool preselected.

How embedding works, for the record: any tool page opened with ?embed=1 shows
only its calculator (the theme boot script adds the kys-embed class; the CSS in
assets/kys-ui.css hides the rest; assets/kys-embed.js adds a credit line and
reports the frame height). The host site pastes an iframe, a visible credit
link to the tool page, and optionally assets/embed.js to resize the frame.
The canonical tag on every tool page points at the clean URL, so the ?embed=1
variant never competes with it in search.

    python3 scripts/build_embeds.py           # rewrite
    python3 scripts/build_embeds.py --check   # exit 1 if anything is stale
"""
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = json.load(open(os.path.join(ROOT, 'scripts', 'tools.json'), encoding='utf-8'))['tools']

OPT_RX = re.compile(r'(<!-- embed-options:start -->\n).*?(<!-- embed-options:end -->)', re.S)
OFFER_RX = re.compile(r'\n+  <p class="embed-offer no-print">.*?</p>\n', re.S)
EXPLAIN = '\n  <section class="explain"'


def options():
    out = []
    for prov, label in (('BC', 'British Columbia'), ('ON', 'Ontario')):
        out.append('          <optgroup label="%s">' % label)
        for t in TOOLS:
            if t['prov'] == prov:
                out.append('            <option value="%s" data-name="%s">%s</option>' % (
                    t['href'], html.escape(t['name']), html.escape(t['name'], quote=False)))
        out.append('          </optgroup>')
    return '\n'.join(out) + '\n'


def offer(t):
    return ('\n  <p class="embed-offer no-print"><a href="/embed?tool=%s">Add this calculator to your '
            'building&rsquo;s website</a> &middot; free, and it stays current</p>\n') % t['href'].strip('/')


def main():
    check = '--check' in sys.argv
    stale = []

    p = os.path.join(ROOT, 'embed.html')
    s = open(p, encoding='utf-8').read()
    if not OPT_RX.search(s):
        raise SystemExit('embed.html has no embed-options markers')
    n = OPT_RX.sub(lambda m: m.group(1) + options() + '          ' + m.group(2), s, count=1)
    if n != s:
        stale.append('/embed')
        if not check:
            open(p, 'w', encoding='utf-8', newline='').write(n)

    for t in TOOLS:
        p = os.path.join(ROOT, t['href'].strip('/') + '.html')
        s = open(p, encoding='utf-8').read()
        n = OFFER_RX.sub('\n', s, count=1)
        if EXPLAIN not in n:
            raise SystemExit('no explain section in ' + t['href'])
        n = n.replace(EXPLAIN, offer(t).rstrip('\n') + '\n' + EXPLAIN, 1)
        if n != s:
            stale.append(t['href'])
            if not check:
                open(p, 'w', encoding='utf-8', newline='').write(n)

    if check:
        if stale:
            print('stale:', ' '.join(stale))
            sys.exit(1)
        print('embed picker and %d offer lines current' % len(TOOLS))
    else:
        print('updated %d file(s)' % len(stale))


if __name__ == '__main__':
    main()
