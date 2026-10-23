# Open Knowledge Format notes

OKF represents a knowledge concept as Markdown with YAML frontmatter and links concepts into a graph. Use the current specification exposed by the client's knowledge system.

Useful metadata includes:

- stable concept ID and title;
- type or domain;
- owner and reviewers;
- lifecycle or approval state;
- provenance and evidence;
- effective, reviewed, or expiry dates;
- trust or verification information;
- links to related, superseding, prerequisite, or dependent concepts.

Retrieval should begin with an index or focused search, then follow only relevant links. Avoid copying the whole knowledge repository into every task.

Agent-created updates should remain draft until reviewed. Preserve provenance and distinguish observed fact, organization policy, operating procedure, historical example, and recommendation.

Specification: [Google Cloud Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md).
