# Curated Markdown corpus

`curated-documents.json` is a versioned, reviewed corpus of 100 original multi-block documents constrained to Markora's published supported dialect. It contains ten examples in each of ten common embedded-editor categories: ADRs, API documentation, changelogs, checklists, incident reports, meeting notes, product specifications, READMEs, runbooks, and tutorials.

Every document must satisfy semantic `parse -> serialize -> parse` stability and canonical serialization idempotence. Corpus records are intentionally original test data rather than copied documentation, and their slugs make a failing document immediately identifiable.
