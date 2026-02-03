-- Recording system: sessions, flow templates, and flows schema updates

-- Recording sessions table
CREATE TABLE IF NOT EXISTS recording_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_recording_sessions_product_id ON recording_sessions(product_id);
CREATE INDEX idx_recording_sessions_status ON recording_sessions(status);

-- Flow templates (default flows seeded into each recording session)
CREATE TABLE IF NOT EXISTS flow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0
);

INSERT INTO flow_templates (name, sort_order) VALUES
  ('Login / Sign up', 1),
  ('Dashboard / Home', 2),
  ('Settings / Account', 3),
  ('Billing', 4),
  ('Team / Users', 5),
  ('Notifications', 6),
  ('Help / Support', 7)
ON CONFLICT (name) DO NOTHING;

-- Add recording columns to flows table
ALTER TABLE flows ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES recording_sessions(id) ON DELETE CASCADE;
ALTER TABLE flows ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE flows ADD COLUMN IF NOT EXISTS step_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flows ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX idx_flows_session_id ON flows(session_id);
CREATE INDEX idx_flows_status ON flows(status);
