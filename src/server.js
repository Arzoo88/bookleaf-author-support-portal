'use strict';
const config = require('./config');
require('./db');
const { seedIfEmpty } = require('./seed');
const { createApp } = require('./app');
const ai = require('./services/ai');

seedIfEmpty();
createApp().listen(config.port, () => {
  console.log(`BookLeaf portal running on http://localhost:${config.port}`);
  console.log(ai.isConfigured()
    ? `[ai] ${config.ai.provider} / ${config.ai.model}`
    : '[ai] no API key set: using rules-based triage and template drafts (set ANTHROPIC_API_KEY or OPENAI_API_KEY)');
});
