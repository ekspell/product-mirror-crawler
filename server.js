const express = require('express');
const cors = require('cors');
require('dotenv').config();

const {
  startSession,
  endSession,
  getSessionStatus,
  startFlow,
  endFlow,
} = require('./recording/session');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Recording Session Endpoints ---

// Start a recording session
app.post('/api/recording/start', async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ error: 'productId is required' });
    }

    const result = await startSession(productId);
    res.json({ success: true, sessionId: result.sessionId });
  } catch (err) {
    console.error('POST /api/recording/start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// End a recording session
app.post('/api/recording/end', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    await endSession(sessionId);
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/recording/end error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get recording session status (polled by dashboard)
app.get('/api/recording/status', async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const status = await getSessionStatus(sessionId);
    if (!status) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(status);
  } catch (err) {
    console.error('GET /api/recording/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Flow Endpoints ---

// Start recording a flow
app.post('/api/recording/flow/start', async (req, res) => {
  try {
    const { sessionId, flowName, flowId } = req.body;
    console.log('Flow start request:', { sessionId, flowName, flowId });

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (!flowName && !flowId) {
      return res.status(400).json({ error: 'flowName or flowId is required' });
    }

    const result = await startFlow(sessionId, flowName, flowId);
    console.log('Flow started:', result);
    res.json({ success: true, flowId: result.flowId, name: result.name });
  } catch (err) {
    console.error('POST /api/recording/flow/start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// End recording a flow
app.post('/api/recording/flow/end', async (req, res) => {
  try {
    const { sessionId, flowId } = req.body;
    if (!sessionId || !flowId) {
      return res.status(400).json({ error: 'sessionId and flowId are required' });
    }

    const result = await endFlow(sessionId, flowId);
    res.json({ success: true, screenCount: result.screenCount });
  } catch (err) {
    console.error('POST /api/recording/flow/end error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Product Mirror crawler backend running on port ${PORT}`);
});
