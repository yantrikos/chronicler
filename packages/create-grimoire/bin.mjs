#!/usr/bin/env node
// create-chronicler-grimoire — scaffold a new Chronicler Grimoire plugin.
//
//   npx create-chronicler-grimoire my-plugin
//
// Interactive prompts for the manifest fields, picks a template based on
// which surfaces the plugin will use, writes the scaffold to ./<name>/,
// runs npm install. From `npx ...` to "edit index.ts and install" should
// be under 60 seconds.

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function ask(question, defaultValue) {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || "";
}

async function askChoice(question, choices) {
  const list = choices.map((c, i) => `  ${i + 1}) ${c}`).join("\n");
  const answer = await rl.question(`${question}\n${list}\nChoice (1-${choices.length}): `);
  const idx = parseInt(answer.trim(), 10) - 1;
  if (idx < 0 || idx >= choices.length) {
    console.log("Invalid choice, defaulting to first option.");
    return choices[0];
  }
  return choices[idx];
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function copyTemplate(src, dest, replacements) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, applyReplacements(entry.name, replacements));
    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyTemplate(srcPath, destPath, replacements);
    } else {
      const content = await fs.readFile(srcPath, "utf8");
      await fs.writeFile(destPath, applyReplacements(content, replacements));
    }
  }
}

function applyReplacements(s, replacements) {
  let out = s;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const initialName = argv[0];

  console.log("\n⚗  create-chronicler-grimoire\n");

  const name = await ask("Plugin directory name", initialName ?? "my-grimoire");
  const targetDir = path.resolve(process.cwd(), name);
  if (existsSync(targetDir)) {
    console.error(`✗ Directory ${targetDir} already exists. Pick a different name.`);
    rl.close();
    process.exit(1);
  }

  const id = await ask("Plugin id (reverse-DNS)", `io.example.${slug(name)}`);
  const displayName = await ask("Display name", name.replace(/[-_]/g, " "));
  const description = await ask("One-line description", `${displayName} — a Chronicler Grimoire plugin`);
  const author = await ask("Author", "");
  const license = await ask("License", "MIT");

  const template = await askChoice("Pick a template", [
    "hook-only (afterChat observer)",
    "slash-command (with /command)",
    "ui-slot (inspector:tab React component)",
    "full (hook + slash + UI)",
  ]);
  const templateKey = template.split(" ")[0]; // hook-only / slash-command / ui-slot / full

  const replacements = {
    PLUGIN_ID: id,
    PLUGIN_NAME: displayName,
    PLUGIN_DESCRIPTION: description,
    PLUGIN_AUTHOR: author,
    PLUGIN_LICENSE: license,
  };

  console.log(`\nScaffolding ${targetDir}…`);
  await fs.mkdir(targetDir, { recursive: true });
  await copyTemplate(path.join(TEMPLATES_DIR, templateKey), targetDir, replacements);

  console.log(`✓ Scaffold written.\n`);
  console.log(`Next steps:`);
  console.log(`  cd ${name}`);
  console.log(`  npm install`);
  console.log(`  # edit index.ts`);
  console.log(`  cp -r . ~/.chronicler/plugins/${name}    # install locally`);
  console.log(`  # or push to github and use the Browse Grimoire UI to install via URL\n`);

  const install = (await ask("Run npm install now? (y/n)", "y")).toLowerCase();
  if (install === "y" || install === "yes") {
    await new Promise((resolve) => {
      const child = spawn("npm", ["install"], {
        cwd: targetDir,
        stdio: "inherit",
      });
      child.on("close", resolve);
    });
  }

  rl.close();
}

main().catch((e) => {
  console.error(e);
  rl.close();
  process.exit(1);
});
