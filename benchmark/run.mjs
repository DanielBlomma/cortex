#!/usr/bin/env node

/**
 * Cortex Benchmark Runner
 * 
 * Runs ground-truth tasks against a codebase with and without Cortex context,
 * uses LLM-as-judge to score answers, and generates a report.
 * 
 * Usage:
 *   node benchmark/run.mjs --repo <path> [--tasks arch-overview,data-flow] [--runs 3] [--threshold 70]
 * 
 * CI usage:
 *   node benchmark/run.mjs --repo . --ci --threshold 75
 *   (exits with code 1 if average with-cortex score < threshold%)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---
const DEFAULT_MODEL = process.env.BENCH_MODEL || 'claude-sonnet-4-20250514';
const JUDGE_MODEL = process.env.BENCH_JUDGE_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEFAULT_RUNS = 1;
const DEFAULT_THRESHOLD = 70; // percent of max score

// --- Args ---
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repo: null,
    tasks: null,
    runs: DEFAULT_RUNS,
    threshold: DEFAULT_THRESHOLD,
    ci: false,
    outputDir: join(__dirname, 'results'),
    groundTruth: join(__dirname, 'ground-truth.json'),
    withCortexOnly: false,
    verbose: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--repo': opts.repo = args[++i]; break;
      case '--tasks': opts.tasks = args[++i]?.split(','); break;
      case '--runs': opts.runs = parseInt(args[++i]); break;
      case '--threshold': opts.threshold = parseInt(args[++i]); break;
      case '--ci': opts.ci = true; break;
      case '--output': opts.outputDir = args[++i]; break;
      case '--ground-truth': opts.groundTruth = args[++i]; break;
      case '--with-cortex-only': opts.withCortexOnly = true; break;
      case '--verbose': opts.verbose = true; break;
      case '--help':
        console.log(`
Cortex Benchmark Runner

Usage: node benchmark/run.mjs --repo <path> [options]

Options:
  --repo <path>           Path to repo with Cortex context (required)
  --tasks <ids>           Comma-separated task IDs to run (default: all)
  --runs <n>              Number of runs (default: ${DEFAULT_RUNS})
  --threshold <pct>       Minimum score % for CI pass (default: ${DEFAULT_THRESHOLD})
  --ci                    CI mode: exit 1 if below threshold
  --with-cortex-only      Skip no-cortex baseline (faster CI)
  --output <dir>          Output directory (default: benchmark/results)
  --ground-truth <path>   Path to ground-truth.json
  --verbose               Show full responses
  --help                  This help
        `);
        process.exit(0);
    }
  }
  
  if (!opts.repo) {
    console.error('Error: --repo is required');
    process.exit(1);
  }
  
  return opts;
}

// --- Anthropic API ---
async function callClaude(messages, model = DEFAULT_MODEL) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages,
    }),
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  
  const data = await res.json();
  return data.content[0]?.text || '';
}

// --- Cortex Context ---
function getCortexContext(repoPath, question) {
  try {
    // Try MCP query via cortex CLI
    const cortexBin = join(repoPath, 'bin', 'cortex.mjs');
    if (existsSync(cortexBin)) {
      const result = execSync(
        `node ${cortexBin} query "${question.replace(/"/g, '\\"')}"`,
        { cwd: repoPath, timeout: 30000, encoding: 'utf-8' }
      );
      return result.trim();
    }
    
    // Fallback: try cortex MCP server search
    const result = execSync(
      `mcporter call cortex search query="${question.replace(/"/g, '\\"')}" 2>/dev/null`,
      { cwd: repoPath, timeout: 30000, encoding: 'utf-8' }
    );
    return result.trim();
  } catch (e) {
    console.warn(`  ⚠️  Could not get Cortex context: ${e.message}`);
    return null;
  }
}

// --- Task Runner ---
async function runTask(task, cortexContext, withCortex) {
  const systemPrompt = `You are an expert code analyst. Answer the question about the codebase thoroughly and precisely. 
Focus on specific file names, class names, function names, and concrete details.
Do NOT make up or hallucinate details you don't know.`;

  const userMessage = withCortex && cortexContext
    ? `Here is context from the codebase knowledge graph:\n\n${cortexContext}\n\n---\n\nQuestion: ${task.question}`
    : `Question about a VB.NET codebase: ${task.question}\n\nNote: You only have the question — no source code or context is provided. Answer as best you can from general knowledge.`;

  const response = await callClaude([
    { role: 'user', content: userMessage }
  ]);

  return response;
}

// --- Judge ---
async function judgeResponse(task, response) {
  const gt = task.groundTruth;
  
  const judgePrompt = `You are a benchmark judge. Score the following response against the ground truth.

## Task
Question: ${task.question}
Category: ${task.category}

## Ground Truth
Must mention (key facts the answer should include):
${gt.mustMention.map((m, i) => `${i + 1}. ${m}`).join('\n')}

Must NOT mention (incorrect claims):
${gt.mustNotMention.length > 0 ? gt.mustNotMention.map((m, i) => `${i + 1}. ${m}`).join('\n') : '(none)'}

Key insight: ${gt.keyInsight}

## Response to Judge
${response}

## Scoring
Score 1-5:
- 1: Mostly wrong or generic, misses nearly all ground truth
- 2: Some relevant points but misses most specifics, may hallucinate
- 3: Covers ~50% of ground truth, some specifics correct
- 4: Covers most ground truth, good specifics, minor gaps
- 5: Covers all ground truth, correct specifics, captures key insight

Respond with ONLY a JSON object:
{
  "score": <1-5>,
  "mentionedFacts": [<indices of mustMention items found, 1-based>],
  "incorrectClaims": [<indices of mustNotMention items found, 1-based>],
  "capturedKeyInsight": <true/false>,
  "reasoning": "<brief explanation>"
}`;

  const result = await callClaude([
    { role: 'user', content: judgePrompt }
  ], JUDGE_MODEL);

  try {
    // Extract JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn(`  ⚠️  Judge parse error: ${e.message}`);
  }
  
  return { score: 0, reasoning: 'Failed to parse judge response', mentionedFacts: [], incorrectClaims: [], capturedKeyInsight: false };
}

// --- Report ---
function generateReport(results, opts) {
  const timestamp = new Date().toISOString().split('T')[0];
  let md = `# Cortex Benchmark Report\n`;
  md += `**Date:** ${timestamp}  \n`;
  md += `**Model:** ${DEFAULT_MODEL}  \n`;
  md += `**Judge:** ${JUDGE_MODEL}  \n`;
  md += `**Runs:** ${opts.runs}  \n\n`;

  // Summary table
  md += `## Summary\n\n`;
  md += `| # | Task | Category |${opts.withCortexOnly ? '' : ' No Cortex |'} With Cortex | ${opts.withCortexOnly ? '' : 'Delta |'} Key Insight |\n`;
  md += `|---|------|----------|${opts.withCortexOnly ? '' : '-----------|'} ----------- | ${opts.withCortexOnly ? '' : '-------|'} ----------- |\n`;

  let totalWithout = 0;
  let totalWith = 0;
  let insightCount = 0;

  for (const r of results) {
    const withScore = (r.withCortex.reduce((s, j) => s + j.score, 0) / r.withCortex.length).toFixed(1);
    const withInsight = r.withCortex.some(j => j.capturedKeyInsight) ? '✅' : '❌';
    
    if (!opts.withCortexOnly) {
      const withoutScore = (r.withoutCortex.reduce((s, j) => s + j.score, 0) / r.withoutCortex.length).toFixed(1);
      const delta = (parseFloat(withScore) - parseFloat(withoutScore)).toFixed(1);
      md += `| ${r.task.id} | ${r.task.question.substring(0, 40)}... | ${r.task.category} | ${withoutScore} | ${withScore} | +${delta} | ${withInsight} |\n`;
      totalWithout += parseFloat(withoutScore);
    } else {
      md += `| ${r.task.id} | ${r.task.question.substring(0, 40)}... | ${r.task.category} | ${withScore} | ${withInsight} |\n`;
    }
    
    totalWith += parseFloat(withScore);
    if (r.withCortex.some(j => j.capturedKeyInsight)) insightCount++;
  }

  const maxScore = results.length * 5;
  const pctWith = ((totalWith / maxScore) * 100).toFixed(1);
  
  md += `\n**With Cortex:** ${totalWith.toFixed(1)}/${maxScore} (${pctWith}%)  \n`;
  if (!opts.withCortexOnly) {
    const pctWithout = ((totalWithout / maxScore) * 100).toFixed(1);
    md += `**Without Cortex:** ${totalWithout.toFixed(1)}/${maxScore} (${pctWithout}%)  \n`;
    md += `**Improvement:** +${(totalWith - totalWithout).toFixed(1)} (+${(((totalWith - totalWithout) / totalWithout) * 100).toFixed(0)}%)  \n`;
  }
  md += `**Key Insights Captured:** ${insightCount}/${results.length}  \n`;
  md += `**Threshold:** ${opts.threshold}% — ${parseFloat(pctWith) >= opts.threshold ? '✅ PASS' : '❌ FAIL'}  \n`;

  // Detail per task
  md += `\n## Task Details\n\n`;
  for (const r of results) {
    md += `### ${r.task.id}: ${r.task.category}\n`;
    md += `**Q:** ${r.task.question}\n\n`;
    for (let i = 0; i < r.withCortex.length; i++) {
      const j = r.withCortex[i];
      md += `**Run ${i + 1} (with Cortex):** Score ${j.score}/5 — ${j.reasoning}\n`;
      md += `- Facts mentioned: ${j.mentionedFacts.length}/${r.task.groundTruth.mustMention.length}\n`;
      md += `- Key insight: ${j.capturedKeyInsight ? '✅' : '❌'}\n\n`;
    }
  }

  return { markdown: md, score: parseFloat(pctWith), pass: parseFloat(pctWith) >= opts.threshold };
}

// --- Main ---
async function main() {
  const opts = parseArgs();
  
  console.log('🧪 Cortex Benchmark Runner');
  console.log(`   Repo: ${opts.repo}`);
  console.log(`   Model: ${DEFAULT_MODEL}`);
  console.log(`   Runs: ${opts.runs}`);
  console.log(`   Threshold: ${opts.threshold}%`);
  console.log('');

  // Load ground truth
  const gt = JSON.parse(readFileSync(opts.groundTruth, 'utf-8'));
  let tasks = gt.tasks;
  
  if (opts.tasks) {
    tasks = tasks.filter(t => opts.tasks.includes(t.id));
  }
  
  console.log(`📋 Running ${tasks.length} tasks × ${opts.runs} runs\n`);

  const results = [];

  for (const task of tasks) {
    console.log(`🔍 ${task.id}: ${task.category}`);
    const result = { task, withCortex: [], withoutCortex: [] };

    // Get Cortex context once per task
    const cortexContext = getCortexContext(opts.repo, task.question);
    
    for (let run = 0; run < opts.runs; run++) {
      // With Cortex
      console.log(`   Run ${run + 1}/${opts.runs} — with Cortex...`);
      const withResp = await runTask(task, cortexContext, true);
      const withJudge = await judgeResponse(task, withResp);
      result.withCortex.push(withJudge);
      console.log(`   → Score: ${withJudge.score}/5 ${withJudge.capturedKeyInsight ? '💡' : ''}`);
      
      if (opts.verbose) {
        console.log(`   Response: ${withResp.substring(0, 200)}...`);
      }

      // Without Cortex (skip in CI fast mode)
      if (!opts.withCortexOnly) {
        console.log(`   Run ${run + 1}/${opts.runs} — without Cortex...`);
        const withoutResp = await runTask(task, null, false);
        const withoutJudge = await judgeResponse(task, withoutResp);
        result.withoutCortex.push(withoutJudge);
        console.log(`   → Score: ${withoutJudge.score}/5`);
      }
    }
    
    results.push(result);
    console.log('');
  }

  // Generate report
  const { markdown, score, pass } = generateReport(results, opts);

  // Save results
  mkdirSync(opts.outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(opts.outputDir, `benchmark-${timestamp}.md`);
  const jsonPath = join(opts.outputDir, `benchmark-${timestamp}.json`);
  
  writeFileSync(reportPath, markdown);
  writeFileSync(jsonPath, JSON.stringify({ opts, results, score, pass }, null, 2));

  console.log(`📊 Score: ${score}% ${pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`📄 Report: ${reportPath}`);
  
  if (opts.ci && !pass) {
    console.error(`\n❌ Benchmark FAILED: ${score}% < ${opts.threshold}% threshold`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
