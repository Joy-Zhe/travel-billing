import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const root = "wechat/miniprogram",
  app = JSON.parse(readFileSync(join(root, "app.json"), "utf8"));
const failures = [];
const nativeTags = new Set([
  "view",
  "text",
  "button",
  "input",
  "picker",
  "block",
  "label",
  "checkbox-group",
  "checkbox",
  "scroll-view",
  "image",
  "navigator",
  "switch",
  "textarea",
  "form",
  "radio-group",
  "radio",
  "template",
  "import",
  "include",
]);
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() && e.name !== "node_modules"
      ? walk(join(dir, e.name))
      : e.isFile()
        ? [join(dir, e.name)]
        : [],
  );
}
for (const page of app.pages)
  for (const ext of ["js", "json", "wxml", "wxss"])
    if (!existsSync(join(root, page + "." + ext)))
      failures.push("missing: " + page + "." + ext);
for (const file of walk("wechat")) {
  if (file.endsWith(".json"))
    try {
      JSON.parse(readFileSync(file, "utf8"));
    } catch {
      failures.push("invalid JSON: " + file);
    }
  if (file.endsWith(".js")) {
    const r = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (r.status !== 0) failures.push(file + ": " + r.stderr);
  }
  if (file.endsWith(".wxml")) {
    const text = readFileSync(file, "utf8");
    const stack = [];
    for (const tag of text.matchAll(
      /<\/?([A-Za-z][\w-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*\/?\s*>/g,
    )) {
      const name = tag[1];
      if (!nativeTags.has(name))
        failures.push("unknown component: " + name + " in " + file);
      if (tag[0].startsWith("</")) {
        if (stack.pop() !== name)
          failures.push("unbalanced component: " + file);
      } else if (!/\/\s*>$/.test(tag[0])) stack.push(name);
    }
    if (stack.length) failures.push("unclosed components: " + file);
    if ((text.match(/{{/g) || []).length !== (text.match(/}}/g) || []).length)
      failures.push("unbalanced template expression: " + file);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Mini program check passed: ${app.pages.length} pages, configuration, JS syntax and native component structure. This does not replace compilation in WeChat DevTools.`,
  );
