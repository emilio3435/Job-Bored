import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "assets", "mascot-header");
const mascotSourcePath = path.join(outDir, "source-job-bored-flying-mascot.svg");

const sourceSvg = readFileSync(mascotSourcePath, "utf8");
const mascotInner = sourceSvg
  .replace(/<\?xml[^>]*>\s*/i, "")
  .replace(/^<svg[^>]*>\s*/i, "")
  .replace(/\s*<\/svg>\s*$/i, "");

const W = 1600;
const H = 720;
const C = {
  ink: "#003851",
  navy: "#062B45",
  teal: "#006482",
  deep: "#0B486B",
  green: "#27C88A",
  green2: "#59CB89",
  orange: "#EF8F26",
  yellow: "#F9D091",
  paper: "#FEFFFE",
  cream: "#FFF7E8",
  mint: "#ECFFF5",
  sky: "#E6F8FF",
  gray: "#D7E6EA",
};

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return char;
    }
  });
}

function mascot({ x, y, width, rotate = 0, flip = false, opacity = 1 }) {
  const height = width * (155.5 / 172);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const placement = flip
    ? `translate(${x + width} ${y}) scale(-1 1)`
    : `translate(${x} ${y})`;

  return `
    <g opacity="${opacity}" transform="rotate(${rotate} ${cx} ${cy})">
      <g transform="${placement}">
        <svg width="${width}" height="${height}" viewBox="0 0 172 155.5" overflow="visible">
          ${mascotInner}
        </svg>
      </g>
    </g>`;
}

function shadow(cx, cy, rx, ry, opacity = 0.16) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${C.deep}" opacity="${opacity}"/>`;
}

function motionLine(x1, y1, x2, y2, width = 10, color = C.green, opacity = 0.82) {
  return `<path d="M${x1} ${y1}C${(x1 + x2) / 2} ${y1 - 76},${(x1 + x2) / 2} ${y2 + 76},${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"/>`;
}

function spark(x, y, size = 44, fill = C.green) {
  return `<path d="M${x} ${y - size}l${size * 0.25} ${size * 0.7}l${size * 0.75} ${size * 0.3}l-${size * 0.75} ${size * 0.3}l-${size * 0.25} ${size * 0.7}l-${size * 0.25}-${size * 0.7}l-${size * 0.75}-${size * 0.3}l${size * 0.75}-${size * 0.3}z" fill="${fill}" stroke="${C.ink}" stroke-width="5" stroke-linejoin="round"/>`;
}

function tag(x, y, fill = C.paper, rotate = 0, width = 220) {
  return `
    <g transform="rotate(${rotate} ${x + width / 2} ${y + 34})">
      <rect x="${x}" y="${y}" width="${width}" height="68" rx="18" fill="${fill}" stroke="${C.ink}" stroke-width="6"/>
      <circle cx="${x + 42}" cy="${y + 34}" r="10" fill="${C.green}"/>
      <rect x="${x + 70}" y="${y + 25}" width="${width - 104}" height="10" rx="5" fill="${C.ink}" opacity=".2"/>
      <rect x="${x + 70}" y="${y + 43}" width="${width - 146}" height="10" rx="5" fill="${C.ink}" opacity=".2"/>
    </g>`;
}

function paper(x, y, w, h, rotate = 0, accent = C.green) {
  return `
    <g transform="rotate(${rotate} ${x + w / 2} ${y + h / 2})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${C.paper}" stroke="${C.ink}" stroke-width="6"/>
      <path d="M${x + w - 52} ${y}v52h52" fill="${C.sky}" stroke="${C.ink}" stroke-width="6" stroke-linejoin="round"/>
      <rect x="${x + 32}" y="${y + 38}" width="${w - 118}" height="13" rx="7" fill="${accent}"/>
      <rect x="${x + 32}" y="${y + 78}" width="${w - 84}" height="11" rx="6" fill="${C.ink}" opacity=".2"/>
      <rect x="${x + 32}" y="${y + 114}" width="${w - 128}" height="11" rx="6" fill="${C.ink}" opacity=".2"/>
      <path d="M${x + 34} ${y + h - 42}l22 22l48-56" fill="none" stroke="${C.green}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
}

function browserCard(x, y, w, h, rotate = 0, fill = C.paper) {
  return `
    <g transform="rotate(${rotate} ${x + w / 2} ${y + h / 2})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${fill}" stroke="${C.ink}" stroke-width="6"/>
      <path d="M${x} ${y + 48}h${w}" stroke="${C.ink}" stroke-width="6"/>
      <circle cx="${x + 30}" cy="${y + 24}" r="7" fill="${C.orange}"/>
      <circle cx="${x + 56}" cy="${y + 24}" r="7" fill="${C.green}"/>
      <rect x="${x + 92}" y="${y + 18}" width="${w - 132}" height="13" rx="7" fill="${C.ink}" opacity=".16"/>
      <rect x="${x + 34}" y="${y + 80}" width="${w - 68}" height="12" rx="6" fill="${C.ink}" opacity=".18"/>
      <rect x="${x + 34}" y="${y + 114}" width="${w - 110}" height="12" rx="6" fill="${C.ink}" opacity=".18"/>
      <rect x="${x + 34}" y="${y + h - 44}" width="${w - 146}" height="12" rx="6" fill="${C.green}"/>
    </g>`;
}

function calendar(x, y, w, h, rotate = 0) {
  return `
    <g transform="rotate(${rotate} ${x + w / 2} ${y + h / 2})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${C.paper}" stroke="${C.ink}" stroke-width="6"/>
      <rect x="${x}" y="${y}" width="${w}" height="58" rx="18" fill="${C.orange}" stroke="${C.ink}" stroke-width="6"/>
      <path d="M${x} ${y + 58}h${w}" stroke="${C.ink}" stroke-width="6"/>
      <g fill="${C.ink}" opacity=".72">
        <circle cx="${x + 48}" cy="${y + 100}" r="10"/>
        <circle cx="${x + 100}" cy="${y + 100}" r="10"/>
        <circle cx="${x + 152}" cy="${y + 100}" r="10"/>
        <circle cx="${x + 48}" cy="${y + 148}" r="10"/>
        <circle cx="${x + 100}" cy="${y + 148}" r="10"/>
      </g>
      <circle cx="${x + 152}" cy="${y + 148}" r="16" fill="${C.green}" stroke="${C.ink}" stroke-width="6"/>
      <path d="M${x + 52} ${y + h - 36}h${w - 104}" stroke="${C.ink}" stroke-width="10" stroke-linecap="round" opacity=".18"/>
    </g>`;
}

function checkbox(x, y, rotate = 0, fill = C.paper, width = 330) {
  return `
    <g transform="rotate(${rotate} ${x + width / 2} ${y + 38})">
      <rect x="${x}" y="${y}" width="76" height="76" rx="16" fill="${fill}" stroke="${C.ink}" stroke-width="6"/>
      <path d="M${x + 17} ${y + 40}l19 19l42-48" fill="none" stroke="${C.green}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="${x + 104}" y="${y + 24}" width="${width - 124}" height="12" rx="6" fill="${C.ink}" opacity=".22"/>
      <rect x="${x + 104}" y="${y + 48}" width="${width - 176}" height="12" rx="6" fill="${C.ink}" opacity=".22"/>
    </g>`;
}

function background(id, fill = C.mint) {
  return `
    <defs>
      <linearGradient id="${id}-bg" x1="0" x2="1" y1="0" y2="1">
        <stop stop-color="${fill}" offset="0"/>
        <stop stop-color="${C.paper}" offset=".54"/>
        <stop stop-color="${C.sky}" offset="1"/>
      </linearGradient>
      <pattern id="${id}-dots" width="44" height="44" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="4" r="3" fill="${C.ink}" opacity=".075"/>
      </pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#${id}-bg)"/>
    <rect width="${W}" height="${H}" fill="url(#${id}-dots)"/>
    <path d="M-90 620C204 498 468 700 770 620C1058 544 1238 368 1680 442v330H-90z" fill="${C.green}" opacity=".13"/>
    <path d="M-90 684C232 596 526 734 838 656C1126 584 1300 510 1690 562v206H-90z" fill="${C.orange}" opacity=".11"/>`;
}

function svgDoc(id, title, body, fill) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" fill="none" viewBox="0 0 ${W} ${H}">
  <title>${esc(title)}</title>
  <desc>Header-ready JobBored mascot artwork generated from assets/mascot-header/source-job-bored-flying-mascot.svg.</desc>
  ${background(id, fill)}
  ${body}
</svg>
`;
}

const variants = [
  {
    file: "mascot-header-01-paperwork-uppercut.svg",
    title: "Flying JobBored mascot punches through repetitive application paperwork",
    fill: "#F0FFF6",
    body: `
      ${shadow(790, 625, 330, 36)}
      ${paper(1000, 108, 240, 176, -16, C.orange)}
      ${paper(1128, 292, 248, 178, 13, C.green)}
      ${paper(888, 404, 230, 166, 25, C.yellow)}
      ${motionLine(580, 450, 1028, 278, 16, C.orange, .86)}
      ${motionLine(560, 510, 1168, 382, 10, C.green, .82)}
      <path d="M858 398c114-84 268-144 430-184" stroke="${C.ink}" stroke-width="8" stroke-linecap="round" stroke-dasharray="22 26" opacity=".25"/>
      ${spark(1236, 252, 58, C.orange)}
      ${spark(1052, 396, 44, C.green)}
      <g transform="rotate(-16 958 392)">
        <ellipse cx="958" cy="392" rx="70" ry="50" fill="${C.orange}" stroke="${C.ink}" stroke-width="8"/>
        <path d="M904 376c36 25 76 27 118 4M904 408c39 20 80 19 120-4" stroke="${C.ink}" stroke-width="6" stroke-linecap="round" opacity=".45"/>
      </g>
      ${mascot({ x: 324, y: 152, width: 590, rotate: -6 })}
      ${tag(126, 116, C.paper, -3, 360)}
    `,
  },
  {
    file: "mascot-header-02-calendar-vault.svg",
    title: "Flying JobBored mascot vaults over calendar and follow-up busywork",
    fill: "#EAF9FF",
    body: `
      ${shadow(842, 632, 348, 34)}
      <path d="M252 542C450 288 792 260 1140 418" stroke="${C.ink}" stroke-width="10" stroke-linecap="round" stroke-dasharray="28 32" opacity=".24"/>
      ${calendar(150, 396, 220, 218, -8)}
      ${calendar(1138, 366, 232, 228, 9)}
      ${checkbox(220, 156, -5)}
      ${checkbox(1034, 146, 5, C.cream)}
      ${paper(1230, 114, 214, 154, -13, C.green)}
      ${spark(458, 316, 40, C.green)}
      ${spark(1086, 318, 46, C.orange)}
      ${motionLine(414, 450, 1030, 312, 11, C.green, .82)}
      ${mascot({ x: 500, y: 92, width: 630, rotate: 8, flip: true })}
      <g transform="rotate(8 690 384)">
        <path d="M664 422c-110 62-224 112-348 140" stroke="${C.orange}" stroke-width="14" stroke-linecap="round"/>
        <path d="M666 422c-88 20-140 14-200-7" stroke="${C.ink}" stroke-width="7" stroke-linecap="round" opacity=".36"/>
      </g>
      ${tag(112, 76, C.paper, 2, 300)}
    `,
  },
  {
    file: "mascot-header-03-ats-maze-smash.svg",
    title: "Flying JobBored mascot breaks through an ATS maze",
    fill: "#FFF8EC",
    body: `
      ${shadow(820, 638, 340, 36)}
      <g transform="translate(940 88)">
        <rect x="0" y="0" width="414" height="418" rx="28" fill="${C.paper}" stroke="${C.ink}" stroke-width="8"/>
        <path d="M62 70h288M62 140h106M230 140h120M62 210h74M196 210h154M62 280h164M284 280h66M62 350h288M70 64v292M140 64v86M140 210v146M210 64v292M280 64v156M280 280v76M350 64v292" stroke="${C.ink}" stroke-width="16" stroke-linecap="round" opacity=".2"/>
        <path d="M54 362C168 270 210 250 254 180c34-54 72-78 124-98" stroke="${C.orange}" stroke-width="18" stroke-linecap="round" fill="none"/>
        <path d="M308 116l80-66l-30 94l76 28l-104 24l-18 102l-44-84l-92 28l66-74l-56-70z" fill="${C.yellow}" stroke="${C.ink}" stroke-width="8" stroke-linejoin="round"/>
      </g>
      ${paper(152, 114, 260, 184, 9, C.green)}
      ${paper(232, 402, 238, 170, -12, C.orange)}
      ${tag(1140, 544, C.green, 3, 292)}
      ${spark(896, 258, 48, C.orange)}
      ${spark(1300, 184, 42, C.green)}
      ${motionLine(590, 434, 1052, 308, 15, C.orange, .84)}
      ${mascot({ x: 342, y: 152, width: 610, rotate: -4 })}
      <g transform="rotate(-18 940 392)">
        <rect x="832" y="356" width="204" height="66" rx="33" fill="${C.orange}" stroke="${C.ink}" stroke-width="8"/>
        <path d="M872 390h116" stroke="${C.ink}" stroke-width="7" stroke-linecap="round" opacity=".36"/>
      </g>
    `,
  },
  {
    file: "mascot-header-04-tab-tornado.svg",
    title: "Flying JobBored mascot clears a swarm of job-search tabs",
    fill: "#F1FFF9",
    body: `
      ${shadow(816, 634, 340, 36)}
      <path d="M244 486c198-190 482-310 830-210c144 42 242 116 304 210" fill="none" stroke="${C.ink}" stroke-width="10" stroke-linecap="round" stroke-dasharray="24 28" opacity=".22"/>
      ${browserCard(142, 122, 286, 166, -13)}
      ${browserCard(1030, 92, 306, 174, 10, C.sky)}
      ${browserCard(1146, 392, 276, 158, -8)}
      ${browserCard(232, 410, 276, 158, 8, C.cream)}
      ${browserCard(634, 74, 276, 154, -2)}
      ${tag(1022, 558, C.orange, -4, 300)}
      ${spark(504, 290, 42, C.green)}
      ${spark(1162, 312, 48, C.orange)}
      ${motionLine(496, 454, 1038, 398, 11, C.green, .82)}
      ${motionLine(496, 386, 1112, 242, 8, C.orange, .78)}
      ${mascot({ x: 438, y: 154, width: 640, rotate: 4, flip: true })}
      <g transform="rotate(10 1008 422)">
        <path d="M932 384c78 22 122 56 154 112" stroke="${C.orange}" stroke-width="17" stroke-linecap="round"/>
        <path d="M1034 490l74-36l-26 92z" fill="${C.orange}" stroke="${C.ink}" stroke-width="8" stroke-linejoin="round"/>
      </g>
    `,
  },
  {
    file: "mascot-header-05-pipeline-clean-sweep.svg",
    title: "Flying JobBored mascot sweeps job-hunting clutter into a clean pipeline",
    fill: "#F8FBFF",
    body: `
      ${shadow(800, 642, 350, 36)}
      <g transform="translate(1010 132)">
        <rect x="0" y="0" width="338" height="410" rx="30" fill="${C.paper}" stroke="${C.ink}" stroke-width="8"/>
        <rect x="38" y="44" width="262" height="54" rx="15" fill="${C.green}" stroke="${C.ink}" stroke-width="6"/>
        <rect x="38" y="130" width="262" height="54" rx="15" fill="${C.sky}" stroke="${C.ink}" stroke-width="6"/>
        <rect x="38" y="216" width="262" height="54" rx="15" fill="${C.cream}" stroke="${C.ink}" stroke-width="6"/>
        <rect x="38" y="302" width="262" height="54" rx="15" fill="${C.orange}" stroke="${C.ink}" stroke-width="6"/>
        <circle cx="72" cy="70" r="12" fill="${C.paper}" opacity=".75"/>
        <circle cx="72" cy="156" r="12" fill="${C.green}" opacity=".75"/>
        <circle cx="72" cy="242" r="12" fill="${C.orange}" opacity=".75"/>
        <circle cx="72" cy="328" r="12" fill="${C.paper}" opacity=".75"/>
        <path d="M112 70h144M112 156h120M112 242h150M112 328h110" stroke="${C.ink}" stroke-width="10" stroke-linecap="round" opacity=".35"/>
      </g>
      ${paper(150, 124, 248, 176, -10, C.orange)}
      ${paper(226, 424, 236, 166, 13, C.green)}
      ${tag(122, 330, C.green, -4, 326)}
      <path d="M434 552c174 70 356 78 578 6" fill="none" stroke="${C.orange}" stroke-width="20" stroke-linecap="round"/>
      <path d="M458 522c184 56 338 62 520 8" fill="none" stroke="${C.ink}" stroke-width="8" stroke-linecap="round" opacity=".24"/>
      ${motionLine(560, 476, 984, 366, 10, C.green, .8)}
      ${spark(426, 310, 38, C.orange)}
      ${spark(946, 250, 48, C.green)}
      ${mascot({ x: 354, y: 154, width: 630, rotate: -2 })}
      <g transform="rotate(-14 938 476)">
        <path d="M800 444h292" stroke="${C.ink}" stroke-width="17" stroke-linecap="round"/>
        <rect x="1074" y="404" width="58" height="116" rx="15" fill="${C.orange}" stroke="${C.ink}" stroke-width="8"/>
        <path d="M1102 394v138" stroke="${C.ink}" stroke-width="6" stroke-linecap="round" opacity=".24"/>
      </g>
    `,
  },
];

mkdirSync(outDir, { recursive: true });

for (const variant of variants) {
  const target = path.join(outDir, variant.file);
  writeFileSync(target, svgDoc(variant.file.replace(/\.svg$/, ""), variant.title, variant.body, variant.fill));
  console.log(path.relative(rootDir, target));
}
