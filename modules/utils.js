/**
 * OPTIX — Utils Module
 * Helpers compartidos entre módulos extraídos del bundle index.html
 *
 * Refactor F0.5b — extraído del inline (antes en index.html L9168).
 */

export function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Window-compat: el código clásico de index.html y los onclick HTML inline
// generados por templates esperan acceder a escapeHtml como global.
if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
}
