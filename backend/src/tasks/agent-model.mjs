// Which Claude model Sonic runs on and how hard it thinks, from operations.yaml `agent`:
//
//   agent:
//     model: sonnet   # fable | opus | sonnet | haiku (Agent SDK aliases: each runs the newest model of
//                     # its family the installed SDK knows, so keeping the SDK current keeps Sonic current)
//     effort: high    # low | medium | high | xhigh | max
//     max_budget_usd: 5   # optional: most a single run (one message and its work) may spend
//
// Settings > Agent writes the block; every agent run reads it when it starts, so a change applies
// from the next message on. Without the block, OPS_AGENT_MODEL / OPS_AGENT_EFFORT, then Sonnet at high.

const AGENT_MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const AGENT_DEFAULTS = Object.freeze({ model: 'sonnet', effort: 'high' });
/** Haiku takes no effort level, so none is sent for it. */
const EFFORT_MODELS = new Set(['fable', 'opus', 'sonnet']);

/** The model and effort for the next run. `effort` is null when the model takes none. */
export function resolveAgentModel(agent, env = process.env) {
  const pick = (value, allowed, fallback) => { const key = String(value || '').trim().toLowerCase(); return allowed.includes(key) ? key : fallback; };
  const envModel = String(env.OPS_AGENT_MODEL || '').trim();
  const model = pick(agent?.model, AGENT_MODELS, null) || envModel || AGENT_DEFAULTS.model;
  const effort = pick(agent?.effort, AGENT_EFFORTS, null) || pick(env.OPS_AGENT_EFFORT, AGENT_EFFORTS, AGENT_DEFAULTS.effort);
  return { model, effort: EFFORT_MODELS.has(model) || !AGENT_MODELS.includes(model) ? effort : null };
}

/** Errors for operations.yaml `agent`, in validateOperations' words. */
export function validateAgentSection(agent) {
  if (agent === undefined || agent === null) return [];
  if (typeof agent !== 'object' || Array.isArray(agent)) return ['agent must be a mapping'];
  const errors = [];
  if (agent.model !== undefined && !AGENT_MODELS.includes(agent.model)) errors.push(`agent.model must be ${AGENT_MODELS.join(', ')}`);
  if (agent.effort !== undefined && !AGENT_EFFORTS.includes(agent.effort)) errors.push(`agent.effort must be ${AGENT_EFFORTS.join(', ')}`);
  if (agent.max_budget_usd !== undefined && agent.max_budget_usd !== null && !(Number(agent.max_budget_usd) > 0)) errors.push('agent.max_budget_usd must be a positive number of dollars');
  return errors;
}
