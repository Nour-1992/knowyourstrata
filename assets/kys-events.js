/* Know Your Strata — first-party funnel counter.
 *
 * Counts five things: a calculator being run, a pack sales page being opened,
 * the checkout link being clicked, a signup, and a purchase. The last two are
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
        // 1. A calculator was run. Every tool page uses #calc as its button.
        var calc = document.getElementById('calc');
        if (calc) {
          calc.addEventListener('click', function () { send('tool_used', path); });
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
