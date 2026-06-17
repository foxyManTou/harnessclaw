### Fixed

- Telemetry reporting now signs event uploads with the server-compatible HMAC headers, restoring delivery to the production telemetry endpoint.
- Generated image links in assistant replies now render local `file://` and absolute-path outputs through HarnessClaw's safe local file protocol instead of showing broken previews.
- Browser Agent sessions now run in a dedicated helper process with isolated CDP targets, preventing commands from taking over the main HarnessClaw window or another browser session.
