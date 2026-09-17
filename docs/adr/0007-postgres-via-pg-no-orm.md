# Postgres via pg + repositories, no ORM

Data access uses the `pg` driver behind a thin repository layer, with zod row schemas for validity and explicit migrations. No ORM was adopted: the codebase is plain JavaScript where an ORM's type-safety payoff is low, and raw SQL keeps transactions, locking, and the unit-of-work that orders, reservations, and the outbox share inside our control.
