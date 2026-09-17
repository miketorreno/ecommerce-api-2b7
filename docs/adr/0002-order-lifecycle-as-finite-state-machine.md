# Order lifecycle as a finite state machine

Orders move through an explicit state machine — placed → confirmed → paid → fulfilled → shipped → delivered — with cancellation reachable along the way. Cancellation and Returns are compensating transitions that trigger refunds. Illegal transitions are rejected outright; the FSM makes the lifecycle auditable, testable, and safe to replay from provider webhooks.
