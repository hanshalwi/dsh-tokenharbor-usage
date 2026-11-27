/**
 * Host half of TokenHarbor usage.
 *
 * One operation, two callers: `readUsage` is the only place that talks to
 * TokenHarbor. The `tokenharbor_usage` tool and the
 * `GET /tokenharbor-usage/usage` route the sidebar chip fetches are thin
 * wrappers over it, so the tool and the chip always report the same numbers.
 *
 * The API key is resolved from the TOKENHARBOR_API_KEY credential on every
 * read, so a rotated key reaches the next call without a restart, and it never
 * leaves this process.
 */

const ALLOWANCE_URL = 'https://tokenharbor.ai/api/cli/free-tier'
const CREDENTIAL_REF = 'TOKENHARBOR_API_KEY'
const ROUTE_PATH = '/tokenharbor-usage/usage'
const CACHE_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000
const USER_AGENT = 'dsh-tokenharbor-usage/1.0'

export const inject = ['tools', 'credentials', 'webServer']

function asPercent(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0
}

function asText(value) {
  return typeof value === 'string' ? value : ''
}

function asCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/** Reduce the endpoint payload to the one shape the tool and the chip report. */
function summarize(payload) {
  const models = Array.isArray(payload.models)
    ? payload.models.filter((model) => typeof model === 'string')
    : []
  return {
    planName: asText(payload.plan_name),
    planUsedPercent: asPercent(payload.plan_used_pct),
    planExhausted: payload.plan_exhausted === true,
    freeUsedPercent: asPercent(payload.used_pct),
    freeExhausted: payload.exhausted === true,
    freeModels: models,
    freeModelsEnabled: payload.models_enabled === true,
    onPlan: payload.on_plan === true,
    resetAt: asText(payload.reset_at) || asText(payload.period_ends_at),
    periodStartedAt: asText(payload.period_started_at),
    requests: asCount(payload.req_used),
    requestsPerMinuteLimit: asCount(payload.rpm_limit),
    readAt: new Date().toISOString(),
  }
}

/** Plain-text projection of one snapshot, used for the tool result. */
function describe(usage) {
  const plan = usage.planName === '' ? 'paid plan' : usage.planName
  const lines = [
    `TokenHarbor ${plan}: ${Math.round(usage.planUsedPercent)}% of the weekly allowance used${usage.planExhausted ? ' (used up)' : ''}.`,
    `TokenHarbor free models: ${Math.round(usage.freeUsedPercent)}% of the weekly allowance used${usage.freeExhausted ? ' (used up)' : ''}.`,
  ]
  if (usage.resetAt !== '') lines.push(`Both allowances reset at ${usage.resetAt}.`)
  if (usage.periodStartedAt !== '') lines.push(`Current window started at ${usage.periodStartedAt}.`)
  lines.push(
    usage.freeModelsEnabled
      ? `Free-pool models: ${usage.freeModels.length > 0 ? usage.freeModels.join(', ') : 'none reported'}.`
      : 'Free models are disabled for this account.',
  )
  const limit = usage.requestsPerMinuteLimit > 0
    ? `, rate ceiling ${usage.requestsPerMinuteLimit} requests per minute`
    : ''
  lines.push(`Requests this window: ${usage.requests}${limit}.`)
  lines.push(`Snapshot read at ${usage.readAt}.`)
  return lines.join('\n')
}

const NON_BROWSER_SITES = new Set([undefined, 'same-origin', 'same-site', 'none'])

/**
 * Reject requests a page on another origin made. The route carries no
 * credential of its own, so this only keeps a hostile page from reading the
 * account's usage numbers out of the local web server.
 */
function isTrustedRequest(req) {
  return NON_BROWSER_SITES.has(req.headers['sec-fetch-site'])
}

function writeJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  res.end(body)
}

async function requestUsage(credentials) {
  const credential = await credentials.resolve(CREDENTIAL_REF)
  if (credential === undefined || credential.value === '') {
    throw new Error(
      `The ${CREDENTIAL_REF} credential is not set. Store your TokenHarbor API key under that name, then try again.`,
    )
  }
  let response
  try {
    response = await fetch(ALLOWANCE_URL, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${credential.value}`,
        'user-agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not reach TokenHarbor: ${reason}`)
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403
      ? ` Check the ${CREDENTIAL_REF} credential.`
      : ''
    throw new Error(`TokenHarbor answered HTTP ${response.status}.${hint}`)
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('TokenHarbor returned a response that is not JSON.')
  }
  if (payload === null || typeof payload !== 'object') {
    throw new Error('TokenHarbor returned an unexpected allowance shape.')
  }
  return summarize(payload)
}

export function apply(ctx) {
  let cached
  let inflight

  /** Read the allowance, reusing a snapshot younger than one minute. */
  function readUsage(refresh) {
    if (refresh !== true && cached !== undefined && Date.now() - cached.at < CACHE_MS) {
      return Promise.resolve(cached.usage)
    }
    if (inflight !== undefined) return inflight
    inflight = (async () => {
      try {
        const usage = await requestUsage(ctx.credentials)
        cached = { at: Date.now(), usage }
        return usage
      } finally {
        inflight = undefined
      }
    })()
    return inflight
  }

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        if (!isTrustedRequest(req)) {
          writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          writeJson(res, 405, { ok: false, error: { code: 'method', message: 'method not allowed' } }, { allow: 'GET, HEAD' })
          return
        }
        const refresh = new URL(req.url ?? '/', 'http://dsh.internal').searchParams.get('refresh') === '1'
        try {
          writeJson(res, 200, { ok: true, usage: await readUsage(refresh) })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          writeJson(res, 502, { ok: false, error: { code: 'unavailable', message } })
        }
      },
    }),
    'dsh-tokenharbor-usage: allowance route',
  )

  ctx.effect(
    () => ctx.tools.register({
      name: 'tokenharbor_usage',
      description:
        'Report how much TokenHarbor weekly allowance this account has left: the paid Pass, the free-model pool, when both reset, and which models the free pool unlocks. '
        + 'Use it when the user asks about their TokenHarbor usage, remaining allowance, or reset time. '
        + "Reads TokenHarbor's documented allowance endpoint, which spends no tokens; a snapshot is reused for up to 60 seconds.",
      parameters: {
        refresh: {
          type: 'boolean',
          description: 'Read a fresh snapshot instead of the one cached for up to 60 seconds.',
        },
      },
      output: {
        schema: {
          type: 'object',
          required: ['planName', 'planUsedPercent', 'planExhausted', 'freeUsedPercent', 'freeExhausted', 'freeModels', 'freeModelsEnabled', 'onPlan', 'resetAt', 'periodStartedAt', 'requests', 'requestsPerMinuteLimit', 'readAt'],
          additionalProperties: false,
          properties: {
            planName: {
              type: 'string',
              description: 'Name of the paid plan, or an empty string when the account has no plan.',
            },
            planUsedPercent: {
              type: 'number',
              description: 'Share of the paid plan allowance already used, from 0 to 100.',
            },
            planExhausted: {
              type: 'boolean',
              description: 'Whether the paid plan allowance is used up.',
            },
            freeUsedPercent: {
              type: 'number',
              description: 'Share of the free-model allowance already used, from 0 to 100.',
            },
            freeExhausted: {
              type: 'boolean',
              description: 'Whether the free-model allowance is used up.',
            },
            freeModels: {
              type: 'array',
              description: 'Model ids the free allowance unlocks.',
              items: { type: 'string' },
            },
            freeModelsEnabled: {
              type: 'boolean',
              description: 'Whether free models are enabled for the account.',
            },
            onPlan: {
              type: 'boolean',
              description: 'Whether usage is currently covered by the paid plan.',
            },
            resetAt: {
              type: 'string',
              description: 'ISO 8601 instant when both allowances reset, or an empty string when TokenHarbor reports none.',
            },
            periodStartedAt: {
              type: 'string',
              description: 'ISO 8601 instant when the current weekly window started.',
            },
            requests: {
              type: 'number',
              description: 'Requests made in the current window.',
            },
            requestsPerMinuteLimit: {
              type: 'number',
              description: 'Requests-per-minute ceiling TokenHarbor reports for this account.',
            },
            readAt: {
              type: 'string',
              description: 'ISO 8601 instant this snapshot was read.',
            },
          },
        },
        render: (_args, usage) => [{ type: 'text', text: describe(usage) }],
      },
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        return readUsage(args?.refresh === true)
      },
    }),
    'dsh-tokenharbor-usage: tokenharbor_usage tool',
  )
}
