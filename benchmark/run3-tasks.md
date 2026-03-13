# Benchmark Run 3 — Feature Implementation

## Tasks

### T3-01: Add email retry logic
The service sends emails but has no retry mechanism. Implement retry with exponential backoff. Show the exact code changes needed.

### T3-02: Add a new report type
A customer wants a "daily summary" report with just totals (no per-journey details). What files need changing and what's the minimal implementation?

### T3-03: Add PDF export
Currently supports HTML email and XLS attachment. Add PDF export. What's the approach and what libraries would you use?

### T3-04: Add a REST API health endpoint
The service runs as a Windows Service. Add an HTTP endpoint that returns service health (last report sent, error count, queue depth).

### T3-05: Support multiple database connections
Currently uses a single connection string. Modify to support different databases per customer/subscription.

### T3-06: Add journey route visualization
Given the route link data, generate a simple map visualization showing the journey route. What data is available and what's feasible?

### T3-07: Add report scheduling flexibility
Currently reports are daily/weekly/monthly. Add support for custom schedules (e.g., "every Tuesday and Thursday").

### T3-08: Internationalization
The service has some i18n support (CultureInfo). Assess completeness and add support for English reports alongside Swedish.
