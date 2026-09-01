/* ============================================
   Beat B3 of the one-flow onboarding — Hand us your resume.

   L0 STUB. Registers the beat with its normative copy (ONE-FLOW-
   ONBOARDING-SPEC §5 B3) rendered as a static placeholder card, so the
   registry, the spine, and the state machine are exercisable before the
   beat's real behavior lands. L1 (arrival) fills this file in; nothing else
   in the flow needs to change when it does.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Drop in your resume. We'll do the typing.";

  const SUB =
    "From this one file we'll draft your whole fit profile — target " +
    "roles, strengths, what you want, what to avoid. You'll review " +
    "everything on the next screen; nothing is saved until you approve " +
    "it.";

  flow.registerBeat({
    id: "resume",
    order: 3,
    label: "Resume",
    timeLabel: "about 8 min left",
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
