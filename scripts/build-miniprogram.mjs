import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
mkdirSync("wechat/miniprogram/utils", { recursive: true });
const source = readFileSync("lib/core.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
writeFileSync(
  "wechat/miniprogram/utils/core.js",
  "// Generated from lib/core.ts by npm run mini:build. Do not edit.\n" +
    compiled,
);
console.log("Shared calculation module generated for WeChat.");
