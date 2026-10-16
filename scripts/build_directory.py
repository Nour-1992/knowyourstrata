#!/usr/bin/env python3
"""
Render the tool directory from scripts/tools.json into the homepage and the
two province hubs, between <!-- tools:start --> and <!-- tools:end -->.

tools.json is the one list of tools: name, province, section, topic and the
one-line description. Add a tool there, run this, and the homepage, both hubs
and the counts all agree.

    python3 scripts/build_directory.py           # rewrite
    python3 scripts/build_directory.py --check   # exit 1 if a page is stale
"""
import html, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = json.load(open(os.path.join(ROOT, 'scripts', 'tools.json'), encoding='utf-8'))
WORDS = {11: 'Eleven', 12: 'Twelve', 13: 'Thirteen', 14: 'Fourteen', 15: 'Fifteen', 23: 'Twenty-three', 24: 'Twenty-four', 25: 'Twenty-five', 26: 'Twenty-six'}
PAGES = {'index.html': None, 'bc/index.html': 'BC', 'on/index.html': 'ON'}
BLOCK = re.compile(r'<!-- tools:start -->.*?<!-- tools:end -->', re.S)
COUNT = re.compile(r'(<span data-count="(ALL|BC|ON)">)[^<]*(</span>)')
E = lambda s: html.escape(s, quote=True)


def card(t):
    return ('<a class="tcard" href="%s" data-prov="%s" data-topic="%s">'
            '<span class="tcard-top"><span class="tcard-prov">%s</span><span class="tcard-cite">%s</span></span>'
            '<span class="tcard-name">%s</span><span class="tcard-desc">%s</span>'
            '<span class="tcard-foot"><span class="t">%s</span><span class="go">Open &rarr;</span></span></a>') % (
        t['href'], t['prov'], t['topic'], 'BC' if t['prov'] == 'BC' else 'ON', E(t['cite']), E(t['name']), E(t['desc']), E(DATA['topics'][t['topic']]))


def render(prov):
    tools = [t for t in DATA['tools'] if prov is None or t['prov'] == prov]
    return '<!-- tools:start -->\n<div class="dir-grid" id="dirGrid">\n' + '\n'.join(card(t) for t in tools) + \
        '\n<p class="dir-empty" id="dirEmpty" hidden>No tool matches that yet. Try a broader word, or clear the filters.</p>\n</div>\n<!-- tools:end -->'


def counts(s):
    n = {'ALL': len(DATA['tools']), 'BC': sum(t['prov'] == 'BC' for t in DATA['tools']), 'ON': sum(t['prov'] == 'ON' for t in DATA['tools'])}
    return COUNT.sub(lambda m: m.group(1) + (str(n['ALL']) if m.group(2) == 'ALL' else WORDS.get(n[m.group(2)], str(n[m.group(2)]))) + m.group(3), s)


def main():
    check = '--check' in sys.argv; bad = 0
    for rel, prov in PAGES.items():
        p = os.path.join(ROOT, rel); s = open(p, encoding='utf-8').read()
        if not BLOCK.search(s): raise SystemExit('no tools markers in ' + rel)
        t = counts(BLOCK.sub(lambda m: render(prov), s))
        if t != s:
            if check: bad += 1; print('stale', rel)
            else: open(p, 'w', encoding='utf-8').write(t)
    if check and bad: sys.exit(1)


if __name__ == '__main__':
    main()
