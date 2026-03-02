# We Benchmarked Our Context Engine on a 20k LOC VB.NET Legacy Service — Here's What Happened

*40 tasks. 5 categories. One question: does structured context actually make AI code assistants better?*

---

Everyone building AI coding tools talks about "context." RAG this, embeddings that, knowledge graphs everywhere. But how much does it actually matter?

We decided to find out. Not with a toy example or a clean Next.js repo — with a real, ugly, 20-year-old VB.NET Windows Service that nobody wants to touch.

## The Setup

**The codebase:** A 20k LOC VB.NET legacy service that processes data and generates reports for enterprise customers. 85 VB files, 29 SQL files, customer-specific code forks, SQL queries embedded in resource files, and string-based ID parsing duplicated across 6+ classes. The kind of codebase where tribal knowledge lives in one person's head.

**The tool:** [Cortex](https://github.com/DanielBlomma/cortex) — an open-source, repo-local context engine that indexes your code into a knowledge graph with semantic embeddings. It gives AI assistants structured access to entities, relationships, and ranked search results instead of raw file dumps.

**The method:**
- 40 tasks across 5 categories (architecture, security, features, comprehension, real-world scenarios)
- Each task scored 1–5 for both conditions: **without Cortex** (model sees file listings + fits what it can in context) and **with Cortex** (model has full graph, semantic search, trust-ranked entities)
- Same model, same codebase, same scoring rubric

We weren't testing whether an AI can code. We were testing whether it can *understand* code it's never seen before.

## The Results

| Category | Without Cortex | With Cortex | Improvement |
|----------|---------------|-------------|-------------|
| Baseline (architecture, bugs, refactoring) | 18/40 | 36/40 | +100% |
| Security & Error Handling | 17/40 | 36/40 | +112% |
| Feature Implementation | 19/40 | 35/40 | +84% |
| Deep Code Comprehension | 12/40 | 38/40 | +217% |
| Real-World Scenarios | 15/40 | 36/40 | +140% |
| **Total** | **81/200** | **181/200** | **+123%** |

The headline number: **+123% improvement across all tasks.**

But the headline doesn't tell the real story. Let's dig in.

## Where Context Matters Most (And Where It Doesn't)

### 🔴 Deep Comprehension: +217%

This is where Cortex demolished the baseline. Tasks like:

- **"Trace what happens when a record is cancelled"** — requires following data through 5+ classes, understanding how a SQL flag becomes a red row in an HTML email
- **"Document all ID parsing formats and find inconsistencies"** — the codebase parses 16-character GID strings using `Substring(7, 4)` in 6+ different classes, with subtle format differences between customer variants
- **"Compare the customer-specific fork with the core implementation"** — the `Custom/` directory contains complete code forks with different ID formats, different thresholds, different error handling, and even different logging frameworks

Without structured context, the model scored an average of **1.5/5** on these tasks. It couldn't fit enough files in context to see the patterns, so it either guessed or hallucinated connections that didn't exist.

With Cortex, the graph immediately surfaces: "this entity is referenced by these 6 classes, and here's how each one handles it differently." Average score: **4.75/5**.

**The killer finding:** The codebase had an ID format inconsistency between the core service (4-part composite key) and a customer fork (3-part composite key). This means cross-component lookups would **silently fail** if the systems were mixed. No model found this without Cortex. Every model found it with Cortex.

### 🟡 Security & Error Handling: +112%

The codebase has 40+ catch blocks with wildly inconsistent behavior — some log and continue, some silently swallow exceptions, some write to a file and terminate the process. SQL queries are constructed via string replacement (`sql.Replace("FilterDate", date.ToString)`) in 6+ locations across both the main service and customer forks.

Without Cortex, a model finds 2–3 instances of each pattern. With Cortex, it maps all 6+ SQL injection points, all 40+ catch blocks (categorized by behavior), and the fact that customer forks use `Console.WriteLine` instead of the logging framework — meaning errors in production would go to `/dev/null`.

### 🟢 Feature Implementation: +84%

This was the smallest improvement, and that's expected. Tasks like "add email retry logic" or "add PDF export" are generic enough that a model's general knowledge gets you 60% of the way there.

But even here, Cortex made a difference on architecture-dependent features:
- **"Add support for custom report schedules"** — requires understanding the full scheduling chain from timer tick through subscription filtering to report generation. Without Cortex, the model modified the wrong class.
- **"Support multiple database connections per customer"** — requires mapping all 12+ locations where `ConnectionString` is used. Without Cortex, the model found 3.

## The Numbers

| Metric | Without Cortex | With Cortex |
|--------|---------------|-------------|
| Mean score (per task) | 2.03 | 4.53 |
| Median score | 2.0 | 5.0 |
| Tasks scoring ≤ 2 | 80% | 0% |
| Tasks scoring ≥ 4 | 0% | 100% |
| Hallucinated facts | 12+ | 0 |

That last row matters. Without Cortex, the model invented a "database abstraction layer" that doesn't exist, referenced configuration settings that aren't in the codebase, and described class relationships that were backwards. With Cortex, every claim maps to actual code.

## What This Means

### Context isn't optional — it's the difference between useful and useless

On a 20k LOC legacy codebase, the model without Cortex scored 40.5%. That's an F. Not because the model is bad — it's because **the task is impossible without access to the full codebase graph**. No model, regardless of size, can trace a data flow through 5 classes if it can only see 2 of them.

### The gap widens with complexity

Simple tasks (localized changes, generic advice) showed +1 to +2 point improvements. Complex tasks (cross-file tracing, variant comparison, production debugging) showed +3 to +4. On a 100k+ LOC codebase where context window limits force even more truncation, we'd expect the gap to widen further.

### Hallucination elimination is the sleeper benefit

Developers can handle incomplete answers — they'll go find the rest. What they can't handle is **confidently wrong** answers. A model that says "the database layer handles connection pooling" when no such layer exists will send you debugging a phantom. Cortex eliminated this entirely by grounding every response in verified code entities.

### Code forks are the ultimate stress test

If your codebase has customer-specific variants, configuration-driven behavior, or any form of polymorphism-by-directory, you need structured context. No amount of "read more files" helps when the insight comes from *comparing* implementations across forks.

## How Cortex Works (The Short Version)

Cortex builds a local knowledge graph from your repository:

1. **Ingest** — scans code, docs, ADRs, rules into typed entities
2. **Embed** — generates semantic vectors for similarity search
3. **Graph** — maps relationships (file→imports→file, rule→constrains→code)
4. **Rank** — multi-signal scoring: `semantic × 0.60 + graph × 0.10 + trust × 0.15 + recency × 0.15`

When a coding assistant queries Cortex via MCP, it gets ranked, relevant context instead of raw file dumps. The trust score means an Architecture Decision Record outranks a random code comment. The graph score means a file imported by 10 others outranks an orphan.

The key insight: **ranking is more important than retrieval.** Finding relevant files is easy. Knowing which ones matter most is hard.

## Try It Yourself

```bash
npm i -g github:DanielBlomma/cortex
cd your-legacy-repo
cortex init --bootstrap
cortex status
```

Then ask your AI assistant the hardest question you have about your codebase. Compare the answer with and without Cortex connected.

We bet you'll see the difference on the first question.

---

*Benchmark conducted on a 20k LOC VB.NET legacy service with 85 source files and customer-specific code forks. Full methodology and per-task scoring available on request.*

*[Cortex](https://github.com/DanielBlomma/cortex) is open source. Star it if you find it useful.*

*Built by [Black Valley Labs](https://blackvalleylabs.com)*
