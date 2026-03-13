# Benchmark Run 5 — Real-World Scenarios

## Tasks

### T5-01: Production incident
"Reports aren't being sent for one customer but others work fine." Debug this. What are the most likely causes and how would you investigate?

### T5-02: Performance degradation
"The service used to process reports in 5 minutes, now it takes 45 minutes." Where are the performance bottlenecks? What would you profile first?

### T5-03: New customer onboarding
A new transport authority wants to use the service. What's the complete onboarding process? What configuration is needed?

### T5-04: Data inconsistency
"The report shows 15 cancelled journeys but the customer says there were only 12." Where could the discrepancy come from?

### T5-05: Add a new customer variant
A customer needs custom logic for how "late departure" is calculated. Design the implementation — do you fork the code (like Old_Custom) or refactor?

### T5-06: Disaster recovery
The database server goes down mid-report generation. What happens to the service? Does it recover? Is data corrupted?

### T5-07: Scale assessment
Could this service handle 10x the current load (100 subscriptions instead of ~10)? What breaks first?

### T5-08: Code review
You're a senior developer reviewing a PR that adds a new block type. Based on existing patterns, write a code review checklist specific to this codebase.
