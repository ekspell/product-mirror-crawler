const { supabase } = require('../lib/supabase');
const { launchBrowser, closeBrowser, isSessionActive } = require('./browser');
const { startWatching, stopWatching } = require('./navigation');

// In-memory tracking of active flow per session
// sessionId -> { id, name }
const activeFlows = new Map();

// Hardcoded defaults — used when flow_templates table is missing or empty
const DEFAULT_FLOWS = [
  { name: 'Login / Sign up', sort_order: 1 },
  { name: 'Dashboard / Home', sort_order: 2 },
  { name: 'Settings / Account', sort_order: 3 },
  { name: 'Billing', sort_order: 4 },
  { name: 'Team / Users', sort_order: 5 },
  { name: 'Notifications', sort_order: 6 },
  { name: 'Help / Support', sort_order: 7 },
];

async function startSession(productId) {
  // Fetch product
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, name, staging_url')
    .eq('id', productId)
    .single();

  if (productError || !product) {
    throw new Error(`Product not found: ${productId}`);
  }

  // Create recording session in DB
  const { data: session, error: sessionError } = await supabase
    .from('recording_sessions')
    .insert({
      product_id: productId,
      status: 'in_progress',
    })
    .select('id')
    .single();

  if (sessionError) {
    throw new Error(`Failed to create session: ${sessionError.message}`);
  }

  // Seed default flows from templates (fall back to hardcoded defaults)
  const { data: templates, error: templatesError } = await supabase
    .from('flow_templates')
    .select('name, sort_order')
    .order('sort_order');

  if (templatesError) {
    console.warn('flow_templates query failed (table may not exist):', templatesError.message);
  }

  const flowSource = (templates && templates.length > 0) ? templates : DEFAULT_FLOWS;

  // Deduplicate by name in case flow_templates has duplicate rows
  const seen = new Set();
  const uniqueFlows = flowSource.filter((t) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });

  const flowRows = uniqueFlows.map((t) => ({
    product_id: productId,
    session_id: session.id,
    name: t.name,
    status: 'pending',
    step_count: 0,
  }));

  const { error: flowInsertError } = await supabase.from('flows').insert(flowRows);

  if (flowInsertError) {
    console.error('Failed to seed default flows:', flowInsertError.message);
    // Don't throw — session is created, user can still add custom flows
  } else {
    console.log(`Seeded ${flowRows.length} default flows for session ${session.id}`);
  }

  // Launch Playwright browser
  const { page } = await launchBrowser(session.id, product.staging_url);

  // Start navigation watching
  startWatching(session.id, page, {
    productId,
    getActiveFlow: () => activeFlows.get(session.id) || null,
  });

  // Handle browser disconnect
  page.context().browser().on('disconnected', async () => {
    console.log(`Browser disconnected for session ${session.id}`);
    stopWatching(session.id);
  });

  return { sessionId: session.id };
}

async function endSession(sessionId) {
  // Stop navigation watching
  stopWatching(sessionId);

  // Close browser
  await closeBrowser(sessionId);

  // Clear active flow
  activeFlows.delete(sessionId);

  // Mark session complete in DB
  const { error } = await supabase
    .from('recording_sessions')
    .update({
      status: 'completed',
      ended_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (error) {
    throw new Error(`Failed to end session: ${error.message}`);
  }

  // Mark any in-progress flows as completed
  await supabase
    .from('flows')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .eq('status', 'recording');

  return { success: true };
}

async function getSessionStatus(sessionId) {
  // Get session
  const { data: session, error: sessionError } = await supabase
    .from('recording_sessions')
    .select('id, status, started_at, ended_at')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return null;
  }

  // Get flows for this session
  const { data: flows } = await supabase
    .from('flows')
    .select('id, name, status, step_count, created_at, completed_at')
    .eq('session_id', sessionId)
    .order('created_at');

  const activeFlow = activeFlows.get(sessionId) || null;
  const browserConnected = isSessionActive(sessionId);

  // Calculate total screens
  const totalScreens = (flows || []).reduce((sum, f) => sum + (f.step_count || 0), 0);

  return {
    sessionId: session.id,
    status: session.status,
    startedAt: session.started_at,
    browserConnected,
    activeFlow: activeFlow
      ? {
          id: activeFlow.id,
          name: activeFlow.name,
          screenCount: (flows || []).find((f) => f.id === activeFlow.id)?.step_count || 0,
        }
      : null,
    flows: (flows || []).map((f) => ({
      id: f.id,
      name: f.name,
      status: f.status,
      screenCount: f.step_count || 0,
    })),
    totalScreens,
  };
}

async function startFlow(sessionId, flowName, flowId) {
  // If flowId provided, update existing flow
  if (flowId) {
    const { error } = await supabase
      .from('flows')
      .update({ status: 'recording' })
      .eq('id', flowId);

    if (error) throw new Error(`Failed to start flow: ${error.message}`);

    // Get the flow name
    const { data: flow } = await supabase
      .from('flows')
      .select('id, name')
      .eq('id', flowId)
      .single();

    activeFlows.set(sessionId, { id: flow.id, name: flow.name });
    return { flowId: flow.id, name: flow.name };
  }

  // Otherwise create a new custom flow
  // First get the session's product_id
  const { data: session } = await supabase
    .from('recording_sessions')
    .select('product_id')
    .eq('id', sessionId)
    .single();

  const { data: flow, error } = await supabase
    .from('flows')
    .insert({
      product_id: session.product_id,
      session_id: sessionId,
      name: flowName,
      status: 'recording',
      step_count: 0,
    })
    .select('id, name')
    .single();

  if (error) throw new Error(`Failed to create flow: ${error.message}`);

  activeFlows.set(sessionId, { id: flow.id, name: flow.name });
  return { flowId: flow.id, name: flow.name };
}

async function endFlow(sessionId, flowId) {
  // Get current step count
  const { data: routes } = await supabase
    .from('routes')
    .select('id')
    .eq('flow_id', flowId);

  const screenCount = routes?.length || 0;

  const { error } = await supabase
    .from('flows')
    .update({
      status: 'completed',
      step_count: screenCount,
      completed_at: new Date().toISOString(),
    })
    .eq('id', flowId);

  if (error) throw new Error(`Failed to end flow: ${error.message}`);

  // Clear active flow
  activeFlows.delete(sessionId);

  return { screenCount };
}

module.exports = { startSession, endSession, getSessionStatus, startFlow, endFlow };
