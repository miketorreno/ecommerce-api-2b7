# Provider webhooks are the source of truth for payment state

Payment state comes only from the payment provider's signed webhooks. API responses to the customer are provisional until a webhook confirms the movement of funds, and funds are authorized at checkout but captured on fulfillment. Reliance on API responses alone makes double-charges and phantom-payment states too easy to ship. Stripe is the launch provider, behind a provider-agnostic adapter so the domain never imports PSP types.
