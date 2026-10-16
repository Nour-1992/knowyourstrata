/* Know Your Strata, embed mode.
 *
 * Loaded only when a tool page is opened with ?embed=1 (the theme boot script
 * in <head> adds the "kys-embed" class and this file). The CSS in kys-ui.css
 * hides everything but the calculator; this file does the three things CSS
 * cannot:
 *
 *  1. adds a credit line linking back to the full page, where the explanation,
 *     the quoted sections and the verification date live;
 *  2. opens every link in a new tab, so a council member on someone else's
 *     website is never navigated away inside a small frame;
 *  3. tells the host page how tall the calculator is, so /assets/embed.js on
 *     that site can size the frame with no inner scrollbar.
 *
 * It sends the host only a number (the height). It reads nothing from the
 * host page and sets no cookie or storage.
 */
(function () {
  'use strict';
  try {
    var root = document.documentElement;
    if (!root.classList.contains('kys-embed')) return;

    function ready(fn) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
      else fn();
    }

    ready(function () {
      try {
        var wrap = document.querySelector('main .wrap');
        if (!wrap || !wrap.querySelector('.card')) return;

        var canon = document.querySelector('link[rel="canonical"]');
        var href = canon ? canon.href : location.origin + location.pathname;

        if (!wrap.querySelector('.embed-credit')) {
          var p = document.createElement('p');
          p.className = 'embed-credit';
          var a = document.createElement('a');
          a.href = href;
          a.textContent = 'Know Your Strata';
          p.appendChild(a);
          p.appendChild(document.createTextNode(' · the full rule, the quoted sections and the date it was verified'));
          wrap.appendChild(p);
        }

        var links = document.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
          if ((links[i].getAttribute('href') || '').charAt(0) === '#') continue;
          links[i].target = '_blank';
          links[i].rel = 'noopener';
        }

        if (window.parent === window) return;
        var last = 0;
        function post() {
          // Measure the content, not the document: a document is never shorter
          // than its frame, so scrollHeight would only ever let the frame grow.
          var h = Math.ceil(document.body.getBoundingClientRect().height) + 4;
          if (Math.abs(h - last) < 2) return;
          last = h;
          window.parent.postMessage({ type: 'kys-embed-height', height: h }, '*');
        }
        post();
        if (window.ResizeObserver) new ResizeObserver(post).observe(document.body);
        window.addEventListener('load', post);
        document.addEventListener('click', function () { setTimeout(post, 60); }, true);
      } catch (err) { /* never surface */ }
    });
  } catch (err) { /* never surface */ }
})();
