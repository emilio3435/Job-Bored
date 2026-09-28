/**
 * A media-sales example candidate aimed at a real posting shape (NorthwindMedia,
 * "Director, Digital Sales"), for the visual-polish renders and the
 * text-layer and target-logo tests. No real person: "Jordan Avila",
 * user@example.com, a 555 number. Past employers are real companies so the
 * logo resolver has something to find; nothing here is anyone's history.
 */

export const NORTHWIND_RESUME_TEXT = [
  "Jordan Avila",
  "Austin, CO | 555-010-2080 | user@example.com | linkedin.com/in/jordan-avila-example | jordan-avila.example.com",
  "",
  "Digital sales leader who builds the book, the desk and the playbook at the same time.",
  "",
  "Cumulus Media, Senior Digital Sales Manager, 2021-2026, Austin, CO",
  "- Grew the market's digital book from $6.1M to $10.4M in three years while holding 94% advertiser retention.",
  "- Coached 12 account executives through 24+ monthly pitches and moved the desk to top-4 national digital revenue.",
  "- Launched a weekly pipeline review that cut average proposal turnaround from 6 days to 2.",
  "- Packaged streaming audio, podcast and CTV into one cross-platform offer that closed 38 new-to-market accounts.",
  "",
  "Spotify Advertising, Account Executive, 2018-2021, Austin, CO",
  "- Closed $3.2M in new programmatic audio business across 41 regional agencies.",
  "- Built the first podcast sponsorship package for the Mountain region, sold through at 112% of goal.",
  "- Trained 9 sellers on audience-based planning and the self-serve ad studio.",
  "",
  "Hearst Newspapers, Digital Media Consultant, 2015-2018, Houston, TX",
  "- Sold search, social and display bundles to 60+ local businesses; finished 2017 at 131% of quota.",
  "",
  "Clear Channel Outdoor, Sales Coordinator, 2013-2015, Houston, TX",
  "- Managed proposals and makegoods for a 14-seller team.",
  "",
  "Education",
  "B.A. Communication, University of Colorado Boulder, 2013",
  "",
  "Skills",
  "Digital audio, podcast, CTV/OTT, programmatic, AtlasCRM, Looker, Google Ad Manager, forecasting, sales coaching, Spanish",
].join("\n");

export const NORTHWIND_WRITER_JSON = {
  letter: {
    date: "September 27, 2026",
    company: "NorthwindMedia, Inc.",
    companyAddr: "Austin, CO",
    role: "Director, Digital Sales",
    hiringManager: "",
    hook: "You are hiring someone to turn a strong broadcast desk into a digital-first one without losing the relationships that pay the bills, and that is the work I have done for the last five years.",
    whyThem: "NorthwindMedia already owns the audience: broadcast, streaming and the largest podcast network in the country. The posting is clear that the gap is packaging it so a regional buyer can say yes in one meeting.",
    whyMe: "At Cumulus Media I grew the market's digital book from $6.1M to $10.4M while holding 94% advertiser retention, and coached 12 account executives to a top-4 national digital ranking. Before that, at Spotify Advertising, I closed $3.2M in new programmatic audio business across 41 regional agencies.",
    whyNow: "",
    closing: "In the first ninety days I would sit in on every desk's pipeline review, pick the three offers that already sell, and package them so every seller can pitch them the same week. I would welcome the chance to walk you through how I did that at Cumulus.",
    flourish: "",
  },
  resume: {
    header: {
      name: "Jordan Avila",
      headline: "Director, Digital Sales",
      contact: ["Austin, CO", "555-010-2080", "user@example.com", "linkedin.com/in/jordan-avila-example", "jordan-avila.example.com"],
    },
    summary: {
      opener: "Digital sales leader who builds the book, the desk and the playbook at the same time.",
      body: "Eleven years across broadcast, streaming and print, most recently growing a $10.4M digital book and a top-4 national desk.",
    },
    roles: [
      {
        id: "cumulus-media",
        company: "Cumulus Media",
        title: "Senior Digital Sales Manager",
        dates: "2021 – 2026",
        location: "Austin, CO",
        bullets: [
          "Grew the market's digital book from $6.1M to $10.4M in three years while holding 94% advertiser retention.",
          "Coached 12 account executives through 24+ monthly pitches and moved the desk to top-4 national digital revenue.",
          "Launched a weekly pipeline review that cut average proposal turnaround from 6 days to 2.",
          "Packaged streaming audio, podcast and CTV into one cross-platform offer that closed 38 new-to-market accounts.",
        ],
      },
      {
        id: "spotify-advertising",
        company: "Spotify Advertising",
        title: "Account Executive",
        dates: "2018 – 2021",
        location: "Austin, CO",
        bullets: [
          "Closed $3.2M in new programmatic audio business across 41 regional agencies.",
          "Built the first podcast sponsorship package for the Mountain region, sold through at 112% of goal.",
          "Trained 9 sellers on audience-based planning and the self-serve ad studio.",
        ],
      },
      {
        id: "hearst-newspapers",
        company: "Hearst Newspapers",
        title: "Digital Media Consultant",
        dates: "2015 – 2018",
        location: "Houston, TX",
        bullets: [
          "Sold search, social and display bundles to 60+ local businesses; finished 2017 at 131% of quota.",
          "Built the market's first retargeting package and trained the desk to sell it.",
        ],
      },
      {
        id: "clear-channel-outdoor",
        company: "Clear Channel Outdoor",
        title: "Sales Coordinator",
        dates: "2013 – 2015",
        location: "Houston, TX",
        bullets: ["Managed proposals and makegoods for a 14-seller team."],
      },
    ],
    education: ["B.A. Communication, University of Colorado Boulder, 2013"],
    skills: ["Digital audio", "podcast", "CTV/OTT", "programmatic", "AtlasCRM", "Looker", "Google Ad Manager", "forecasting", "sales coaching", "Spanish"],
  },
};

/** Companies the sample renders resolve logos for (logos.json shape). */
export const NORTHWIND_LOGO_MANIFEST = {
  logos: [
    { slug: "cumulus-media", label: "Cumulus Media", domain: "cumulusmedia.com" },
    { slug: "spotify-advertising", label: "Spotify Advertising", domain: "ads.spotify.com" },
    { slug: "hearst-newspapers", label: "Hearst Newspapers", domain: "hearst.com" },
    { slug: "clear-channel-outdoor", label: "Clear Channel Outdoor", domain: "clearchanneloutdoor.com" },
    { slug: "university-of-colorado-boulder", label: "University of Colorado Boulder", domain: "colorado.edu" },
  ],
};

export const NORTHWIND_TARGET = { company: "NorthwindMedia, Inc.", domain: "northwindmedia.com" };
