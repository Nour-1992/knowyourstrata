#!/usr/bin/env python3
"""
Write the shared site header into every page (October 2026 redesign).

The header is identical everywhere except which link is marked current, so it
lives here once. Run after adding a page:

    python3 scripts/site_header.py          # rewrite headers
    python3 scripts/site_header.py --check  # exit 1 if any page is stale

It also writes the theme bootstrap into <head> (before any style), so a visitor
who chose dark sees dark from the first paint. The choice is kept only in this
browser's localStorage under "kys-theme"; nothing is sent anywhere.
"""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE_DIRS = ['', 'bc', 'on']

LINKS = [('bc', '/bc/', 'BC tools'), ('on', '/on/', 'Ontario tools'),
         ('res', '/#resources', 'Board resources'), ('how', '/how-we-verify', 'How it works'),
         ('about', '/about', 'About')]
MOON = '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>'
SUN = '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
BOOT = '<script id="kys-theme-boot">try{var t=localStorage.getItem("kys-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>'
TOGGLE_JS = ('<script>(function(){var b=document.getElementById("kysTheme");if(!b)return;'
             'b.addEventListener("click",function(){var r=document.documentElement,'
             'c=r.getAttribute("data-theme")||(window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"),'
             'n=c==="dark"?"light":"dark";r.setAttribute("data-theme",n);'
             'try{localStorage.setItem("kys-theme",n)}catch(e){}});})();</script>')


def section(rel):
    if rel.startswith('bc/') and 'starter-pack' not in rel: return 'bc'
    if rel.startswith('on/') and 'starter-pack' not in rel and 'cheat-sheet' not in rel: return 'on'
    if 'starter-pack' in rel or 'cheat-sheet' in rel: return 'res'
    if rel in ('how-we-verify.html', 'monitoring.html'): return 'how'
    if rel in ('about.html', 'contact.html'): return 'about'
    return None


def header(rel, noprint):
    cur = section(rel)
    def links(cls):
        return ''.join('<a href="%s"%s>%s</a>' % (h, ' aria-current="page"' if k == cur else '', t) for k, h, t in LINKS)
    return ('<div class="kys-top%s" role="banner"><div class="kys-top-in">'
            '<a class="kys-brand" href="/" aria-label="Know Your Strata home"><span class="kys-glyph" aria-hidden="true">&sect;</span><span>Know Your Strata</span></a>'
            '<nav class="kys-links" aria-label="Main">%s</nav>'
            '<details class="kys-menu"><summary aria-label="Menu">%s</summary><nav class="kys-menu-panel" aria-label="Main">%s</nav></details>'
            '<button type="button" class="kys-theme" id="kysTheme" aria-label="Switch between light and dark theme" title="Light or dark">%s%s</button>'
            '</div></div>%s') % (' no-print' if noprint else '', links('d'), MENU, links('m'), MOON, SUN, TOGGLE_JS)


OLD_NAV = re.compile(r'<nav class="kys-nav( no-print)?">.*?</nav>', re.S)
NEW_HDR = re.compile(r'<div class="kys-top( no-print)?" role="banner">.*?</div></div><script>\(function\(\)\{var b=document\.getElementById\("kysTheme"\).*?</script>', re.S)


def process(rel, s):
    m = OLD_NAV.search(s) or NEW_HDR.search(s)
    if not m:
        raise SystemExit('no header in ' + rel)
    s = s[:m.start()] + header(rel, bool(m.group(1))) + s[m.end():]
    if 'id="kys-theme-boot"' not in s:
        s = s.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n' + BOOT, 1) if '<meta charset="UTF-8">' in s else s.replace('<head>', '<head>\n' + BOOT, 1)
    return s


def main():
    check = '--check' in sys.argv; bad = 0
    for d in PAGE_DIRS:
        for f in sorted(os.listdir(os.path.join(ROOT, d))):
            if not f.endswith('.html'): continue
            rel = os.path.join(d, f) if d else f
            p = os.path.join(ROOT, rel); s = open(p, encoding='utf-8').read(); t = process(rel, s)
            if t != s:
                if check: bad += 1; print('stale', rel)
                else: open(p, 'w', encoding='utf-8').write(t)
    if check and bad: sys.exit(1)


if __name__ == '__main__':
    main()
