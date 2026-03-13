# Benchmark Run 2 — Security & Error Handling Focus

## Tasks

### T2-01: Security audit
Perform a security audit of this codebase. Identify SQL injection risks, credential handling issues, input validation gaps, and any hardcoded secrets.

### T2-02: Error handling review
Review all error handling patterns. Which exceptions are swallowed silently? Where could unhandled exceptions crash the service? Rate the overall error handling maturity.

### T2-03: Connection management
Analyze how database connections are managed. Are there connection leaks? Is connection pooling used correctly? What happens under high load?

### T2-04: Configuration analysis
How is the application configured? What settings exist, how are they loaded, and what happens if a setting is missing or invalid?

### T2-05: Logging analysis
Evaluate the logging strategy. What is logged, what is missing, and how useful would the logs be for debugging a production incident?

### T2-06: Threading and concurrency
Is this service thread-safe? Identify any shared state, race conditions, or concurrency issues.

### T2-07: Memory management
Analyze memory usage patterns. Are there potential memory leaks? How are large datasets handled? What happens with a month of data vs a day?

### T2-08: Test coverage assessment
What would you need to test this codebase? Design a test strategy — what's testable as-is, what needs refactoring first?
