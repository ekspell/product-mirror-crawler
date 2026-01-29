-- Flow Mapping: page_connections table
-- Tracks navigation relationships between pages (source → destination)
-- Run this in the Supabase SQL Editor

CREATE TABLE page_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_route_id uuid REFERENCES routes(id) ON DELETE CASCADE,
  destination_route_id uuid REFERENCES routes(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  discovered_at timestamp DEFAULT now(),
  UNIQUE(source_route_id, destination_route_id)
);

CREATE INDEX idx_page_connections_source ON page_connections(source_route_id);
CREATE INDEX idx_page_connections_destination ON page_connections(destination_route_id);
CREATE INDEX idx_page_connections_product ON page_connections(product_id);
