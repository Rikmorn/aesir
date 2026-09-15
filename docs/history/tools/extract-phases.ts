#!/usr/bin/env bun
// Generates docs/history/phases.md from the archived roadmaps, the v2.9
// roadmap and the per-phase verification reports.
//   bun docs/history/tools/extract-phases.ts > docs/history/phases.md
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const archives = join(root, "docs", "history", "milestones");
const phasesDir = join(root, ".planning", "phases");

type Phase = { num: string; name: string; goal: string; plans: number; status: string; score: string; human: string[] };
type Milestone = { title: string; phases: Phase[] };

function parseRoadmap(text: string, milestoneTitle: string): Milestone {
  const phases: Phase[] = [];
  const blocks = text.split(/\n(?=#{3,4} Phase )/);
  for (const b of blocks) {
    // Phase ids are numeric ("84", "22.1") except v1's "e2e-verification"; goals are written
    // "**Goal**:" in most roadmaps and "**Goal:**" in v2.0's; plan counts are checkbox lines in
    // v2.9's roadmap and a "**Plans:** N plans" line in the archived ones. Heading depth is H3
    // except v2.7, which nests its phases as H4 under an H3 "### Phase Details" container.
    const h = b.match(/^#{3,4} Phase ([\w.-]+): (.+?)(?: — DEFERRED| -- DEFERRED)?\s*$/m);
    if (!h) continue;
    const goal = (b.match(/\*\*Goal:?\*\*:?\s*(.+)/) ?? [])[1]?.trim() ?? "";
    const checked = (b.match(/^- \[[ x]\] .*PLAN\.md/gm) ?? []).length;
    const declared = Number((b.match(/\*\*Plans:?\*\*:?\s*(\d+)/) ?? [])[1] ?? 0);
    const plans = checked || declared;
    const nameRaw = h[2].trim();
    const name = /DEFERRED/i.test(h[0]) && !/DEFERRED/i.test(nameRaw) ? `${nameRaw} (deferred)` : nameRaw;
    phases.push({ num: h[1], name, goal, plans, status: "", score: "", human: [] });
  }
  return { title: milestoneTitle, phases };
}

const milestones: Milestone[] = [];
for (const f of readdirSync(archives).filter((n) => /-ROADMAP\.md$/.test(n)).sort((a, b) => parseFloat(a.replace(/^v/, "")) - parseFloat(b.replace(/^v/, "")))) {
  const text = readFileSync(join(archives, f), "utf8");
  // Title is an H2 ("## v2.7 Agent Collaboration (Shipped ...)") in most archives. v1 and
  // v2.0-v2.6 instead carry it as an H1 ("# Milestone v2.3: Unified Agent Framework") with
  // "## Overview" as their first H2, so fall back to that before the bare filename.
  const h2Title = (text.match(/^## (v[\d.]+ .+?)(?: \(Shipped.*)?$/m) ?? [])[1];
  const h1 = text.match(/^# Milestone (v[\d.]+): (.+)$/m);
  const title = h2Title ?? (h1 ? `${h1[1]} ${h1[2]}` : f.replace("-ROADMAP.md", ""));
  milestones.push(parseRoadmap(text, title));
}
{
  const text = readFileSync(join(root, ".planning", "ROADMAP.md"), "utf8");
  const v29 = text.slice(text.indexOf("## v2.9"));
  milestones.push(parseRoadmap(v29, "v2.9 Platform Completion (executed 2026-02-20 → 2026-02-23, never archived)"));
}

// Resolves a phase's verification report on disk. Directories occasionally zero-pad a phase
// number's leading digit ("09.2-..." for phase "9.2"), and one (e2e-verification) has no
// trailing "-suffix" and holds a report whose filename doesn't match the phase number at all.
// Score every plausible directory by whether it actually contains a report, so an empty
// zero-padded duplicate (phase 9.1 has one, alongside the real "9.1-..." directory) can never
// be chosen over a directory with real content, regardless of directory-listing order.
function findReport(dirs: string[], num: string): { dir: string; file: string } | undefined {
  const candidates = dirs.filter((d) => d === num || d.startsWith(`${num}-`) || d.startsWith(`0${num}-`));
  for (const dir of candidates) {
    const dirPath = join(phasesDir, dir);
    const reports = (existsSync(dirPath) ? readdirSync(dirPath) : []).filter((f) => f.endsWith("-VERIFICATION.md"));
    const file = reports.includes(`${num}-VERIFICATION.md`) ? `${num}-VERIFICATION.md` : reports.length === 1 ? reports[0] : undefined;
    if (file) return { dir, file };
  }
  return undefined;
}

// Human-verification items appear as a numbered heading one level deeper than the section
// ("#### N." under "###", or "### N." under "##"), a numbered heading at the SAME depth as the
// section ("### N." under "### Human Verification Required"), bold-numbered text
// ("**N. Title**"), or a markdown table row ("| N | Test | Expected | Why Human |"). The
// section itself is "###" in most reports and "##" in a couple. Bound its body at the next
// heading of the same or shallower depth, skipping same-depth numbered-item headings so they
// don't end the section early. A body that says "None" (the reports' universal wording for
// "nothing outstanding") yields no lines; a non-empty body with no recognised item format
// yields one pointer line rather than silently vanishing, so a future format this extractor
// doesn't know about still surfaces instead of disappearing.
function extractHumanItems(v: string, sourcePath: string): string[] {
  const hv = v.match(/^(#{2,3}) Human Verification Required\s*$/m);
  if (!hv) return [];
  const rest = v.slice((hv.index ?? 0) + hv[0].length);
  const sectionDepth = hv[1].length;
  const headings = [...rest.matchAll(new RegExp(`^(#{1,${sectionDepth}}) (.*)$`, "gm"))];
  const boundary = headings.find((m) => !(m[1].length === sectionDepth && /^\d+\.\s/.test(m[2])));
  const body = boundary ? rest.slice(0, boundary.index) : rest;
  // "Nothing outstanding" is worded either "None ..." or "No human verification needed ...".
  if (/^\s*(none|no human verification)\b/i.test(body)) return [];

  const found = [
    ...[...body.matchAll(/^#{3,4} \d+\.\s*(.+)$/gm)].map((m) => ({ index: m.index ?? 0, text: m[1] })),
    ...[...body.matchAll(/^\*\*\d+\.\s*(.+?)\*\*\s*$/gm)].map((m) => ({ index: m.index ?? 0, text: m[1] })),
    ...[...body.matchAll(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => ({ index: m.index ?? 0, text: m[1] })),
  ].sort((a, b) => a.index - b.index);
  if (found.length) return found.map((m) => m.text.trim());

  return body.trim() ? [`items recorded in a format this index does not enumerate — see git show v2.9:${sourcePath}`] : [];
}

// verification reports
const dirs = existsSync(phasesDir) ? readdirSync(phasesDir) : [];
for (const m of milestones) for (const p of m.phases) {
  const report = findReport(dirs, p.num);
  if (!report) continue;
  const v = readFileSync(join(phasesDir, report.dir, report.file), "utf8");
  p.status = (v.match(/^status:\s*(.+)$/m) ?? [])[1] ?? "";
  p.score = (v.match(/^score:\s*(.+)$/m) ?? [])[1] ?? "";
  p.human = extractHumanItems(v, `.planning/phases/${report.dir}/${report.file}`);
}

const total = milestones.reduce((n, m) => n + m.phases.length, 0);
const out: string[] = [];
out.push("# Phases — v1 to v2.9");
out.push("");
out.push(`<!-- Generated by docs/history/tools/extract-phases.ts on ${new Date().toISOString().slice(0, 10)}: ${total} phases across ${milestones.length} milestones. Do not edit by hand. -->`);
out.push("");
out.push("One line per phase: what it set out to do, how many plans it took, and what the verification report concluded. Verification status is from each phase's `*-VERIFICATION.md` (`passed`, `gaps_found`, `human_needed`, or blank when no report exists). Human-verification items are the checks a person still has to do; they are tracked as Rikmorn/aesir#14.");
out.push("");
for (const m of milestones) {
  out.push(`## ${m.title}`);
  out.push("");
  out.push("| Phase | Name | Goal | Plans | Verification |");
  out.push("|---|---|---|---|---|");
  for (const p of m.phases) {
    const ver = p.status ? `${p.status}${p.score ? ` (${p.score})` : ""}` : "—";
    out.push(`| ${p.num} | ${p.name} | ${p.goal.replace(/\|/g, "\\|")} | ${p.plans} | ${ver} |`);
  }
  const withHuman = m.phases.filter((p) => p.human.length);
  if (withHuman.length) {
    out.push("");
    out.push("Human verification still open:");
    for (const p of withHuman) for (const h of p.human) out.push(`- Phase ${p.num}: ${h}`);
  }
  out.push("");
}
process.stdout.write(out.join("\n"));
