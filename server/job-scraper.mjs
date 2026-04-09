/**
 * Cheerio-based job posting extraction (JSON-LD JobPosting + DOM heuristics).
 * Produces a stable JSON shape for the dashboard; DOM noise (nav, footers, ads)
 * is stripped before text extraction.
 * Run standalone: node job-scraper.mjs <url>
 */
import * as cheerio from "cheerio";

const FETCH_TIMEOUT_MS = 18000;
const MAX_HTML_BYTES = 4 * 1024 * 1024;

const UA =
  "Mozilla/5.0 (compatible; CommandCenterJobBot/1.0; +https://github.com/job-bored) AppleWebKit/537.36 Chrome/120 Safari/537.36";

/** [lowercase needle, display label] for skill chips */
const KNOWN_SKILLS = [
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["python", "Python"],
  ["java", "Java"],
  ["golang", "Go"],
  ["rust", "Rust"],
  ["ruby", "Ruby"],
  ["php", "PHP"],
  ["react", "React"],
  ["vue", "Vue"],
  ["angular", "Angular"],
  ["svelte", "Svelte"],
  ["next.js", "Next.js"],
  ["node.js", "Node.js"],
  ["django", "Django"],
  ["flask", "Flask"],
  ["fastapi", "FastAPI"],
  ["docker", "Docker"],
  ["terraform", "Terraform"],
  ["postgresql", "PostgreSQL"],
  ["mysql", "MySQL"],
  ["mongodb", "MongoDB"],
  ["redis", "Redis"],
  ["kafka", "Kafka"],
  ["graphql", "GraphQL"],
  ["grpc", "gRPC"],
  ["elasticsearch", "Elasticsearch"],
  ["snowflake", "Snowflake"],
  ["databricks", "Databricks"],
  ["pytorch", "PyTorch"],
  ["tensorflow", "TensorFlow"],
  ["kubernetes", "Kubernetes"],
  ["aws", "AWS"],
  ["azure", "Azure"],
  ["gcp", "GCP"],
  ["machine learning", "Machine learning"],
  ["deep learning", "Deep learning"],
  ["nlp", "NLP"],
  ["llm", "LLM"],
  ["claude", "Claude"],
  ["cursor", "Cursor"],
  ["ci/cd", "CI/CD"],
  ["microservices", "Microservices"],
  ["oauth", "OAuth"],
  ["saml", "SAML"],
  ["soc 2", "SOC 2"],
  ["hipaa", "HIPAA"],
];

/** Short lines that are almost always global nav / job-board chrome, not role requirements */
const JUNK_BULLET_LINE = new RegExp(
  `^(` +
    [
      "hire on",
      "post a job",
      "companies",
      "articles",
      "salaries",
      "job application tracker",
      "built in",
      "sign in",
      "log in",
      "get started",
      "post a free job",
      "browse jobs",
      "for employers",
      "for job seekers",
    ].join("|") +
    ")\\b",
  "i",
);

/** If many bullets match this, the whole extraction is probably nav-heavy */
const JUNK_BULLET_FRACTION = 0.35;

/** Penalize JSON-LD blobs that look like site chrome or wrong product pitch */
function ldTextLooksLikeNoise(text) {
  if (!text || text.length < 40) return true;
  const low = text.toLowerCase();
  if (/\b(hire on built in|post a job|job application tracker)\b/i.test(text))
    return true;
  if (
    /\bapollo\.io\b/i.test(low) &&
    /\bgo-?to-?market\b/i.test(low) &&
    !/\bscale\b/i.test(low)
  ) {
    return true;
  }
  return false;
}

/** Reject fake “skills” from investor / About sections */
const SKILL_DENYLIST = new Set(
  [
    "founded",
    "by",
    "sequoia",
    "capital",
    "bain",
    "ventures",
    "president",
    "investors",
    "board",
    "series",
    "funding",
    "headquarters",
    "employees",
    "million",
    "billion",
  ].map((s) => s.toLowerCase()),
);

function normalizeSpace(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(html) {
  if (!html || typeof html !== "string") return "";
  const $ = cheerio.load(html);
  return normalizeSpace($.text());
}

function collectJsonLdBlocks($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      const j = JSON.parse(raw.trim());
      if (Array.isArray(j)) out.push(...j);
      else out.push(j);
    } catch {
      /* ignore */
    }
  });
  return out;
}

function findJobPostingObjects(blocks) {
  const jobs = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    const t = node["@type"];
    const types = Array.isArray(t) ? t : t ? [t] : [];
    if (types.some((x) => String(x).toLowerCase() === "jobposting")) {
      jobs.push(node);
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
    } else {
      for (const k of Object.keys(node)) {
        if (k === "@context") continue;
        walk(node[k]);
      }
    }
  }
  for (const b of blocks) walk(b);
  return jobs;
}

function textFromJobPostingLd(j) {
  const title = j.title || j.name || null;
  let desc = "";
  const d = j.description;
  if (typeof d === "string") {
    desc = d.includes("<") ? stripTags(d) : normalizeSpace(d);
  } else if (d && typeof d === "object" && d["@type"] === "HTMLString") {
    desc = stripTags(String(d.value || d));
  }
  const qual =
    j.qualifications ||
    j.skills ||
    j.responsibilities ||
    j.experienceRequirements;
  let extra = "";
  if (typeof qual === "string") extra += "\n\n" + normalizeSpace(qual);
  else if (qual && typeof qual === "object") {
    extra += "\n\n" + normalizeSpace(JSON.stringify(qual));
  }
  return { title: title ? String(title) : null, text: normalizeSpace(desc + extra) };
}

/**
 * Pick the JobPosting block whose description is most likely the real role
 * (longest substantive text, penalized for nav-like content).
 */
function pickBestJobPostingLd(jobPostings) {
  if (!jobPostings.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const j of jobPostings) {
    const { text } = textFromJobPostingLd(j);
    if (!text || text.length < 80) continue;
    let score = Math.min(text.length, 25000);
    const low = text.toLowerCase();
    if (/\b(hire on built in|post a job|job application tracker)\b/i.test(text))
      score -= 12000;
    if (
      /\bapollo\.io\b/i.test(low) &&
      j.hiringOrganization &&
      typeof j.hiringOrganization === "object"
    ) {
      const orgName = String(j.hiringOrganization.name || "").toLowerCase();
      if (orgName && !orgName.includes("apollo") && low.includes("apollo"))
        score -= 8000;
    }
    if (j.datePosted) score += 50;
    if (j.hiringOrganization?.name) score += 80;
    if (j.baseSalary || j.salaryCurrency) score += 40;
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return best;
}

/**
 * Remove global chrome before we read paragraphs/lists (JSON-LD is collected first).
 */
function pruneDomForJobExtraction($) {
  $(
    "script, style, noscript, svg, template, iframe, picture, canvas, video, audio",
  ).remove();
  $("header, footer, nav, [role='navigation'], aside, [role='complementary']").remove();
  $(
    "[class*='cookie'], [id*='cookie'], [class*='consent'], [id*='consent'], [data-testid*='nav'], [class*='global-nav'], [class*='site-header'], [class*='site-footer'], [class*='job-board-nav']",
  ).remove();
}

/** Prefer specific job regions; keep broad selectors last so we do not grab the whole site */
const DESCRIPTION_SELECTORS_SPECIFIC = [
  "[data-job-description]",
  "[data-testid='job-description']",
  "[data-test='job-description']",
  "[data-testid*='job-description']",
  ".job-description",
  ".job-description-view",
  ".description__text",
  "#job-description",
  ".job-details",
  ".posting-content",
  "article.job-description",
  "[itemtype*='JobPosting']",
];

const DESCRIPTION_SELECTORS_BROAD = [
  '[role="main"]',
  "#main",
  ".main-content",
  "main",
  "article",
  ".content",
];

function findBestDescriptionFromDom($) {
  let best = "";
  let containerSelector = null;
  let $bestEl = null;

  const trySel = (sel, minLen, broad) => {
    $(sel).each((_, node) => {
      const $el = $(node);
      const t = normalizeSpace($el.text());
      if (t.length > best.length && t.length >= minLen) {
        if (broad && t.length > 80000) return;
        best = t;
        containerSelector = sel;
        $bestEl = $el;
      }
    });
  };

  for (const sel of DESCRIPTION_SELECTORS_SPECIFIC) {
    trySel(sel, 120, false);
  }
  if (best.length >= 400 && $bestEl)
    return { text: best, containerSelector, $container: $bestEl };

  for (const sel of DESCRIPTION_SELECTORS_BROAD) {
    trySel(sel, 200, true);
  }
  if (best.length >= 200 && $bestEl)
    return { text: best, containerSelector, $container: $bestEl };

  const fallback = largestTextBlock($, $.root());
  return {
    text: fallback,
    containerSelector: fallback.length > 80 ? "(largest block)" : null,
    $container: null,
  };
}

function largestTextBlock($, root) {
  let best = "";
  const scope = root && root.length ? root : $.root();
  scope.find("p, li, div").each((_, el) => {
    const t = normalizeSpace($(el).text());
    if (t.length > best.length && t.length < 120000) best = t;
  });
  return best;
}

function extractSectionBullets($, keywords, scope) {
  const bullets = [];
  const lower = keywords.map((k) => k.toLowerCase());
  const $root = scope && scope.length ? scope : $.root();
  $root.find("h1, h2, h3, h4, h5, h6, strong, b").each((_, el) => {
    const heading = normalizeSpace($(el).text()).toLowerCase();
    if (!heading) return;
    const hit = lower.some((k) => heading.includes(k));
    if (!hit) return;
    let $n = $(el).next();
    let guard = 0;
    while ($n.length && guard++ < 40) {
      const name = ($n[0] && $n[0].name) || "";
      if (/^h[1-6]$/i.test(name)) break;
      if (name === "ul" || name === "ol") {
        $n.find("li").each((__, li) => {
          const line = normalizeSpace($(li).text());
          if (line.length > 2 && line.length < 800) bullets.push(line);
        });
        break;
      }
      if (name === "p") {
        const line = normalizeSpace($n.text());
        if (line.length > 20 && line.length < 800) bullets.push(line);
        break;
      }
      $n = $n.next();
    }
  });
  return bullets;
}

function extractListBullets($, scope, max = 50) {
  const out = [];
  const $root = scope && scope.length ? scope : $.root();
  $root.find("ul li, ol li").each((_, li) => {
    const t = normalizeSpace($(li).text());
    if (t.length > 8 && t.length < 600 && !out.includes(t)) out.push(t);
  });
  return out.slice(0, max);
}

function filterJunkBullets(bullets) {
  const out = [];
  for (const b of bullets) {
    const s = String(b).trim();
    if (s.length < 10) continue;
    if (JUNK_BULLET_LINE.test(s)) continue;
    if (/^(home|careers|about|blog|pricing|resources)\s*$/i.test(s)) continue;
    out.push(s);
  }
  return out;
}

function guessRequirementsFromText(text) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const req = [];
  const lower = text.toLowerCase();
  const sectionIdx = lines.findIndex((l) =>
    /^(requirements|qualifications|what you|what we|you have|must have|minimum|required skills|preferred skills)/i.test(
      l.slice(0, 80),
    ),
  );
  if (sectionIdx >= 0) {
    for (let i = sectionIdx + 1; i < Math.min(lines.length, sectionIdx + 40); i++) {
      const l = lines[i];
      if (/^#{1,4}\s/.test(l)) break;
      if (/^(benefits|about|company|apply)/i.test(l)) break;
      if (/^[•\-\*]\s/.test(l) || /^\d+\.\s/.test(l)) {
        const cleaned = l.replace(/^[•\-\*]\s*/, "").replace(/^\d+\.\s*/, "").trim();
        if (!JUNK_BULLET_LINE.test(cleaned)) req.push(cleaned);
      } else if (l.length < 200 && l.length > 8 && !JUNK_BULLET_LINE.test(l)) {
        req.push(l);
      }
    }
  }
  if (req.length === 0 && lower.includes("requirement")) {
    for (const l of lines) {
      if (
        /^[•\-\*]\s/.test(l) &&
        l.length < 400 &&
        !JUNK_BULLET_LINE.test(l)
      ) {
        req.push(l.replace(/^[•\-\*]\s*/, "").trim());
      }
    }
  }
  return req.slice(0, 30);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Skills = known tech terms found in text (no generic Title Case word harvesting).
 */
function extractSkillsFromText(text, requirements) {
  const bag = new Set();
  const blob = normalizeSpace(`${text}\n${requirements.join("\n")}`);
  for (const [word, label] of KNOWN_SKILLS) {
    if (word.length < 2) continue;
    if (new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(blob)) {
      bag.add(label);
    }
  }
  if (/\bgoogle\s+cloud\b/i.test(blob)) bag.add("GCP");
  if (/\bci\s*\/\s*cd\b/i.test(blob)) bag.add("CI/CD");
  if (/\bsoc\s*2\b/i.test(blob)) bag.add("SOC 2");
  // Short acronyms often used in job posts (2–5 chars, all caps)
  const acronymRe = /\b([A-Z]{2,5})\b/g;
  let m;
  const allowAcronym = new Set([
    "API",
    "SDK",
    "UI",
    "UX",
    "SQL",
    "ETL",
    "ML",
    "AI",
    "KPI",
    "SEO",
    "SEM",
    "CRM",
    "CDN",
    "IAM",
    "SSO",
    "SLA",
    "QA",
    "PM",
    "VP",
    "B2B",
    "B2C",
    "SMB",
  ]);
  while ((m = acronymRe.exec(blob))) {
    if (allowAcronym.has(m[1])) bag.add(m[1]);
  }
  return [...bag]
    .filter((label) => !SKILL_DENYLIST.has(label.toLowerCase()))
    .slice(0, 40);
}

/**
 * @param {string} url
 */
export async function scrapeJobPosting(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) {
      throw new Error("Page too large");
    }
    html = new TextDecoder("utf-8").decode(buf);
  } finally {
    clearTimeout(t);
  }

  const $ = cheerio.load(html);
  const warnings = [];

  let title = normalizeSpace($("title").first().text()) || null;
  let description = "";
  let method = "dom";
  let containerUsed = null;

  const blocks = collectJsonLdBlocks($);
  const jobPostings = findJobPostingObjects(blocks);
  const bestJp = pickBestJobPostingLd(jobPostings);

  let ldTitle = null;
  let ldText = "";
  if (bestJp) {
    const ld = textFromJobPostingLd(bestJp);
    ldText = ld.text;
    ldTitle = ld.title;
  }

  pruneDomForJobExtraction($);

  const domPick = findBestDescriptionFromDom($);
  const domText = domPick.text;
  containerUsed = domPick.containerSelector;
  const $jobRoot = domPick.$container;

  if (ldText && ldText.length >= 120 && !ldTextLooksLikeNoise(ldText)) {
    description = ldText;
    if (ldTitle) title = ldTitle;
    method = "json-ld";
    if (domText.length > description.length * 1.4 && domText.length > 500) {
      warnings.push(
        "JSON-LD used but a larger DOM block was found; if the description looks wrong, the page may embed multiple postings or ads.",
      );
    }
  } else {
    if (bestJp && ldTextLooksLikeNoise(ldText)) {
      warnings.push(
        "JSON-LD description looked like site chrome or unrelated content; fell back to DOM extraction.",
      );
    }
    description = domText;
    method = domText.length >= 80 ? "dom" : "dom-fallback";
    if (!description || description.length < 80) {
      description = largestTextBlock($, $.root());
      method = "dom-fallback";
      containerUsed = "(largest block)";
    }
  }

  if (
    ldText &&
    ldTextLooksLikeNoise(ldText) &&
    domText &&
    domText.length > 200
  ) {
    description = domText;
    method = "dom";
    if (ldTitle && (!title || title.length < 5)) title = ldTitle;
  }

  const scope = $jobRoot && $jobRoot.length ? $jobRoot : $.root();

  const sectionBullets = filterJunkBullets(
    extractSectionBullets(
      $,
      [
        "requirement",
        "qualification",
        "skill",
        "experience",
        "responsibilit",
        "you have",
        "you will",
        "what you",
      ],
      scope,
    ),
  );
  let listBullets = filterJunkBullets(extractListBullets($, scope));

  const junkCount = listBullets.filter((b) => JUNK_BULLET_LINE.test(b)).length;
  if (
    listBullets.length > 5 &&
    junkCount / listBullets.length > JUNK_BULLET_FRACTION
  ) {
    warnings.push(
      "Many list items looked like site navigation; trimmed using heuristics.",
    );
    listBullets = listBullets.filter((b) => !JUNK_BULLET_LINE.test(b));
  }

  let requirements = [...new Set([...sectionBullets, ...listBullets])].filter(
    (x) => x.length > 5,
  );

  if (requirements.length < 4) {
    requirements = [
      ...requirements,
      ...filterJunkBullets(guessRequirementsFromText(description)),
    ];
    requirements = [...new Set(requirements)].slice(0, 35);
  } else {
    requirements = requirements.slice(0, 35);
  }

  const skills = extractSkillsFromText(description, requirements);

  description = description.slice(0, 25000);

  return {
    url,
    title: title || null,
    description,
    requirements,
    skills,
    source: method,
    method,
    scraping: {
      jsonLdCandidates: jobPostings.length,
      containerHint: containerUsed,
    },
    warnings,
  };
}

const urlArg = process.argv[2];
if (urlArg && urlArg.startsWith("http")) {
  scrapeJobPosting(urlArg)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
