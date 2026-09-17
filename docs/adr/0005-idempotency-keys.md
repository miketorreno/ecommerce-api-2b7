# Idempotency keys for order creation and payment capture

Client-generated idempotency keys are required on order creation and payment capture so that retries (timeouts, network blips, double-submits) can never create two Orders or capture funds twice. Keys are enforced by unique constraints and a single stored response is replayed for a repeated key.
