/* Know Your Strata calculator embed, for the website that hosts it.
 *
 * Optional. Without it the calculator still works in its frame at the height
 * written in the snippet. With it, the frame grows and shrinks to fit the
 * calculator and its answer, so there is never an inner scrollbar.
 *
 * It listens for one message, from knowyourstrata.com only, carrying one
 * number, and sets the height of the frame that sent it. Nothing else.
 */
(function () {
  'use strict';
  if (window.__kysEmbed) return;
  window.__kysEmbed = true;
  window.addEventListener('message', function (e) {
    try {
      if (e.origin !== 'https://knowyourstrata.com') return;
      var d = e.data;
      if (!d || d.type !== 'kys-embed-height' || typeof d.height !== 'number') return;
      var h = Math.max(240, Math.min(4000, Math.round(d.height)));
      var frames = document.getElementsByTagName('iframe');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === e.source) { frames[i].style.height = h + 'px'; return; }
      }
    } catch (err) { /* never surface */ }
  });
})();
