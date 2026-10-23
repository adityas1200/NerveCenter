import { mappingAliases, MAPPING_KEYS } from './ddl-mapping.mjs';
import { agentEnv } from '../tasks/agent-access.mjs';

const defaultSdkLoader = () => import('@anthropic-ai/claude-agent-sdk');

function jsonFromText(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(source); } catch { /* Try a JSON object embedded in a short answer. */ }
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The DQ mapping agent did not return JSON');
  return JSON.parse(source.slice(start, end + 1));
}

function safeSample(sample) {
  if (!Array.isArray(sample)) return [];
  return sample.slice(0, 5).map(row => Object.fromEntries(Object.entries(row || {}).slice(0, 40)));
}

export class DdlMappingAgent {
  constructor({ sdkLoader = defaultSdkLoader, model = process.env.OPS_DQ_MAPPING_MODEL, maxBudgetUsd = Number(process.env.OPS_DQ_MAPPING_MAX_BUDGET_USD || 0.08) } = {}) {
    Object.assign(this, { sdkLoader, model, maxBudgetUsd });
  }

  // `apiKey` is the project's own key (SPEC-projects-04 FR-7); without one the deployment key is used, as before projects had keys.
  async suggest({ ddl, columns, mapping, candidates, sample = [], apiKey }) {
    const key = apiKey === undefined ? process.env.ANTHROPIC_API_KEY : apiKey;
    if (!key) return { used: false, reason: 'ANTHROPIC_API_KEY is not configured' };
    let sdk;
    try { sdk = await this.sdkLoader(); } catch { return { used: false, reason: 'Claude Agent SDK is not installed' }; }
    const columnNames = columns.map(column => `${column.name} (${column.type}${column.nullable ? ', nullable' : ', required'})`).join('\n');
    const prompt = [
      'You are a narrow data-quality schema mapping agent.',
      'Map the canonical DQ result fields to columns that actually exist in the supplied DDL.',
      'Do not invent columns. Do not write SQL. Return JSON only with keys mapping, confidence, issues.',
      `Canonical fields: ${MAPPING_KEYS.join(', ')}`,
      `Allowed aliases by field: ${JSON.stringify(mappingAliases)}`,
      `Columns from DDL:\n${columnNames}`,
      `Initial deterministic mapping: ${JSON.stringify(mapping)}`,
      `Initial candidates: ${JSON.stringify(candidates)}`,
      sample.length ? `The user allowed a small sample preview:\n${JSON.stringify(safeSample(sample))}` : 'No sample data is available. Use the DDL only.',
      `DDL:\n${String(ddl).slice(0, 100000)}`,
      'Return this shape: {"mapping":{"checkId":"..."},"confidence":0.0,"issues":["..."]}.',
    ].join('\n\n');
    let resultText = '';
    try {
      const options = { maxTurns: 1, maxBudgetUsd: this.maxBudgetUsd, tools: [], allowedTools: [], permissionMode: 'dontAsk', persistSession: false, systemPrompt: 'Return only the requested JSON. Do not reveal hidden reasoning.' };
      if (this.model) options.model = this.model;
      // A project key goes in explicitly, with the same trimmed environment a task gets, so the server's own key and secrets stay out.
      if (apiKey !== undefined) options.env = agentEnv(process.env, { extra: { ANTHROPIC_API_KEY: key } });
      for await (const message of sdk.query({ prompt, options })) {
        if (message.type === 'result') resultText = message.result || '';
      }
      const result = jsonFromText(resultText);
      return { used: true, mapping: result.mapping && typeof result.mapping === 'object' ? result.mapping : {}, confidence: Number(result.confidence), issues: Array.isArray(result.issues) ? result.issues.map(String).slice(0, 20) : [] };
    } catch (error) {
      return { used: false, reason: `The DQ mapping agent could not complete: ${String(error?.message || error).slice(0, 300)}` };
    }
  }
}
