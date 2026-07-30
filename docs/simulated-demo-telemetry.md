# Simulated demo telemetry

The authenticated dashboard resolves an owned device, recovers its latest
sample through the existing telemetry API, and subscribes to the canonical
`telemetry.updated` organization event. Realtime events invalidate only the
telemetry query, so the REST API remains authoritative after reconnect/reload.

The dashboard shows six parameter cards, units, last update, connection state,
recent history, and the exact badge `Simulated demo data`. It contains no
"live ESP32" claim, raw identifier/event output, or invented alert threshold.
Signing out clears cached API data.
