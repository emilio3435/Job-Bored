/* ============================================================
   company-cap.js — shared per-company visible cap
   ------------------------------------------------------------
   Used by pipeline.js, lattice.js, app.js (legacy kanban) and
   dawn.js (daily-brief leads carousel) so the same noise filter
   applies everywhere a list of jobs is rendered.

   Exposes window.JobBoredCompanyCap with:
     CAP                     — max visible cards per company
     companyKey(card)        — normalized company identity
     fitScoreOf(card)        — null/undefined → -Infinity
     capCardsByFit(cards, shouldPin?)
                             — drops over-cap cards (top N by fit
                               survive). shouldPin(card) → bool
                               keeps a card regardless of rank.
     summarizeHidden(cards, kept)
                             — [{ company, hidden }] for affordance UI

   Plain-JS UMD-ish IIFE; no module loader needed.
   ============================================================ */

(function (root) {
  "use strict";

  var CAP = 3;

  function companyKey(card) {
    return String((card && card.company) || "").trim().toLowerCase();
  }

  function fitScoreOf(card) {
    if (!card || card.fitScore == null) return -Infinity;
    var n = Number(card.fitScore);
    return isFinite(n) ? n : -Infinity;
  }

  function capCardsByFit(cards, shouldPin) {
    if (!Array.isArray(cards) || cards.length === 0) return cards || [];
    var byCompany = Object.create(null);
    cards.forEach(function (card, idx) {
      var k = companyKey(card);
      if (!k) return;
      if (!byCompany[k]) byCompany[k] = [];
      byCompany[k].push({ card: card, idx: idx });
    });
    var keepIdx = Object.create(null);
    cards.forEach(function (card, idx) {
      if (!companyKey(card)) keepIdx[idx] = true;
      if (typeof shouldPin === "function" && shouldPin(card, idx)) keepIdx[idx] = true;
    });
    Object.keys(byCompany).forEach(function (k) {
      var list = byCompany[k];
      var unpinned = list.filter(function (entry) { return !keepIdx[entry.idx]; });
      var pinnedCount = list.length - unpinned.length;
      var remainingSlots = Math.max(0, CAP - pinnedCount);
      if (unpinned.length <= remainingSlots) {
        unpinned.forEach(function (entry) { keepIdx[entry.idx] = true; });
        return;
      }
      var sorted = unpinned.slice().sort(function (a, b) {
        var diff = fitScoreOf(b.card) - fitScoreOf(a.card);
        if (diff !== 0) return diff;
        return a.idx - b.idx;
      });
      sorted.slice(0, remainingSlots).forEach(function (entry) {
        keepIdx[entry.idx] = true;
      });
    });
    return cards.filter(function (_card, idx) { return !!keepIdx[idx]; });
  }

  function summarizeHidden(allCards, keptCards) {
    if (!Array.isArray(allCards) || allCards.length === 0) return [];
    var keptSet = new Set(keptCards || []);
    var hidden = Object.create(null);
    var labels = Object.create(null);
    allCards.forEach(function (card) {
      if (keptSet.has(card)) return;
      var k = companyKey(card);
      if (!k) return;
      hidden[k] = (hidden[k] || 0) + 1;
      if (!labels[k]) labels[k] = String((card && card.company) || k);
    });
    return Object.keys(hidden).map(function (k) {
      return { company: labels[k], hidden: hidden[k] };
    });
  }

  root.JobBoredCompanyCap = {
    CAP: CAP,
    companyKey: companyKey,
    fitScoreOf: fitScoreOf,
    capCardsByFit: capCardsByFit,
    summarizeHidden: summarizeHidden,
  };
})(typeof window !== "undefined" ? window : globalThis);
