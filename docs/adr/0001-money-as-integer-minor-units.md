# Money as integer minor units

All money in the system is an integer amount in minor units (e.g. cents) paired with an ISO-4217 currency code, never a floating-point number. Floating-point money silently corrupts tax and refund arithmetic, so amounts are summed and split in the integer domain and converted to decimals only at the API boundary.
