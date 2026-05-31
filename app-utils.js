/* ============================================
   COMMAND CENTER v2 — App string/safety utilities
   Extracted from app.js (app-utils cut).

   Classic-global IIFE under window.JobBoredApp.utils — NOT an ES module.
   Loaded BEFORE app.js. Pure helpers with no app.js host dependencies.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const utils = root.utils || (root.utils = {});

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeHref(url) {
    if (!url) return "";
    var s = String(url).trim();
    if (/^https?:\/\//i.test(s)) return s;
    return "";
  }

  Object.assign(utils, { escapeHtml, safeHref });
})();
