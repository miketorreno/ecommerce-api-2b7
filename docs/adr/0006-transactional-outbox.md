# Transactional outbox for outbound events

Outbound events (provider webhooks, notifications) are written to an outbox table in the same transaction as the state change that announces them, then delivered at-least-once by a publisher job. This guarantees no event is emitted without its state change and no state change goes unannounced on partial failure.
