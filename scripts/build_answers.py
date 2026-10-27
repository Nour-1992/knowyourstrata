#!/usr/bin/env python3
"""
Put a one-paragraph "Short answer" under the heading of every tool page, and
write /llms.txt, both from scripts/tools.json.

Why: AI answer engines (Copilot, ChatGPT search, Perplexity) quote a page when
it states the answer in one self-contained sentence with its source. Copilot
was already citing these pages before this existed. The answer line makes the
quotable sentence explicit instead of leaving the engine to assemble it from
the explanation further down.

Every answer restates a claim the page already makes in its verified
explanation. It is NOT a new legal claim, and it must never be edited on its
own: change the explanation, re-verify, then change the answer in tools.json
to match. On a LEGAL week the watcher responder greps tools.json for the
changed section along with the pages.

    python3 scripts/build_answers.py           # rewrite pages and llms.txt
    python3 scripts/build_answers.py --check   # exit 1 if anything is stale
"""
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = json.load(open(os.path.join(ROOT, 'scripts', 'tools.json'), encoding='utf-8'))
SITE = 'https://knowyourstrata.com'

ANSWER_RX = re.compile(r'\n?\s*<p class="answer" id="answer">.*?</p>', re.S)
LEDE_RX = re.compile(r'(<header>.*?<p class="lede"[^>]*>.*?</p>)', re.S)


def answer_html(t):
    return ('\n    <p class="answer" id="answer"><span class="answer-k">Short answer</span> '
            '%s <span class="answer-cite">%s</span></p>') % (html.escape(t['answer'], quote=False),
                                                              html.escape(t['answer_cite'], quote=False))


def page(t, s):
    s = ANSWER_RX.sub('', s, count=1)
    m = LEDE_RX.search(s)
    if not m:
        raise SystemExit('no header lede in ' + t['href'])
    return s[:m.end()] + answer_html(t) + s[m.end():]


def question(t):
    s = open(os.path.join(ROOT, t['href'].strip('/') + '.html'), encoding='utf-8').read()
    q = html.unescape(re.sub(r'<[^>]+>', '', re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S).group(1))).strip()
    return q if q.endswith('?') else q + '.'


def llms():
    out = ['# Know Your Strata', '',
           '> Free compliance calculators for British Columbia strata councils and Ontario condo boards. '
           'Every answer cites the section of the statute or regulation it rests on and the date a person last '
           'verified it. The sources are re-checked automatically every Monday.', '',
           'Each tool page states a short answer under its heading, then the calculator, then the full explanation '
           'with quoted sections. General information, not legal advice.', '']
    for prov, title in (('BC', 'British Columbia (Strata Property Act)'), ('ON', 'Ontario (Condominium Act, 1998)')):
        out += ['## ' + title, '']
        for t in DATA['tools']:
            if t['prov'] == prov:
                out.append('- [%s](%s%s): %s %s (%s)' % (t['name'], SITE, t['href'], question(t), t['answer'], t['answer_cite']))
        out.append('')
    out += ['## Guides', '',
            '- [What changes for Ontario condo boards on December 31, 2026](%s/on/december-31-2026-changes): '
            'the new requisition process (prescribed form, 20 day board answer, 40 day meeting clock), the reserved seat '
            'moving to non-leased voting units, and which date decides (O. Reg. 48/01 ss. 79 to 81)' % SITE, '']
    out += ['## About the site', '',
            '- [How we verify](%s/how-we-verify): the method behind every verification date' % SITE,
            '- [Monitoring record](%s/monitoring): every weekly source check and what it found' % SITE,
            '- [Embed a calculator](%s/embed): free calculators for strata and condo websites' % SITE, '']
    return '\n'.join(out)


def main():
    check = '--check' in sys.argv
    stale = []
    for t in DATA['tools']:
        p = os.path.join(ROOT, t['href'].strip('/') + '.html')
        s = open(p, encoding='utf-8').read()
        n = page(t, s)
        if n != s:
            stale.append(t['href'])
            if not check:
                open(p, 'w', encoding='utf-8', newline='').write(n)
    lp = os.path.join(ROOT, 'llms.txt')
    want = llms()
    have = open(lp, encoding='utf-8').read() if os.path.exists(lp) else ''
    if have != want:
        stale.append('/llms.txt')
        if not check:
            open(lp, 'w', encoding='utf-8', newline='').write(want)
    if check:
        if stale:
            print('stale:', ' '.join(stale))
            sys.exit(1)
        print('answers and llms.txt current (%d tools)' % len(DATA['tools']))
    else:
        print('updated %d file(s)' % len(stale))


if __name__ == '__main__':
    main()
