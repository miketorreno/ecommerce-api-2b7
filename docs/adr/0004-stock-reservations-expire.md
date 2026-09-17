# Stock reservations expire

Availability is computed as Stock minus outstanding Reservations. Stock is reserved as soon as a Payment Intent is created, held as a Reservation with a TTL aligned to the intent's lifespan, and released on cancellation, expiry, or decremented when the Order is fulfilled and captured. Overselling is blocked at checkout: nothing is sold against Availability that isn't truly there. This keeps the same Stock from being sold twice while abandoned checkouts don't hold inventory forever.
