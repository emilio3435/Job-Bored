/* ============================================
   Beat B5 of the one-flow onboarding — Turn on discovery.

   L0 STUB. Registers the beat with its normative copy (ONE-FLOW-
   ONBOARDING-SPEC §5 B5) rendered as a static placeholder card, so the
   registry, the spine, and the state machine are exercisable before the
   beat's real behavior lands. L3 (engine) fills this file in; nothing else
   in the flow needs to change when it does.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Now the engine: jobs come to you.";

  const SUB =
    "Discovery runs on this computer, searches the job boards " +
    "overnight, scores each role against your fit, and drops the " +
    "matches into your pipeline. Only your search terms leave this " +
    "machine. Set up once; it runs itself.";

  flow.registerBeat({
    id: "discovery",
    order: 5,
    label: "Discovery",
    timeLabel: "about 4 min left",
    headline: HEADLINE,
    sub: SUB,
    render(container) {
      const card = document.createElement("div");
      card.className = "oneflow-placeholder";
      const title = document.createElement("h4");
      title.className = "oneflow-placeholder__headline";
      title.textContent = HEADLINE;
      const sub = document.createElement("p");
      sub.className = "oneflow-placeholder__sub";
      sub.textContent = SUB;
      card.append(title, sub);
      container.appendChild(card);
    },
  });
})();
