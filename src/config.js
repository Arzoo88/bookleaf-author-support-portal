'use strict';
const path = require('path');
require('dotenv').config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && !env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

const provider = (env.AI_PROVIDER || 'anthropic').toLowerCase();

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: '8h',
  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'bookleaf.db'),
  seedFile: path.join(__dirname, '..', 'data', 'bookleaf_sample_data.json'),
  ai: {
    provider,
    // Keys are read server-side only and never sent to the browser.
    apiKey: provider === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY,
    model: env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-5-5'),
    baseUrl: env.AI_BASE_URL || null, // optional override (proxies, tests)
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 20000,
    maxRetries: 1,
  },
};
