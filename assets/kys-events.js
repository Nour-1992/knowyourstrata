/* Know Your Strata — first-party funnel counter.
 *
 * Counts six things: a calculator being run, a calculator shown inside another
 * website (embed), a pack sales page being opened, the checkout link being
 * clicked, a signup, and a purchase. The last two are
 * counted server-side where they cannot be blocked or faked; this file handles
 * the first three.
 *
 * It sets no cookie, reads no storage, and sends no identifier of any kind --
 * only an event name from a fixed list and, for tool pages, which tool. The
 * server drops anything not on its own allowlist.
 *
 * Everything is wrapped so that a failure here can never affect the page. A
 * council working out a notice deadline must not care that analytics broke.
 */
(function () {
  'use strict';

  try {
    // Honour Global Privacy Control and Do Not Track. Nothing identifying is
    // sent either way, but a site that argues its answers are checkable should
    // also do the thing it would tell someone else to do.
    if (navigator.globalPrivacyControl === true) return;
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

    var path = location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
    var province = path.split('/')[0];

    function send(name, detail) {
      try {
        var body = JSON.stringify({ name: name, detail: detail || '' });
        // sendBeacon survives the page being unloaded by a click on a link,
        // which is exactly the pack_click case.
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }));
          return;
        }
        fetch('/api/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true
        }).catch(function () {});
      } catch (err) { /* never surface */ }
    }

    function ready(fn) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn, { once: true });
      } else { fn(); }
    }

    ready(function () {
      try {
        // 1. A calculator was run. Most tool pages use #calc; the BC voting
        //    tool uses #check and the minutes generator #genBtn. Two BC tools
        //    are decision trees with no button at all: reaching an answer is a
        //    click on an option carrying data-result. Until 2026-10-16 only
        //    #calc was bound, so four BC tools were never counted.
        var ids = ['calc', 'check', 'genBtn'];
        for (var j = 0; j < ids.length; j++) {
          var b = document.getElementById(ids[j]);
          if (b) b.addEventListener('click', function () { send('tool_used', path); });
        }
        document.addEventListener('click', function (e) {
          var t = e.target && e.target.closest && e.target.closest('.card [data-result]');
          if (t) send('tool_used', path);
        });

        // 1b. The page is running inside another website's frame (?embed=1).
        //     The live preview on /embed is a frame inside this same site, and
        //     reading the parent's location only succeeds when it is same-site,
        //     so that preview is not counted as someone else's embed.
        if (document.documentElement.classList.contains('kys-embed')) {
          var ownSite = false;
          try { ownSite = window.parent !== window && window.parent.location.host === location.host; } catch (e) { ownSite = false; }
          if (!ownSite) send('embed_view', path);
        }

        // 2. A pack sales page was opened.
        if (path === 'bc/starter-pack' || path === 'on/starter-pack') {
          send('pack_view', province);
        }

        // 3. Checkout was started. On the pack pages this is a <button> that
        //    sets location.href, not an anchor -- binding only to
        //    a[href*="buy.stripe.com"] silently caught nothing, which is
        //    exactly the failure tests/events_test.py exists to catch. Both
        //    are bound now: the button today, an anchor if one ever replaces it.
        var buy = document.getElementById('buyBtn');
        if (buy) {
          buy.addEventListener('click', function () { send('pack_click', province); });
        }
        var links = document.querySelectorAll('a[href*="buy.stripe.com"]');
        for (var i = 0; i < links.length; i++) {
          links[i].addEventListener('click', function () { send('pack_click', province); });
        }
      } catch (err) { /* never surface */ }
    });
  } catch (err) { /* never surface */ }
})();
