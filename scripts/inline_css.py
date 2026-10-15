#!/usr/bin/env python3
"""
Inline the shared stylesheet into every page.

Why
---
Every page used to load <link rel="stylesheet" href="/assets/kys.css">. A
stylesheet link blocks the first paint until it arrives, and PageSpeed flagged
it as the last render-blocking request on the site. The file is about 11 KB,
small enough that shipping it inside each page costs less than the extra round
trip it saves.

assets/kys.css stays the single source of truth. Edit that file, never the
<style id="kys-css"> block in a page, then run:

    python3 scripts/inline_css.py           # rewrite every page
    python3 scripts/inline_css.py --check   # exit 1 if any page is stale

What it does
------------
Minifies kys.css by stripping comments and collapsing whitespace only. No rule
is rewritten, reordered or merged, so the cascade is exactly the file's own.
Whitespace is removed only next to { } ; and , where it can never carry
meaning; a space next to ':' is kept, because in a selector "a :hover" and
"a:hover" are different things.

In each .html file under the repo root, bc/ and on/, it replaces the kys.css
<link> with <style id="kys-css">...</style> at exactly the same position, so
the shared rules still come before each page's own <style> and the page can
still override them. Re-running replaces the existing #kys-css block, so the
script is idempotent. The @font-face url() paths in kys.css are absolute
(/assets/fonts/...), so they resolve the same from an inline block.

The file itself is still published at /assets/kys.css; nothing on the site
needs it any more, but an old cached page or an outside link may.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_PATH = os.path.join(ROOT, 'assets', 'kys.css')
PAGE_DIRS = ['', 'bc', 'on']

LINK_RX = re.compile(r'<link rel="stylesheet" href="/assets/kys\.css">')
BLOCK_RX = re.compile(r'<style id="kys-css">.*?</style>', re.S)


def minify(css):
    """Strip comments and collapse whitespace. Strings are copied verbatim."""
    out = []
    i, n = 0, len(css)
    while i < n:
        c = css[i]
        if c in '"\'':
            j = i + 1
            while j < n and css[j] != c:
                j += 2 if css[j] == '\\' else 1
            out.append(css[i:j + 1])
            i = j + 1
        elif css.startswith('/*', i):
            end = css.find('*/', i + 2)
            if end < 0:
                raise ValueError('unterminated comment in kys.css')
            i = end + 2
        elif c.isspace():
            while i < n and css[i].isspace():
                i += 1
            out.append(' ')
        else:
            out.append(c)
            i += 1

    # Join, then drop the single spaces that can never matter: at either end,
    # repeated, or next to { } ; , (outside strings, which are re-split here).
    text = ''.join(out)
    parts = re.split(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')', text)
    for k in range(0, len(parts), 2):
        p = re.sub(r' {2,}', ' ', parts[k])
        p = re.sub(r' ?([{};,]) ?', r'\1', p)
        parts[k] = p
    return ''.join(parts).strip()


def block(css_min):
    if '</style' in css_min.lower():
        raise ValueError('kys.css contains "</style", which would end the inline block early')
    return f'<style id="kys-css">{css_min}</style>'


def pages():
    for d in PAGE_DIRS:
        folder = os.path.join(ROOT, d)
        for name in sorted(os.listdir(folder)):
            if name.endswith('.html'):
                yield os.path.join(d, name) if d else name


def render(html, new_block):
    """Return the page with the link (or an old block) replaced, or None if
    the page uses neither."""
    links = len(LINK_RX.findall(html))
    blocks = len(BLOCK_RX.findall(html))
    if links + blocks == 0:
        return None
    if links + blocks > 1:
        raise ValueError(f'expected one kys.css link or block, found {links} links and {blocks} blocks')
    rx = LINK_RX if links else BLOCK_RX
    return rx.sub(lambda m: new_block, html, count=1)


def main():
    check = '--check' in sys.argv[1:]
    with open(CSS_PATH, encoding='utf-8') as f:
        new_block = block(minify(f.read()))

    stale, written, current = [], [], 0
    for rel in pages():
        path = os.path.join(ROOT, rel)
        with open(path, encoding='utf-8') as f:
            html = f.read()
        try:
            out = render(html, new_block)
        except ValueError as e:
            print(f'{rel}: {e}', file=sys.stderr)
            sys.exit(2)
        if out is None:
            continue
        if out == html:
            current += 1
            continue
        if check:
            stale.append(rel)
        else:
            with open(path, 'w', encoding='utf-8', newline='') as f:
                f.write(out)
            written.append(rel)

    size = len(new_block.encode('utf-8'))
    if check:
        if stale:
            print(f'{len(stale)} page(s) out of date with assets/kys.css; '
                  'run python3 scripts/inline_css.py:', file=sys.stderr)
            for rel in stale:
                print(f'  {rel}', file=sys.stderr)
            sys.exit(1)
        print(f'all {current} pages carry the current kys.css ({size} bytes inline)')
        return
    print(f'{len(written)} page(s) updated, {current} already current '
          f'({size} bytes inline)')


if __name__ == '__main__':
    main()
