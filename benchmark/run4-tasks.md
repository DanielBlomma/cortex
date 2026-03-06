# Benchmark Run 4 — Deep Code Comprehension

## Tasks

### T4-01: Explain JourneyKey
What is a JourneyKey? How is it constructed? Where is it used? Are there inconsistencies in its format across the codebase?

### T4-02: Trace a cancellation
A bus journey was cancelled. Trace exactly what happens in the code — from detection to how it appears in the report.

### T4-03: GID parsing
Multiple classes parse GID strings using substring operations. Document all GID formats used, what each substring position means, and whether they're consistent.

### T4-04: Subscription lifecycle
Walk through the complete lifecycle of a Subscription — from database loading to report generation to marking as sent. What state transitions occur?

### T4-05: Customer customization deep dive
Compare the Skånetrafiken variant with the core implementation. List every difference, explain why each might exist, and assess the risk of each divergence.

### T4-06: Report data aggregation
How does ReportRepository aggregate data? What calculations are performed? Trace the math from raw SQL data to final report numbers.

### T4-07: Email construction
How is a report email assembled? Trace from data to final SMTP send — including subject line, body, attachments, and recipient list construction.

### T4-08: Monitoring and observability
Analyze the Monitoring class and all performance counters. What metrics are tracked? What's missing? How would you use these in production?
