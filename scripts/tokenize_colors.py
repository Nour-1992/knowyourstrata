#!/usr/bin/env python3
"""
Replace legacy colour literals in page styles with design tokens.

Why: the October 2026 redesign added a dark theme. A colour written as a hex
literal in a page's own <style> (or a style="" attribute) cannot follow the
theme, so every literal is mapped to the token that carries the same meaning.
The shared files assets/kys.css and assets/kys-ui.css define the tokens for
both themes.

Run it after adding a page that was copied from an old template:

    python3 scripts/tokenize_colors.py           # rewrite pages
    python3 scripts/tokenize_colors.py --check   # exit 1 if any literal is left

White (#fff) is the one literal whose meaning depends on the property: as a
background it is a surface, as text it sits on the accent colour.
Only <style> blocks without an id and style="" attributes are touched, so the
inlined kys-css / kys-ui blocks and the page's scripts are never rewritten.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE_DIRS = ['', 'bc', 'on']

MAP = {
    '#3D4C47': 'var(--ink-2)', '#4A5A55': 'var(--ink-2)',
    '#5E6E68': 'var(--ink-3)', '#5A6A64': 'var(--ink-3)',
    '#7C8A84': 'var(--ink-3)', '#7E8C85': 'var(--ink-3)',
    '#1E4A43': 'var(--spruce)', '#2C6B60': 'var(--spruce-2)',
    '#5B8F82': 'var(--spruce-2)', '#8CA79C': 'var(--sage)',
    '#8F2D1E': 'var(--seal)', '#6B1E14': 'var(--seal-ink)',
    '#EEF3F0': 'var(--wash)', '#F1F4F2': 'var(--wash)',
    '#F6F8F6': 'var(--wash)', '#EAF3EE': 'var(--tint)', '#EAF1ED': 'var(--tint)',
    '#FAEFEC': 'var(--seal-bg)',
    '#FBF6EA': 'var(--amber-bg)', '#FFF9E8': 'var(--amber-bg)',
    '#FFFDF5': 'var(--amber-bg)', '#F6F1E4': 'var(--amber-bg)',
    '#E4D9B4': 'var(--amber-line)', '#C9C4B6': 'var(--amber-line)',
    '#C9C3B4': 'var(--amber-line)', '#B6B0A2': 'var(--amber-line)',
    '#EEEBE2': 'var(--amber-line)',
    '#5A5340': 'var(--amber-ink)', '#463F2C': 'var(--amber-ink)',
}
RGBA = [
    (re.compile(r'rgba\(\s*122\s*,\s*46\s*,\s*46\s*,\s*\.0?\d+\s*\)', re.I), 'var(--seal-bg)'),
    (re.compile(r'rgba\(\s*138\s*,\s*97\s*,\s*0\s*,\s*\.0?\d+\s*\)', re.I), 'var(--amber-bg)'),
    (re.compile(r'rgba\(\s*140\s*,\s*167\s*,\s*156\s*,\s*\.\d+\s*\)', re.I), 'var(--tint)'),
]
HEX = re.compile(r'#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?\b')
DECL = re.compile(r'([a-zA-Z-]+)(\s*:\s*)([^;{}"]+)')


def fix_decls(css):
    def one(m):
        prop, sep, val = m.group(1), m.group(2), m.group(3)

        def hx(h):
            v = h.group(0).upper()
            if v in ('#FFF', '#FFFFFF'):
                return 'var(--on-accent)' if prop.lower() == 'color' else 'var(--surface)'
            return MAP.get(v, h.group(0))
        val = HEX.sub(hx, val)
        for rx, tok in RGBA:
            val = rx.sub(tok, val)
        return prop + sep + val
    return DECL.sub(one, css)


def process(html):
    def style_block(m):
        return m.group(1) + fix_decls(m.group(2)) + m.group(3)
    html = re.sub(r'(<style>)(.*?)(</style>)', style_block, html, flags=re.S)
    html = re.sub(r'(style=")([^"]*)(")', style_block, html)
    return html


def leftovers(html):
    out = []
    for blk in re.findall(r'<style>(.*?)</style>', html, re.S) + re.findall(r'style="([^"]*)"', html):
        blk = re.sub(r'@media print\s*\{.*?\}\s*\}', '', blk, flags=re.S)
        out += [h for h in HEX.findall(blk)]
    return out


def pages():
    for d in PAGE_DIRS:
        base = os.path.join(ROOT, d)
        for f in sorted(os.listdir(base)):
            if f.endswith('.html'):
                yield os.path.join(base, f)


def main():
    check = '--check' in sys.argv
    bad = 0
    for p in pages():
        s = open(p, encoding='utf-8').read()
        if check:
            left = leftovers(s)
            if left:
                bad += 1
                print(os.path.relpath(p, ROOT), sorted(set(left)))
        else:
            t = process(s)
            if t != s:
                open(p, 'w', encoding='utf-8').write(t)
    if check and bad:
        sys.exit(1)


if __name__ == '__main__':
    main()
