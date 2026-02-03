const { supabase } = require('../lib/supabase');
const { launchBrowser, closeBrowser, isSessionActive } = require('./browser');
const { startWatching, stopWatching } = require('./navigation');

// In-memory tracking of active flow per session
// sessionId -> { id, name }
const activeFlows = new Map();

// In-memory tracking of flows completed this session
// sessionId -> Set of flowIds
const completedFlowsThisSession = new Map();


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

  // Get existing flows for this product (user-created only, no defaults)
  const { data: existingFlows } = await supabase
    .from('flows')
    .select('id, name')
    .eq('product_id', productId);

  console.log(`Found ${existingFlows?.length || 0} existing flows for product ${productId}`);

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

  // Clear session tracking
  activeFlows.delete(sessionId);
  completedFlowsThisSession.delete(sessionId);

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

  // Mark any in-progress flows as pending (not completed — they're product-level)
  await supabase
    .from('flows')
    .update({ status: 'pending' })
    .eq('status', 'recording');

  return { success: true };
}

async function getSessionStatus(sessionId) {
  // Get session
  const { data: session, error: sessionError } = await supabase
    .from('recording_sessions')
    .select('id, status, started_at, ended_at, product_id')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return null;
  }

  // Get ALL flows for this product (not session-specific)
  const { data: flows } = await supabase
    .from('flows')
    .select('id, name, status, step_count, created_at, completed_at')
    .eq('product_id', session.product_id)
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
    flows: (flows || []).map((f) => {
      const completedThisSession = completedFlowsThisSession.get(sessionId);
      let status = 'pending';
      if (activeFlow && activeFlow.id === f.id) {
        status = 'recording';
      } else if (completedThisSession && completedThisSession.has(f.id)) {
        status = 'completed';
      }
      return {
        id: f.id,
        name: f.name,
        status,
        screenCount: f.step_count || 0,
      };
    }),
    totalScreens,
  };
}

async function startFlow(sessionId, flowName, flowId) {
  // Get the session's product_id
  const { data: session } = await supabase
    .from('recording_sessions')
    .select('product_id')
    .eq('id', sessionId)
    .single();

  if (!session) {
    throw new Error('Session not found');
  }

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
    console.log(`Active flow set for session ${sessionId}:`, { id: flow.id, name: flow.name });
    return { flowId: flow.id, name: flow.name };
  }

  // Custom flow: check if one with this name already exists for the product
  const { data: existingFlow } = await supabase
    .from('flows')
    .select('id, name')
    .eq('product_id', session.product_id)
    .eq('name', flowName)
    .single();

  if (existingFlow) {
    // Reuse existing flow
    await supabase
      .from('flows')
      .update({ status: 'recording' })
      .eq('id', existingFlow.id);

    activeFlows.set(sessionId, { id: existingFlow.id, name: existingFlow.name });
    return { flowId: existingFlow.id, name: existingFlow.name };
  }

  // Create new custom flow
  const { data: flow, error } = await supabase
    .from('flows')
    .insert({
      product_id: session.product_id,
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
      status: 'pending',
      step_count: screenCount,
    })
    .eq('id', flowId);

  if (error) throw new Error(`Failed to end flow: ${error.message}`);

  // Track this flow as completed for this session
  if (!completedFlowsThisSession.has(sessionId)) {
    completedFlowsThisSession.set(sessionId, new Set());
  }
  completedFlowsThisSession.get(sessionId).add(flowId);
  console.log(`Marked flow ${flowId} as completed for session ${sessionId}`);

  // Clear active flow
  activeFlows.delete(sessionId);

  return { screenCount };
}

module.exports = { startSession, endSession, getSessionStatus, startFlow, endFlow };
