CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', name || ' ' || category || ' ' || description)
  ) STORED
);

CREATE INDEX products_category_idx ON products (category);
CREATE INDEX products_search_idx ON products USING GIN (search);

CREATE TABLE variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products (id),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  price_amount integer NOT NULL CHECK (price_amount >= 0),
  price_currency char(3) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX variants_product_id_idx ON variants (product_id);

CREATE TABLE stock (
  variant_id uuid PRIMARY KEY REFERENCES variants (id),
  quantity integer NOT NULL CHECK (quantity >= 0)
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES variants (id),
  quantity integer NOT NULL CHECK (quantity > 0),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reservations_variant_id_idx ON reservations (variant_id);
CREATE INDEX reservations_active_idx ON reservations (expires_at, released_at);
