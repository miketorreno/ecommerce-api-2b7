# E-commerce

The public API for an online store: customers browse a catalog, build a cart, place and pay for orders, and track fulfillment of physical shipments to their door.

## Language

### Catalog

**Product**:
A thing offered for sale, described once and shared across every way it can be bought.
_Avoid_: item, article

**Variant**:
A concretely sellable instance of a Product, defined by a Product plus specific options. Variants carry their own Price, Stock, and SKU.
_Avoid_: option, SKU, configuration

**Catalog**:
The published set of Products and Variants customers can actually buy.
_Avoid_: storefront, shop

**Price**:
The advertised selling amount of a Variant — always a Money value.
_Avoid_: cost, fee, rate

**Stock**:
The number of units of a Variant physically on hand.
_Avoid_: inventory, quantity

**Availability**:
The number of units of a Variant still sellable: Stock minus outstanding Reservations.
_Avoid_: in-stock, free stock

**Reservation**:
A temporary hold on Availability for a checkout that has not yet become an Order. Reservations expire and release the held Stock.
_Avoid_: hold, lock

### Customers & buying

**Customer**:
A person or organization that places Orders. Buyers may check out as guests or as registered Users.
_Avoid_: buyer, client, shopper

**User**:
A person with login credentials who can manage their own account. A registered buyer is both a User and a Customer; a guest is a Customer only.
_Avoid_: account, member, profile

**Cart**:
A customer's set of intended purchases, built before checkout. Carts are ephemeral and discardable.
_Avoid_: basket, bag

**Address**:
A physical location pinned to an Order or repeatable for a Customer, used for billing or shipping.
_Avoid_: location

**Order**:
A customer's agreement to buy a set of Variants — the commercial unit that is paid for and fulfilled.
_Avoid_: purchase, transaction, sale

**Order Line**:
A single grouping inside an Order naming a Variant, quantity, unit Price, and Discounts.
_Avoid_: line item, entry

**Discount**:
A reduction applied to an Order or Order Line.
_Avoid_: coupon, promo, voucher, offer

### Money & payment

**Money**:
A value made of an amount in integer minor units plus an ISO-4217 Currency code.
_Avoid_: total, charge

**Currency**:
An ISO-4217 three-letter currency code.
_Avoid_: money, coin

**Payment Intent**:
A request sent to the payment provider that has not yet been confirmed.
_Avoid_: payment request, authorization

**Payment**:
A completed transfer of funds for an Order, recorded only from the provider's confirmation.
_Avoid_: charge, transaction, chargeback

**Refund**:
Funds returned from a Payment, in full or in part, following cancellation or Return.
_Avoid_: reversal, chargeback, credit

### Fulfillment

**Shipment**:
A physical dispatch of fulfilled Order lines to a shipping Address, carrying its own tracking.
_Avoid_: delivery, parcel, consignment

**Fulfillment**:
The work of preparing an Order's lines for dispatch.
_Avoid_: logistics, warehousing, picking

**Return**:
Goods sent back to the seller, after which a full or partial Refund is issued.
_Avoid_: reversal, send-back
