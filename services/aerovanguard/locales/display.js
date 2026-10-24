/* Display-only adapter: retains canonical chart labels, option values and exported design data. */
(() => {
  'use strict';
  const title = document.title;
  const translate = value => {
    const api = window.MaxjimI18n;
    if (!api) return value;
    return api.t(value);
  };
  const context = window.CanvasRenderingContext2D?.prototype;
  if (context) {
    const measure = context.measureText;
    context.measureText = function (text) { return measure.call(this, translate(text)); };

  }
  function redraw() {
    document.title = translate(title);
    // Chart.js caches canvas pixels. Redraw display layers without rebuilding geometry or solving state.
    const charts = window.Chart?.instances;
    if (charts) Object.values(charts).forEach(chart => chart.update('none'));
    window.drawAirfoilCanvas?.('MiniAirfoilCanvas', false);
    window.drawAirfoilCanvas?.('LabLargeAirfoilCanvas', true);
    window.drawHudPfd?.();
    window.MaxjimI18n?.refresh();
  }
  window.addEventListener('maxjim:language', redraw);
  window.addEventListener('maxjim:i18n-ready', redraw);
})();
