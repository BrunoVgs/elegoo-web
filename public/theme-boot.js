/* Thème posé avant le premier rendu : le bundle est différé et provoquerait un flash. */
(function () {
  try {
    var saved = localStorage.getItem('cc2-theme') || 'dark';
    var light =
      saved === 'light' ||
      (saved === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
