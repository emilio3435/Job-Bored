/* ============================================
   COMMAND CENTER v2 — Daily Brief (pipeline-derived)
   Extracted from app.js (daily-brief cut).

   Classic-global IIFE under window.JobBoredApp.brief — NOT an ES module.
   Loaded BEFORE app.js. Reads app.js helpers via lazy brief.host.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const brief = root.brief || (root.brief = {});

  function host() {
    return window.JobBoredApp.brief.host;
  }

  function escapeHtml(...args) {
    return host().escapeHtml(...args);
  }

  function getPipelineData() {
    return host().getPipelineData();
  }

  function normalizeResponseFlag(val) {
    return host().normalizeResponseFlag(val);
  }

  function responseLabelForDisplay(flag) {
    return host().responseLabelForDisplay(flag);
  }

  // --- Daily Brief (pipeline-derived) ---
  /** Local calendar days; appeal rank; stale applied = no forward progress (see SETUP.md). */
  const BRIEF_STALE_APPLIED_DAYS = 14;
  const BRIEF_WAITING_REPLY_MIN_DAYS = 7;

  function localDateKey(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseBriefDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function priorityRank(p) {
    const order = { "🔥": 0, "⚡": 1, "—": 2, "↓": 3 };
    return order[p] ?? 2;
  }

  function rankByAppeal(jobs) {
    return [...jobs].sort((a, b) => {
      const fs = (b.fitScore ?? -1) - (a.fitScore ?? -1);
      if (fs !== 0) return fs;
      const po = priorityRank(a.priority) - priorityRank(b.priority);
      if (po !== 0) return po;
      return (a.company || "").localeCompare(b.company || "");
    });
  }

  function jobsFoundToday(jobs) {
    const todayKey = localDateKey(new Date());
    return jobs.filter(
      (j) => j.dateFound && localDateKey(j.dateFound) === todayKey,
    );
  }

  function startOfWeekMonday(d) {
    const x = new Date(d);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function appliedThisWeekCount(jobs) {
    const start = startOfWeekMonday(new Date());
    return jobs.filter((j) => {
      if (!j.appliedDate) return false;
      const ad = parseBriefDate(j.appliedDate);
      return ad && ad >= start;
    }).length;
  }

  function isStaleApplied(job) {
    const s = (job.status || "").toLowerCase();
    if (!s.includes("applied")) return false;
    if (
      s.includes("interview") ||
      s.includes("phone screen") ||
      s.includes("offer")
    )
      return false;
    if (s.includes("reject") || s.includes("passed")) return false;
    if (!job.appliedDate) return false;
    const ad = parseBriefDate(job.appliedDate);
    if (!ad) return false;
    const days = (Date.now() - ad.getTime()) / (24 * 3600 * 1000);
    return days >= BRIEF_STALE_APPLIED_DAYS;
  }

  function overdueFollowUps(jobs) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return jobs.filter((j) => {
      if (!j.followUpDate) return false;
      const fd = parseBriefDate(j.followUpDate);
      if (!fd) return false;
      fd.setHours(0, 0, 0, 0);
      return fd < now;
    });
  }

  function upcomingFollowUps48h(jobs) {
    const now = new Date();
    const end = new Date(now.getTime() + 48 * 3600 * 1000);
    return jobs.filter((j) => {
      if (!j.followUpDate) return false;
      const fd = parseBriefDate(j.followUpDate);
      if (!fd) return false;
      return fd >= now && fd <= end;
    });
  }


  function waitingOnReplyJobs(jobs) {
    return jobs.filter((j) => {
      const s = (j.status || "").toLowerCase();
      if (
        s.includes("interviewing") ||
        s.includes("offer") ||
        s.includes("reject") ||
        s.includes("passed") ||
        s === "new" ||
        s.includes("researching")
      ) {
        return false;
      }
      const waitingStage = s === "applied" || s.includes("phone screen");
      if (!waitingStage) return false;

      const flag = normalizeResponseFlag(j.responseFlag);
      if (flag === "yes") return false;
      if (flag === "no") return true;

      if (!j.appliedDate) return false;
      const ad = parseBriefDate(j.appliedDate);
      if (!ad) return false;
      const days = (Date.now() - ad.getTime()) / (24 * 3600 * 1000);
      return days >= BRIEF_WAITING_REPLY_MIN_DAYS;
    });
  }

  function pipelineStatusCounts(jobs) {
    const map = {};
    for (const j of jobs) {
      const k = (j.status || "Unknown").trim() || "Unknown";
      map[k] = (map[k] || 0) + 1;
    }
    return map;
  }

  function briefJobLine(job, extraHtml) {
    const title = escapeHtml(job.title || "Role");
    const co = escapeHtml(job.company || "");
    const extra = extraHtml || "";
    return `<li><strong>${title}</strong>${co ? ` — ${co}` : ""} ${extra}</li>`;
  }

  function briefJobLineWithLastHeard(job) {
    const heard = job.lastHeardFrom
      ? ` <span class="brief-meta">Last contact: ${escapeHtml(job.lastHeardFrom)}</span>`
      : "";
    const reply = responseLabelForDisplay(job.responseFlag)
      ? ` <span class="brief-meta">Reply: ${escapeHtml(responseLabelForDisplay(job.responseFlag))}</span>`
      : "";
    return briefJobLine(job, heard + reply);
  }

  // --- Brief: Headline ---

  function briefHeadlineSentence(overdue, waiting, stale, todayJobs) {
    const ov = overdue.length;
    const wt = waiting.length;
    const st = stale.length;
    const nw = todayJobs.length;
    const urgent = ov + wt + st;

    if (!urgent && !nw)
      return "Nothing demands your attention today. The pipeline is steady&mdash;a good day to sharpen your story or reach out to someone new.";

    if (!urgent && nw)
      return `Your pipeline is clear and ${nw === 1 ? "a promising new opportunity has" : `<strong>${nw}</strong> fresh opportunities have`} surfaced since yesterday. A clean slate and new leads&mdash;today is yours to move fast.`;

    const threads = [];
    if (ov)
      threads.push(
        ov === 1
          ? "one follow-up has gone unanswered past its window"
          : `<strong>${ov}</strong> follow-ups have slipped past their window`,
      );
    if (wt)
      threads.push(
        wt === 1
          ? "one conversation is still waiting on you"
          : `<strong>${wt}</strong> conversations are still waiting on you`,
      );
    if (st)
      threads.push(
        st === 1
          ? "one application has gone quiet"
          : `<strong>${st}</strong> applications have gone quiet`,
      );

    let prose = threads[0];
    if (threads.length === 2) prose += ", and " + threads[1];
    else if (threads.length === 3)
      prose += ", " + threads[1] + ", and " + threads[2];

    prose = prose.charAt(0).toUpperCase() + prose.slice(1);

    if (nw)
      prose += `. On the bright side, ${nw === 1 ? "a new match" : `<strong>${nw}</strong> new matches`} arrived today&mdash;momentum is building.`;
    else prose += ". Clearing these will put you back in control of the pace.";

    return prose;
  }

  // --- Brief: Opportunity column ---

  function briefDaysSince(dateStr) {
    const d = parseBriefDate(dateStr);
    if (!d) return null;
    return Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000));
  }

  /** Rolling windows: last 7 calendar days vs the 7 days before that (local midnight). */
  function getInsightDateWindows() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const recentEnd = new Date(today);
    recentEnd.setDate(recentEnd.getDate() + 1);
    const recentStart = new Date(today);
    recentStart.setDate(recentStart.getDate() - 7);
    const priorEnd = recentStart;
    const priorStart = new Date(recentStart);
    priorStart.setDate(priorStart.getDate() - 7);
    return { recentStart, recentEnd, priorStart, priorEnd };
  }

  function dateInWindow(d, start, end) {
    return d >= start && d < end;
  }

  function countDateFoundInWindow(jobs, start, end) {
    return jobs.filter((j) => {
      const d = parseBriefDate(j.dateFound);
      return d && dateInWindow(d, start, end);
    }).length;
  }

  function countAppliedInWindow(jobs, start, end) {
    return jobs.filter((j) => {
      const d = parseBriefDate(j.appliedDate);
      return d && dateInWindow(d, start, end);
    }).length;
  }

  function trendDeltaLabel(cur, prev) {
    const d = cur - prev;
    if (d === 0) return "same as prior week";
    if (d > 0) return `up ${d} vs prior week`;
    return `down ${-d} vs prior week`;
  }

  /** Short delta for insight tiles: +2, −1, 0 */
  function trendDeltaShort(cur, prev) {
    const d = cur - prev;
    if (d === 0) return "0";
    if (d > 0) return `+${d}`;
    return `${d}`;
  }

  function trendPillClass(cur, prev) {
    const d = cur - prev;
    if (d > 0) return "insight-pill--up";
    if (d < 0) return "insight-pill--down";
    return "insight-pill--flat";
  }

  function medianDaysDiscoveryToApply(jobs) {
    const deltas = [];
    for (const j of jobs) {
      const df = parseBriefDate(j.dateFound);
      const da = parseBriefDate(j.appliedDate);
      if (!df || !da) continue;
      const days = Math.round((da - df) / (24 * 3600 * 1000));
      if (days >= 0) deltas.push(days);
    }
    if (deltas.length < 2) return null;
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)];
  }

  function topSourcesInWindow(jobs, start, end, limit) {
    const map = {};
    for (const j of jobs) {
      const d = parseBriefDate(j.dateFound);
      if (!d || !dateInWindow(d, start, end)) continue;
      const src = (j.source || "").trim() || "Unknown";
      map[src] = (map[src] || 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  let briefActivityRange = "7d";

  function getBriefActivityRange() {
    return briefActivityRange;
  }

  function setBriefActivityRange(range) {
    briefActivityRange = range;
  }

  function getBreakdownForRange(jobs, range) {
    const totalDays = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 }[range] || 7;
    const groupSize = totalDays >= 30 ? 7 : 1;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daily = [];
    for (let i = totalDays - 1; i >= 0; i--) {
      const s = new Date(today);
      s.setDate(s.getDate() - i);
      const e = new Date(s);
      e.setDate(e.getDate() + 1);
      daily.push({
        date: s,
        discovered: jobs.filter((j) => {
          const d = parseBriefDate(j.dateFound);
          return d && d >= s && d < e;
        }).length,
        applied: jobs.filter((j) => {
          const d = parseBriefDate(j.appliedDate);
          return d && d >= s && d < e;
        }).length,
      });
    }
    if (groupSize === 1) {
      const short = totalDays <= 7;
      return daily.map((d) => ({
        ...d,
        label: short
          ? d.date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)
          : d.date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }),
      }));
    }
    const groups = [];
    for (let i = 0; i < daily.length; i += groupSize) {
      const ch = daily.slice(i, i + groupSize);
      groups.push({
        date: ch[0].date,
        label: ch[0].date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        discovered: ch.reduce((a, d) => a + d.discovered, 0),
        applied: ch.reduce((a, d) => a + d.applied, 0),
      });
    }
    return groups;
  }

  function niceAxisMax(v) {
    if (v <= 0) return 5;
    return (
      [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000].find(
        (t) => t >= v,
      ) || Math.ceil(v / 100) * 100
    );
  }

  function catmullRomPath(pts) {
    if (pts.length < 2) return "";
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)],
        p1 = pts[i],
        p2 = pts[i + 1],
        p3 = pts[Math.min(pts.length - 1, i + 2)];
      const t = 6;
      d += ` C ${p1.x + (p2.x - p0.x) / t},${p1.y + (p2.y - p0.y) / t} ${p2.x - (p3.x - p1.x) / t},${p2.y - (p3.y - p1.y) / t} ${p2.x},${p2.y}`;
    }
    return d;
  }

  function countStatusMatches(jobs, pred) {
    return jobs.filter(pred).length;
  }

  function buildBriefSuggestions(ctx) {
    const tips = [];
    const {
      staleLen,
      waitingLen,
      overdueLen,
      inboxCount,
      discRecent,
      appliedRecent,
      offers,
      total,
    } = ctx;
    if (total === 0) return tips;
    if (discRecent === 0 && total > 0)
      tips.push(
        "No new discoveries in the last 7 days — try a different discovery query or widen locations.",
      );
    if (inboxCount >= 8)
      tips.push(
        `Large inbox (${inboxCount} roles) — block time to triage so nothing goes stale.`,
      );
    if (staleLen > 0)
      tips.push(
        "Stale applications need a decision: follow up once, then close or move on.",
      );
    if (waitingLen >= 4)
      tips.push(
        "Several applications are waiting on replies — a single follow-up sweep can clear mental load.",
      );
    if (offers > 0)
      tips.push(
        "You have an active offer — compare deadlines and total comp before you sign.",
      );
    if (appliedRecent >= 5 && tips.length < 4)
      tips.push(
        "Heavy apply week — note which sources or companies reply so you can double down next week.",
      );
    if (overdueLen > 0 && tips.length < 4)
      tips.push(
        "Overdue follow-up dates are promises to yourself — reschedule or send one short note.",
      );
    return tips.slice(0, 4);
  }

  function renderBriefStats(ctx) {
    const {
      discRecent,
      discPrior,
      appRecent,
      appPrior,
      inLoop,
      offers,
      medianDays,
    } = ctx;

    function deltaClass(cur, prev) {
      const d = cur - prev;
      if (d > 0) return "stat-card__delta--up";
      if (d < 0) return "stat-card__delta--down";
      return "stat-card__delta--flat";
    }

    let html = "";

    html += `<div class="stat-card">
      <span class="stat-card__label">Found this week</span>
      <div class="stat-card__row">
        <span class="stat-card__value">${discRecent}</span>
        <span class="stat-card__delta ${deltaClass(discRecent, discPrior)}">${trendDeltaShort(discRecent, discPrior)}</span>
      </div>
      <span class="stat-card__sub">vs ${discPrior} prior week</span>
    </div>`;

    html += `<div class="stat-card">
      <span class="stat-card__label">Applied this week</span>
      <div class="stat-card__row">
        <span class="stat-card__value">${appRecent}</span>
        <span class="stat-card__delta ${deltaClass(appRecent, appPrior)}">${trendDeltaShort(appRecent, appPrior)}</span>
      </div>
      <span class="stat-card__sub">vs ${appPrior} prior week</span>
    </div>`;

    html += `<div class="stat-card">
      <span class="stat-card__label">In loop</span>
      <div class="stat-card__row">
        <span class="stat-card__value">${inLoop}</span>
      </div>
      <span class="stat-card__sub">interviewing + screens</span>
    </div>`;

    html += `<div class="stat-card">
      <span class="stat-card__label">Offers</span>
      <div class="stat-card__row">
        <span class="stat-card__value">${offers}</span>
      </div>
      <span class="stat-card__sub">${medianDays != null ? `${medianDays}d median find\u2009\u2192\u2009apply` : "full pipeline"}</span>
    </div>`;

    return html;
  }

  function renderDonutWidget(stages) {
    const total = stages.reduce((s, st) => s + st.count, 0);
    if (total === 0) return "";
    const filtered = stages.filter((s) => s.count > 0);
    let cumPct = 0;
    const segs = filtered.map((s) => {
      const p = (s.count / total) * 100;
      const f = cumPct;
      cumPct += p;
      return `${s.color} ${f}% ${cumPct}%`;
    });
    let h =
      '<h4 class="brief-widget__title">Pipeline</h4><div class="donut-layout">';
    h += `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${segs.join(",")})"></div>`;
    h += `<div class="donut-center"><span class="donut-center__val">${total}</span><span class="donut-center__lbl">total</span></div></div>`;
    h += '<div class="donut-legend">';
    for (const s of filtered)
      h += `<div class="donut-legend__item"><span class="donut-legend__dot" style="background:${s.color}"></span><span class="donut-legend__label">${escapeHtml(s.label)}</span><span class="donut-legend__val">${s.count}</span></div>`;
    h += "</div></div>";
    return h;
  }

  function renderAreaWidget(jobs, range) {
    const data = getBreakdownForRange(jobs, range);
    const maxRaw = Math.max(0, ...data.flatMap((d) => [d.discovered, d.applied]));
    const maxY = niceAxisMax(maxRaw);
    const L = 50,
      R = 490,
      T = 12,
      B = 160,
      W = R - L,
      H = B - T,
      n = data.length;
    const xS = n > 1 ? W / (n - 1) : 0;
    function pts(k) {
      return data.map((d, i) => ({ x: L + i * xS, y: B - (d[k] / maxY) * H }));
    }
    const dp = pts("discovered"),
      ap = pts("applied");
    function aD(p) {
      return p.length < 2
        ? ""
        : catmullRomPath(p) + ` L ${p[p.length - 1].x},${B} L ${p[0].x},${B} Z`;
    }
    const ranges = ["7d", "14d", "30d", "90d"];
    let h =
      '<div class="area-header"><h4 class="area-header__title">Activity</h4><div class="area-range">';
    for (const r of ranges)
      h += `<button class="area-range__btn${r === range ? " area-range__btn--active" : ""}" data-range="${r}">${r}</button>`;
    h += "</div></div>";
    h +=
      '<svg viewBox="0 0 500 190" class="area-svg" preserveAspectRatio="xMidYMid meet">';
    for (const g of [0, 0.5, 1]) {
      const y = B - g * H;
      h += `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" class="area-grid-line"/><text x="${L - 6}" y="${y + 3}" class="area-y-label">${Math.round(maxY * g)}</text>`;
    }
    h += `<path d="${aD(dp)}" class="area-fill--disc"/><path d="${aD(ap)}" class="area-fill--app"/>`;
    h += `<path d="${catmullRomPath(dp)}" class="area-line--disc"/><path d="${catmullRomPath(ap)}" class="area-line--app"/>`;
    for (let i = 0; i < n; i++) {
      h += `<circle cx="${dp[i].x}" cy="${dp[i].y}" r="3" class="area-dot--disc"><title>Found: ${data[i].discovered}</title></circle>`;
      h += `<circle cx="${ap[i].x}" cy="${ap[i].y}" r="3" class="area-dot--app"><title>Applied: ${data[i].applied}</title></circle>`;
    }
    const every = Math.max(1, Math.ceil(n / 7));
    for (let i = 0; i < n; i++) {
      if (i % every === 0 || i === n - 1)
        h += `<text x="${L + i * xS}" y="${B + 18}" class="area-x-label">${escapeHtml(data[i].label)}</text>`;
    }
    h += "</svg>";
    h +=
      '<div class="area-legend"><span class="area-legend__key"><span class="area-legend__dot area-legend__dot--disc"></span>Discovered</span><span class="area-legend__key"><span class="area-legend__dot area-legend__dot--app"></span>Applied</span></div>';
    return h;
  }

  function renderSourceWidget(sources, suggestions) {
    let h = "";
    if (sources.length > 0) {
      const mx = sources[0][1];
      h +=
        '<h4 class="brief-widget__title">Top sources <span style="font-weight:500;color:var(--text-faint);font-size:var(--text-xs)">7d</span></h4>';
      for (const [name, count] of sources) {
        const p = Math.max(4, (count / mx) * 100);
        h += `<div class="source-bars__row"><span class="source-bars__name">${escapeHtml(name)}</span><div class="source-bars__track"><div class="source-bars__fill" style="width:${p}%"></div></div><span class="source-bars__count">${count}</span></div>`;
      }
    }
    if (suggestions.length > 0) {
      h += `<div style="margin-top:auto;padding-top:var(--space-3);border-top:1px solid var(--divider)"><ul class="brief-tips__list">${suggestions
        .slice(0, 2)
        .map((t) => `<li>${escapeHtml(t)}</li>`)
        .join("")}</ul></div>`;
    }
    return h;
  }

  function renderEmptyDonutScaffold() {
    const stages = [
      { label: "New", color: "var(--stage-rail-new)" },
      { label: "Researching", color: "var(--stage-rail-researching)" },
      { label: "Applied", color: "var(--stage-rail-applied)" },
      { label: "Phone Screen", color: "var(--stage-rail-phone-screen)" },
      { label: "Interviewing", color: "var(--stage-rail-interviewing)" },
      { label: "Offer", color: "var(--stage-rail-offer)" },
      { label: "Rejected", color: "var(--stage-rail-rejected)" },
      { label: "Passed", color: "var(--stage-rail-passed)" },
      { label: "Expired", color: "var(--stage-rail-expired)" },
    ];
    let h =
      '<h4 class="brief-widget__title">Pipeline</h4><div class="donut-layout donut-layout--empty">';
    h += '<div class="donut-wrap"><div class="donut donut--empty"></div>';
    h +=
      '<div class="donut-center"><span class="donut-center__val">0</span><span class="donut-center__lbl">total</span></div></div>';
    h += '<div class="donut-legend">';
    for (const s of stages) {
      h += `<div class="donut-legend__item donut-legend__item--empty"><span class="donut-legend__dot" style="background:${s.color}"></span><span class="donut-legend__label">${escapeHtml(s.label)}</span><span class="donut-legend__val">0</span></div>`;
    }
    h += "</div></div>";
    return h;
  }

  function renderEmptyInsightsScaffold() {
    return `<h4 class="brief-widget__title">7-day activity</h4>
      <div class="brief-scaffold-empty">
        <p class="brief-scaffold-empty__text">Your discovery and apply trend will plot here once jobs land in the pipeline.</p>
      </div>`;
  }

  function renderEmptySourcesScaffold() {
    return `<h4 class="brief-widget__title">Top sources</h4>
      <div class="brief-scaffold-empty">
        <p class="brief-scaffold-empty__text">The job boards you use most will rank here.</p>
      </div>`;
  }

  function _UNUSED_renderBriefCharts(ctx) {
    /* removed — replaced by renderDonutWidget, renderAreaWidget, renderSourceWidget */
    const { stages, dailyBreakdown, sources, suggestions } = ctx;

    let html = "";

    // Pipeline funnel
    const total = stages.reduce((s, st) => s + st.count, 0);
    if (total > 0) {
      html += '<div class="pipeline-funnel">';
      html += '<h4 class="pipeline-funnel__title">Pipeline distribution</h4>';
      html += '<div class="pipeline-funnel__bar">';
      for (const s of stages) {
        if (s.count === 0) continue;
        html += `<div class="pipeline-funnel__seg" style="flex:${s.count};background:${s.color}" title="${escapeHtml(s.label)}: ${s.count}"></div>`;
      }
      html += "</div>";
      html += '<div class="pipeline-funnel__legend">';
      for (const s of stages) {
        if (s.count === 0) continue;
        html += `<span class="pipeline-funnel__key"><span class="pipeline-funnel__dot" style="background:${s.color}"></span>${escapeHtml(s.label)} <strong>${s.count}</strong></span>`;
      }
      html += "</div></div>";
    }

    // 7-day activity chart
    const maxVal = Math.max(
      1,
      ...dailyBreakdown.map((d) => Math.max(d.discovered, d.applied)),
    );
    html += '<div class="activity-chart">';
    html += '<h4 class="activity-chart__title">7-day activity</h4>';
    html += '<div class="activity-chart__bars">';
    for (const d of dailyBreakdown) {
      const discH = Math.max(
        d.discovered > 0 ? 3 : 0,
        (d.discovered / maxVal) * 100,
      );
      const appH = Math.max(d.applied > 0 ? 3 : 0, (d.applied / maxVal) * 100);
      html += `<div class="activity-chart__col">
        <div class="activity-chart__pair">
          <div class="activity-chart__bar activity-chart__bar--disc" style="height:${discH}%" title="Found: ${d.discovered}"></div>
          <div class="activity-chart__bar activity-chart__bar--app" style="height:${appH}%" title="Applied: ${d.applied}"></div>
        </div>
        <span class="activity-chart__day">${d.label}</span>
      </div>`;
    }
    html += "</div>";
    html += '<div class="activity-chart__legend">';
    html +=
      '<span class="activity-chart__key"><span class="activity-chart__dot activity-chart__dot--disc"></span>Discovered</span>';
    html +=
      '<span class="activity-chart__key"><span class="activity-chart__dot activity-chart__dot--app"></span>Applied</span>';
    html += "</div></div>";

    // Source bars
    if (sources.length > 0) {
      const maxSrc = sources[0][1];
      html += '<div class="source-bars">';
      html +=
        '<h4 class="source-bars__title">Top sources <span class="source-bars__period">7d</span></h4>';
      for (const [name, count] of sources) {
        const pct = Math.max(4, (count / maxSrc) * 100);
        html += `<div class="source-bars__row">
          <span class="source-bars__name">${escapeHtml(name)}</span>
          <div class="source-bars__track"><div class="source-bars__fill" style="width:${pct}%"></div></div>
          <span class="source-bars__count">${count}</span>
        </div>`;
      }
      html += "</div>";
    }

    // Tips
    if (suggestions.length > 0) {
      const tips = suggestions.slice(0, 3);
      html += '<div class="brief-tips">';
      html += '<h4 class="brief-tips__title">Tips</h4>';
      html += `<ul class="brief-tips__list">${tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
      html += "</div>";
    }

    return html;
  }

  // --- Brief: Activity feed ---

  function renderBriefFeed(overdue, upcoming, waiting, stale) {
    function keyOf(j) {
      return getPipelineData().indexOf(j);
    }
    const items = [];
    for (const j of overdue) {
      const d = briefDaysSince(j.followUpDate);
      items.push({
        type: "urgent",
        title: `${j.title || "Role"} \u2014 ${j.company || ""}`,
        desc: "Follow-up overdue",
        meta: d != null ? `${d}d late` : "",
        pri: 0,
        days: d || 0,
        key: keyOf(j),
      });
    }
    for (const j of waiting) {
      const d = briefDaysSince(j.appliedDate);
      items.push({
        type: "waiting",
        title: `${j.title || "Role"} \u2014 ${j.company || ""}`,
        desc: "Awaiting reply",
        meta: d != null ? `${d}d ago` : "",
        pri: 1,
        days: d || 0,
        key: keyOf(j),
      });
    }
    for (const j of stale) {
      const d = briefDaysSince(j.appliedDate);
      items.push({
        type: "stale",
        title: `${j.title || "Role"} \u2014 ${j.company || ""}`,
        desc: "Going stale",
        meta: d != null ? `${d}d` : "",
        pri: 2,
        days: d || 0,
        key: keyOf(j),
      });
    }
    for (const j of upcoming.slice(0, 3)) {
      items.push({
        type: "upcoming",
        title: `${j.title || "Role"} \u2014 ${j.company || ""}`,
        desc: "Follow-up soon",
        meta: "48h",
        pri: 3,
        days: 0,
        key: keyOf(j),
      });
    }
    items.sort((a, b) => a.pri - b.pri || b.days - a.days);

    if (!items.length) {
      return '<div class="feed-clear"><div class="feed-clear__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div><p class="feed-clear__text">All clear</p><p class="feed-clear__sub">Nothing needs your attention right now.</p></div>';
    }
    const chevron =
      '<svg class="feed-item__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    let html = '<div class="feed-list">';
    const shown = items.slice(0, 12);
    for (const it of shown) {
      const keyAttr = it.key >= 0 ? ` data-stable-key="${it.key}"` : "";
      html += `<button type="button" class="feed-item feed-item--${it.type}" data-action="open-detail"${keyAttr}><div class="feed-item__dot"></div><div class="feed-item__body"><span class="feed-item__title">${escapeHtml(it.title)}</span><span class="feed-item__desc">${it.desc}</span></div><span class="feed-item__meta">${it.meta}</span>${chevron}</button>`;
    }
    if (items.length > 12)
      html += `<div class="feed-more">+${items.length - 12} more</div>`;
    html += "</div>";
    return html;
  }

  function _DEAD_renderBriefQueue(overdue, upcoming, waiting, stale) {
    const hasItems = overdue.length || waiting.length || stale.length;

    if (!hasItems) {
      let html = '<div class="queue-clear">';
      html +=
        '<div class="queue-clear__icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>';
      html +=
        '<p class="queue-clear__text">Nothing needs your attention right now.</p>';
      if (upcoming.length > 0) {
        html += `<p class="queue-clear__text" style="margin-top:var(--space-2)">Next follow-up in 48 h: <strong>${escapeHtml(upcoming[0].title || "Role")} &mdash; ${escapeHtml(upcoming[0].company || "")}</strong></p>`;
      }
      html += "</div>";
      return html;
    }

    let html = "";

    function renderQueueGroup(dotClass, label, jobs, metaFn, limit) {
      if (jobs.length === 0) return "";
      let g = '<div class="queue-group">';
      g += `<div class="queue-group__header"><span class="queue-group__dot ${dotClass}"></span><span class="queue-group__label">${label}</span><span class="queue-group__count">${jobs.length}</span></div>`;
      const shown = jobs.slice(0, limit || 3);
      for (const j of shown) {
        const meta = metaFn(j);
        g += `<div class="queue-item"><span class="queue-item__title">${escapeHtml(j.title || "Role")} &mdash; ${escapeHtml(j.company || "")}</span>${meta}</div>`;
      }
      const remaining = jobs.length - shown.length;
      if (remaining > 0) g += `<p class="queue-overflow">+${remaining} more</p>`;
      g += "</div>";
      return g;
    }

    html += renderQueueGroup(
      "queue-group__dot--urgent",
      "Follow-ups overdue",
      overdue,
      (j) => {
        const d = briefDaysSince(j.followUpDate);
        return d != null
          ? `<span class="queue-item__meta queue-item__meta--warn">${d}d late</span>`
          : "";
      },
    );

    if (upcoming.length > 0 && overdue.length > 0) {
      let upHtml =
        '<div class="queue-upcoming"><span class="queue-upcoming__label">Next 48 h: </span>';
      upHtml += upcoming
        .slice(0, 2)
        .map(
          (j) =>
            `${escapeHtml(j.title || "Role")} &mdash; ${escapeHtml(j.company || "")}`,
        )
        .join(", ");
      upHtml += "</div>";
      html += upHtml;
    }

    html += renderQueueGroup(
      "queue-group__dot--waiting",
      "Awaiting reply",
      waiting,
      (j) => {
        const d = briefDaysSince(j.appliedDate);
        return d != null ? `<span class="queue-item__meta">${d}d ago</span>` : "";
      },
    );

    html += renderQueueGroup(
      "queue-group__dot--stale",
      "Stale applications",
      stale,
      (j) => {
        const d = briefDaysSince(j.appliedDate);
        return d != null
          ? `<span class="queue-item__meta queue-item__meta--warn">${d}d</span>`
          : "";
      },
    );

    return html;
  }

  // --- Brief: orchestrator ---

  function renderPipelineDailyBrief() {
    return getPipelineData().length > 0;
  }

  function renderBrief() {
    const dateEl = document.getElementById("briefDate");
    const headlineEl = document.getElementById("briefHeadline");
    const insightsEl = document.getElementById("briefInsights");
    const actionEl = document.getElementById("briefAction");
    const followPanel = document.getElementById("briefFollowupPanel");
    const mainGrid = document.getElementById("briefMainGrid");
    const statsEl = document.getElementById("briefStats");

    const now = new Date();
    if (dateEl)
      dateEl.textContent = now.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });

    const pipelineEl = document.getElementById("briefPipeline");
    const sourcesEl = document.getElementById("briefSources");

    if (!getPipelineData().length) {
      if (headlineEl) headlineEl.innerHTML = "";
      if (actionEl) actionEl.innerHTML = "";
      if (followPanel) {
        followPanel.hidden = true;
        followPanel.style.display = "none";
      }
      if (mainGrid) mainGrid.classList.remove("brief-dashboard--empty");
      if (statsEl)
        statsEl.innerHTML = renderBriefStats({
          discRecent: 0,
          discPrior: 0,
          appRecent: 0,
          appPrior: 0,
          inLoop: 0,
          offers: 0,
          medianDays: null,
        });
      if (pipelineEl) pipelineEl.innerHTML = renderEmptyDonutScaffold();
      if (insightsEl) insightsEl.innerHTML = renderEmptyInsightsScaffold();
      if (sourcesEl) sourcesEl.innerHTML = renderEmptySourcesScaffold();
      return;
    }

    if (followPanel) {
      followPanel.hidden = false;
      followPanel.style.display = "";
    }
    if (mainGrid) mainGrid.classList.remove("brief-dashboard--empty");

    const todayJobs = jobsFoundToday(getPipelineData());
    const overdue = overdueFollowUps(getPipelineData());
    const upcoming = upcomingFollowUps48h(getPipelineData());
    const stale = getPipelineData().filter(isStaleApplied);
    const waiting = waitingOnReplyJobs(getPipelineData());

    const w = getInsightDateWindows();
    const discRecent = countDateFoundInWindow(
      getPipelineData(),
      w.recentStart,
      w.recentEnd,
    );
    const discPrior = countDateFoundInWindow(
      getPipelineData(),
      w.priorStart,
      w.priorEnd,
    );
    const appRecent = countAppliedInWindow(
      getPipelineData(),
      w.recentStart,
      w.recentEnd,
    );
    const appPrior = countAppliedInWindow(getPipelineData(), w.priorStart, w.priorEnd);

    const stn = (s) => (s || "").toLowerCase().trim();
    const offers = getPipelineData().filter((j) =>
      stn(j.status).includes("offer"),
    ).length;
    const interviewing = getPipelineData().filter((j) =>
      stn(j.status).includes("interviewing"),
    ).length;
    const phoneScreens = getPipelineData().filter((j) =>
      stn(j.status).includes("phone screen"),
    ).length;
    const rejected = getPipelineData().filter((j) =>
      stn(j.status).includes("rejected"),
    ).length;
    const passed = getPipelineData().filter((j) => stn(j.status) === "passed").length;
    const expired = getPipelineData().filter((j) => stn(j.status) === "expired").length;

    const inboxCount = getPipelineData().filter((j) => {
      const s = stn(j.status);
      return !s || s === "new" || s === "researching";
    }).length;
    const appliedCount = getPipelineData().filter(
      (j) => stn(j.status) === "applied",
    ).length;
    const researchingCount = getPipelineData().filter(
      (j) => stn(j.status) === "researching",
    ).length;
    const newCount = inboxCount - researchingCount;

    const medianDays = medianDaysDiscoveryToApply(getPipelineData());
    const sources = topSourcesInWindow(
      getPipelineData(),
      w.recentStart,
      w.recentEnd,
      5,
    );

    const suggestions = buildBriefSuggestions({
      staleLen: stale.length,
      waitingLen: waiting.length,
      overdueLen: overdue.length,
      inboxCount,
      discRecent,
      appliedRecent: appRecent,
      offers,
      total: getPipelineData().length,
    });

    const inLoop = interviewing + phoneScreens;

    if (headlineEl)
      headlineEl.innerHTML = briefHeadlineSentence(
        overdue,
        waiting,
        stale,
        todayJobs,
      );

    if (statsEl)
      statsEl.innerHTML = renderBriefStats({
        discRecent,
        discPrior,
        appRecent,
        appPrior,
        inLoop,
        offers,
        medianDays,
      });

    const stages = [
      { label: "New", count: newCount, color: "var(--stage-rail-new)" },
      {
        label: "Researching",
        count: researchingCount,
        color: "var(--stage-rail-researching)",
      },
      {
        label: "Applied",
        count: appliedCount,
        color: "var(--stage-rail-applied)",
      },
      {
        label: "Phone Screen",
        count: phoneScreens,
        color: "var(--stage-rail-phone-screen)",
      },
      {
        label: "Interviewing",
        count: interviewing,
        color: "var(--stage-rail-interviewing)",
      },
      { label: "Offer", count: offers, color: "var(--stage-rail-offer)" },
      { label: "Rejected", count: rejected, color: "var(--stage-rail-rejected)" },
      { label: "Passed", count: passed, color: "var(--stage-rail-passed)" },
      { label: "Expired", count: expired, color: "var(--stage-rail-expired)" },
    ];

    if (pipelineEl) pipelineEl.innerHTML = renderDonutWidget(stages);
    if (insightsEl)
      insightsEl.innerHTML = renderAreaWidget(getPipelineData(), briefActivityRange);
    if (sourcesEl) sourcesEl.innerHTML = renderSourceWidget(sources, suggestions);
    if (actionEl)
      actionEl.innerHTML = renderBriefFeed(overdue, upcoming, waiting, stale);
  }

  Object.assign(brief, {
    renderBrief,
    renderAreaWidget,
    renderPipelineDailyBrief,
    getBriefActivityRange,
    setBriefActivityRange,
  });
})();
