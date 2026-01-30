-- Create components table
CREATE TABLE IF NOT EXISTS components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Create component_instances table
CREATE TABLE IF NOT EXISTS component_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    component_id INTEGER NOT NULL,
    route_id INTEGER NOT NULL,
    bounding_box TEXT NOT NULL, -- SQLite stores JSON as TEXT
    FOREIGN KEY (component_id) REFERENCES components(id),
    FOREIGN KEY (route_id) REFERENCES routes(id)
);

-- Create component_stats view
CREATE VIEW IF NOT EXISTS component_stats AS
SELECT
    c.id,
    c.name,
    c.image_url,
    COUNT(ci.id) as instance_count,
    COUNT(DISTINCT ci.route_id) as screen_count
FROM components c
LEFT JOIN component_instances ci ON c.id = ci.component_id
GROUP BY c.id, c.name, c.image_url;
