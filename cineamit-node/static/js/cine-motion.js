(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.addEventListener('pointermove', function (e) {
    var card = e.target.closest && e.target.closest('.movie-preview-card');
    if (!card) return;
    var r = card.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width - 0.5;
    var y = (e.clientY - r.top) / r.height - 0.5;
    var a = card.querySelector('a');
    if (!a) return;
    a.style.transform = 'perspective(700px) rotateY(' + (x * 8) + 'deg) rotateX(' + (-y * 6) + 'deg) translateY(-6px) scale(1.03)';
  }, { passive: true });
  document.addEventListener('pointerout', function (e) {
    var card = e.target.closest && e.target.closest('.movie-preview-card');
    if (!card) return;
    var a = card.querySelector('a');
    if (a) a.style.transform = '';
  }, { passive: true });
})();
