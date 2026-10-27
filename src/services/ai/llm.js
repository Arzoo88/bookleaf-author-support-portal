'use strict';
/**
 * Thin provider wrapper (Anthropic Messages API or OpenAI Chat Completions) using fetch.
 * Features: timeout, one retry with backoff on 429/5xx, and a circuit breaker so an outage
 * doesn't add 20s of latency to every request. Callers get an LlmUnavailableError and are
 * expected to degrade gracefully.
 */
const config = require('../../config');

class LlmUnavailableError extends Error {}

const breaker = { failures: 0, openUntil: 0 };
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

const isConfigured = () => Boolean(config.ai.apiKey);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callProvider({ system, user, maxTokens, temperature }) {
  const { provider, apiKey, model, timeoutMs, baseUrl } = config.ai;
  const signal = AbortSignal.timeout(timeoutMs);

  if (provider === 'openai') {
    const res = await fetch(`${baseUrl || 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw Object.assign(new Error(`OpenAI ${res.status}`), { status: res.status });
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  const res = await fetch(`${baseUrl || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw Object.assign(new Error(`Anthropic ${res.status}`), { status: res.status });
  const data = await res.json();
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

async function complete({ system, user, maxTokens = 400, temperature = 0.2 }) {
  if (!isConfigured()) throw new LlmUnavailableError('No API key configured');
  if (Date.now() < breaker.openUntil) throw new LlmUnavailableError('Circuit open after repeated failures');

  let lastErr;
  for (let attempt = 0; attempt <= config.ai.maxRetries; attempt++) {
    try {
      const text = await callProvider({ system, user, maxTokens, temperature });
      breaker.failures = 0;
      return text.trim();
    } catch (err) {
      lastErr = err;
      const retryable = !err.status || err.status === 429 || err.status >= 500;
      if (!retryable) break; // 4xx (bad key, bad request) won't improve on retry
      if (attempt < config.ai.maxRetries) await sleep(800 * (attempt + 1));
    }
  }
  if (++breaker.failures >= BREAKER_THRESHOLD) breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
  console.warn(`[ai] call failed: ${lastErr?.message}`);
  throw new LlmUnavailableError(lastErr?.message || 'LLM call failed');
}

module.exports = { complete, isConfigured, LlmUnavailableError };
