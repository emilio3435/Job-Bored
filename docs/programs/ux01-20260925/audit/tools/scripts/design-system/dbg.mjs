import {readFileSync} from "node:fs";
const s = readFileSync(process.argv[2],"utf8");
const i = s.indexOf("font-size: 11px;\n  letter-spacing: 0.22em");
console.log(JSON.stringify(s.slice(i-300,i+60)));
