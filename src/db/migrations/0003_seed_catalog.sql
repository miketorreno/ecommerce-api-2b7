INSERT INTO products (slug, name, description, category, created_at) VALUES
  (
    'wool-overcoat',
    'Wool Overcoat',
    'Tailored wool overcoat for cold-weather city wear.',
    'apparel',
    now() - interval '1 hour'
  ),
  (
    'wireless-mechanical-keyboard',
    'Wireless Mechanical Keyboard',
    'Hot-swappable low-profile mechanical keyboard that connects over Bluetooth.',
    'electronics',
    now() - interval '2 hours'
  ),
  (
    'bamboo-cutting-board',
    'Bamboo Cutting Board',
    'End-grain bamboo board with a juice groove.',
    'home',
    now() - interval '3 hours'
  ),
  (
    'ceramic-espresso-cup',
    'Ceramic Espresso Cup',
    'Two-tone ceramic cup sized for a double shot of espresso.',
    'home',
    now() - interval '4 hours'
  ),
  (
    'everyday-canvas-tote',
    'Everyday Canvas Tote',
    'Roomy tote in heavy cotton canvas.',
    'apparel',
    now() - interval '5 hours'
  ),
  (
    'alpine-flannel-shirt',
    'Alpine Flannel Shirt',
    'Warm brushed-cotton flannel with a classic collar.',
    'apparel',
    now() - interval '6 hours'
  );

INSERT INTO variants (product_id, sku, name, price_amount, price_currency) VALUES
  ((SELECT id FROM products WHERE slug = 'wool-overcoat'), 'OVCT-M', 'Medium', 24900, 'USD'),
  ((SELECT id FROM products WHERE slug = 'wool-overcoat'), 'OVCT-L', 'Large', 24900, 'USD'),
  ((SELECT id FROM products WHERE slug = 'wireless-mechanical-keyboard'), 'KBD-LIN', 'Linear', 8999, 'USD'),
  ((SELECT id FROM products WHERE slug = 'wireless-mechanical-keyboard'), 'KBD-TAC', 'Tactile', 9499, 'USD'),
  ((SELECT id FROM products WHERE slug = 'bamboo-cutting-board'), 'BAMB-BRD', 'Standard', 4499, 'USD'),
  ((SELECT id FROM products WHERE slug = 'ceramic-espresso-cup'), 'CUP-CRM', 'Cream', 1200, 'USD'),
  ((SELECT id FROM products WHERE slug = 'ceramic-espresso-cup'), 'CUP-SGE', 'Sage', 1200, 'USD'),
  ((SELECT id FROM products WHERE slug = 'ceramic-espresso-cup'), 'CUP-CBL', 'Cobalt', 1350, 'USD'),
  ((SELECT id FROM products WHERE slug = 'everyday-canvas-tote'), 'TOTE-STD', 'Standard', 1499, 'USD'),
  ((SELECT id FROM products WHERE slug = 'alpine-flannel-shirt'), 'AFLN-S', 'Small', 2900, 'USD'),
  ((SELECT id FROM products WHERE slug = 'alpine-flannel-shirt'), 'AFLN-M', 'Medium', 2900, 'USD'),
  ((SELECT id FROM products WHERE slug = 'alpine-flannel-shirt'), 'AFLN-L', 'Large', 2900, 'USD');

INSERT INTO stock (variant_id, quantity) VALUES
  ((SELECT id FROM variants WHERE sku = 'OVCT-M'), 0),
  ((SELECT id FROM variants WHERE sku = 'OVCT-L'), 2),
  ((SELECT id FROM variants WHERE sku = 'KBD-LIN'), 7),
  ((SELECT id FROM variants WHERE sku = 'KBD-TAC'), 4),
  ((SELECT id FROM variants WHERE sku = 'BAMB-BRD'), 10),
  ((SELECT id FROM variants WHERE sku = 'CUP-CRM'), 40),
  ((SELECT id FROM variants WHERE sku = 'CUP-SGE'), 12),
  ((SELECT id FROM variants WHERE sku = 'CUP-CBL'), 0),
  ((SELECT id FROM variants WHERE sku = 'TOTE-STD'), 25),
  ((SELECT id FROM variants WHERE sku = 'AFLN-S'), 5),
  ((SELECT id FROM variants WHERE sku = 'AFLN-M'), 8),
  ((SELECT id FROM variants WHERE sku = 'AFLN-L'), 3);
