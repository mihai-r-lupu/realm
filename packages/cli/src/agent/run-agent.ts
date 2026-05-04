// run-agent.ts — Core agent loop logic, decoupled from the Commander handler for testability.
// Exports runAgent(), postGateNotificationToSlack(), postGateViaApi(), postSlackReply(),
// startGateReminderTimers(), formatGatePreviewForSlack(), AgentDeps, AgentRunOptions, and AgentRunResult.
import { join } from 'node:path';
import {
  loadWorkflowFromFile,
  submitHumanResponse,
  findEligibleSteps,
  executeChain,
  buildNextActions,
  type RunStore,
  type WorkflowDefinition,
  type StepDefinition,
  type PendingGate,
  type ExtensionRegistry,
  type McpServerConfig,
  type ToolCallRecord,
} from '@sensigo/realm';
import type { WorkflowRegistrar } from '@sensigo/realm';
import type { LlmProvider } from './llm-provider.js';
import { isToolCapable } from './llm-provider.js';
import type { McpClient, ToolDefinition, ToolExecutor } from './mcp-types.js';
import { McpClient as McpClientImpl } from './mcp-client.js';
import { startSlackGateServer } from './slack-gate-server.js';
import { connectSocketMode } from './slack-socket-client.js';

export type AgentRunResult = 'completed' | 'failed';

export interface AgentDeps {
  store: RunStore;
  workflowStore: WorkflowRegistrar;
  provider: LlmProvider;
  registry: ExtensionRegistry;
  /**
   * Override gate handling — replaces the default (print info + Slack notify + poll) path.
   * Provided by tests to resolve gates synchronously without real polling.
   */
  onGate?: (runId: string, gate: PendingGate, approveCmd: string) => Promise<void>;
  /**
   * Factory for creating an McpClient instance. Injected by tests for mock isolation.
   * Defaults to constructing a real McpClient when absent.
   */
  mcpClientFactory?: (servers: McpServerConfig[], signal?: AbortSignal) => McpClient;
}

export interface AgentRunOptions {
  /** Path to workflow.yaml file. Required when definition is not provided. */
  workflowPath?: string;
  /** Inline workflow definition — bypasses loadWorkflowFromFile when provided. */
  definition?: WorkflowDefinition;
  /**
   * Attach to an existing run instead of creating a new one.
   * When set, runAgent() skips deps.store.create() and uses this ID directly.
   * Mutually exclusive with workflowPath — runAgent() throws if both are set.
   */
  existingRunId?: string;
  params: Record<string, unknown>;
  slackWebhookUrl?: string;
  /** SLACK_BOT_TOKEN — enables bidirectional gate resolution and chat.postMessage notifications. */
  slackBotToken?: string;
  /** SLACK_CHANNEL_ID — target channel for bot token notifications and thread polling. */
  slackChannelId?: string;
  /** SLACK_SIGNING_SECRET — enables the Slack Events API server. */
  slackSigningSecret?: string;
  /** SLACK_EVENTS_PORT — port for the Events API server. Defaults to 3100. */
  slackEventsPort?: number;
  /** SLACK_APP_TOKEN — App-level token (xapp-...) for Socket Mode gate resolution. */
  slackAppToken?: string;
  /** SLACK_GATE_REMINDER_INTERVAL_MS — delay before first reminder. Defaults to 600000 (10 min). */
  slackGateReminderIntervalMs?: number;
  /** SLACK_GATE_ESCALATION_THRESHOLD_MS — delay before escalation. Defaults to 1800000 (30 min). */
  slackGateEscalationThresholdMs?: number;
  /** Poll interval in ms. Defaults to 3000. Lower values are useful in tests. */
  pollIntervalMs?: number;
  /**
   * When true, persist the workflow definition to ~/.realm/workflows/ so that
   * `realm run inspect` and `realm run list` can resolve it by ID.
   * Defaults to false — realm agent does not register workflows as a side effect.
   */
  register?: boolean;
}

/**
 * Renders a display template against a flat vars object.
 * Syntax: {{ field }} or {{ nested.field }} — plain dot-path interpolation, no filters.
 * Missing paths render as empty string.
 */
function renderDisplay(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => {
    const parts = expr.trim().split('.');
    let val: unknown = vars;
    for (const part of parts) {
      if (typeof val !== 'object' || val === null) {
        val = undefined;
        break;
      }
      val = (val as Record<string, unknown>)[part];
    }
    return val === undefined ? '' : typeof val === 'string' ? val : JSON.stringify(val);
  });
}

/**
 * Formats a step output object as human-readable plain text for the terminal.
 * Renders `headline` and `message` string fields directly; falls back to JSON.
 */
function formatOutputForTerminal(output: Record<string, unknown>): string {
  const headline = typeof output['headline'] === 'string' ? output['headline'] : undefined;
  const message = typeof output['message'] === 'string' ? output['message'] : undefined;

  if (headline !== undefined || message !== undefined) {
    const parts: string[] = [];
    if (headline !== undefined) parts.push(headline);
    if (message !== undefined) parts.push(message);
    return parts.join('\n\n');
  }

  if (Object.keys(output).length === 0) {
    return '(no output)';
  }

  return JSON.stringify(output, null, 2);
}

/**
 * Formats a gate preview object as human-readable Slack mrkdwn text.
 * Uses `headline` and `message` fields when present; falls back to indented JSON.
 */
export function formatGatePreviewForSlack(preview: Record<string, unknown>): string {
  const headline = typeof preview['headline'] === 'string' ? preview['headline'] : undefined;
  const message = typeof preview['message'] === 'string' ? preview['message'] : undefined;

  if (headline !== undefined || message !== undefined) {
    const parts: string[] = [];
    if (headline !== undefined) parts.push(`*${headline}*`);
    if (message !== undefined) parts.push(message);
    return parts.join('\n\n');
  }

  if (Object.keys(preview).length === 0) {
    return '_(no preview)_';
  }

  return '```\n' + JSON.stringify(preview, null, 2) + '\n```';
}

/**
 * POSTs a gate-waiting notification to a Slack Incoming Webhook.
 * Failure is warned but does not abort the workflow run.
 */
export async function postGateNotificationToSlack(
  webhookUrl: string,
  gate: PendingGate,
  approveCmd: string,
): Promise<void> {
  const ownerLine = gate.owner !== undefined ? `\n*Owner:* ${gate.owner}` : '';
  const previewText = gate.resolved_message ?? formatGatePreviewForSlack(gate.preview);
  const blockText =
    `*Gate:* \`${gate.step_name}\`${ownerLine}\n\n${previewText}\n\n---\n` +
    `*Gate requires a terminal response — open a terminal and run:*\n\`\`\`${approveCmd}\`\`\``;
  const body = {
    text: '⏸ Workflow gate waiting for approval',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: blockText,
        },
      },
    ],
  };
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(
      `  ⚠  Slack notification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function pollUntilGateResolved(
  store: RunStore,
  runId: string,
  gateId: string,
  intervalMs: number,
  signal?: AbortSignal,
): Promise<void> {
  console.log('   Waiting for approval...');
  for (;;) {
    if (signal?.aborted) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      if (signal !== undefined) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      }
    });
    if (signal?.aborted) break;
    const run = await store.get(runId);
    if (run.terminal_state) break;
    if (run.pending_gate === undefined || run.pending_gate.gate_id !== gateId) break;
  }
}

/**
 * Posts a gate notification to Slack via chat.postMessage (bot token path).
 * Returns the message ts for use as a thread anchor, or undefined on failure.
 */
export async function postGateViaApi(
  botToken: string,
  channelId: string,
  gate: PendingGate,
  approveCmd: string,
): Promise<string | undefined> {
  const ownerLine = gate.owner !== undefined ? `\n*Owner:* ${gate.owner}` : '';
  const previewText = gate.resolved_message ?? formatGatePreviewForSlack(gate.preview);
  const choiceList = gate.choices.map((c) => `\`${c}\``).join(' or ');
  const blockText =
    `*Gate:* \`${gate.step_name}\`${ownerLine}\n\n${previewText}\n\n---\n` +
    `*Reply in this thread with ${choiceList} to resolve, or run the terminal command:*\n\`\`\`${approveCmd}\`\`\``;
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: channelId,
        text: '⏸ Workflow gate waiting for approval',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: blockText } }],
      }),
    });
    const data = (await response.json()) as { ok: boolean; ts?: string };
    return data.ok ? data.ts : undefined;
  } catch (err) {
    console.warn(
      `Gate API notification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/**
 * Posts a reply to an existing Slack thread via chat.postMessage.
 * Failures are warned but not thrown — best-effort.
 */
export async function postSlackReply(
  botToken: string,
  channelId: string,
  threadTs: string,
  text: string,
): Promise<void> {
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({ channel: channelId, thread_ts: threadTs, text }),
    });
  } catch (err) {
    console.warn(`Slack reply failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Starts reminder and escalation timers for an open gate.
 * Returns a cleanup function that clears both timers — must be called when the gate resolves.
 */
export function startGateReminderTimers(
  botToken: string,
  channelId: string,
  threadTs: string,
  gate: PendingGate,
  reminderIntervalMs: number,
  escalationThresholdMs: number,
): () => void {
  const reminderTimer = setTimeout(() => {
    postSlackReply(
      botToken,
      channelId,
      threadTs,
      `⏰ Reminder: gate \`${gate.step_name}\` is still waiting for a response.`,
    ).catch((err) => {
      console.warn(`Reminder post failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, reminderIntervalMs);

  const escalationTimer = setTimeout(() => {
    const elapsedMin = Math.round((Date.now() - new Date(gate.opened_at).getTime()) / 60_000);
    const mention = gate.owner !== undefined ? `${gate.owner} — ` : '';
    const text = `${mention}gate \`${gate.step_name}\` has been open for ${elapsedMin} minutes. Please respond.`;
    postSlackReply(botToken, channelId, threadTs, text).catch((err) => {
      console.warn(`Escalation post failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, escalationThresholdMs);

  return () => {
    clearTimeout(reminderTimer);
    clearTimeout(escalationTimer);
  };
}

/** Parameters for the bidirectional gate handler. */
export interface BidirectionalGateParams {
  gate: PendingGate;
  runId: string;
  definition: WorkflowDefinition;
  store: RunStore;
  provider: LlmProvider;
  slackBotToken: string;
  slackChannelId: string;
  gateThreadTs: string | undefined;
  slackSigningSecret?: string;
  slackEventsPort: number;
  /** SLACK_APP_TOKEN — enables Socket Mode when set. */
  slackAppToken?: string;
  gateReminderIntervalMs: number;
  gateEscalationThresholdMs: number;
  pollIntervalMs: number;
}

/**
 * Handles a gate using Slack bidirectional resolution:
 * - Events API (when signing secret is present) or Socket Mode (when app token is present)
 * - LLM intent interpretation of Slack replies
 * - Reminder and escalation timers
 * - Falls back to store polling for terminal-command gate resolution
 */
export async function handleBidirectionalGate(params: BidirectionalGateParams): Promise<void> {
  const {
    gate,
    runId,
    definition,
    store,
    provider,
    slackBotToken,
    slackChannelId,
    gateThreadTs,
    slackSigningSecret,
    slackEventsPort,
    slackAppToken,
    gateReminderIntervalMs,
    gateEscalationThresholdMs,
    pollIntervalMs,
  } = params;

  let clarificationCount = 0;
  const abortController = new AbortController();

  const processCandidate = async (text: string): Promise<void> => {
    if (abortController.signal.aborted) return;

    // Gate choices must be exact (case-insensitive). No LLM interpretation — gate responses
    // are irreversible writes and must reflect unambiguous intent.
    const normalised = text.trim().toLowerCase();
    const exactMatch = gate.choices.find((c) => c.toLowerCase() === normalised);

    if (exactMatch !== undefined) {
      try {
        await submitHumanResponse(store, definition, {
          runId,
          gateId: gate.gate_id,
          choice: exactMatch,
        });
        if (gateThreadTs !== undefined) {
          const confirmationText =
            gate.resolution_messages?.[exactMatch] ??
            `✅ Gate resolved: \`${exactMatch}\` — run continuing.`;
          await postSlackReply(slackBotToken, slackChannelId, gateThreadTs, confirmationText);
        }
        abortController.abort();
      } catch (err) {
        console.warn(
          `Gate response submission failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else if (clarificationCount < 2 && gateThreadTs !== undefined) {
      clarificationCount++;
      await postSlackReply(
        slackBotToken,
        slackChannelId,
        gateThreadTs,
        `Please reply with one of: ${gate.choices.join(', ')}`,
      );
    }
  };

  // Set up candidate intake — Socket Mode (preferred), Events API, or none.
  // Dedup set prevents duplicate onEvent calls. Socket Mode (preferred) and Events API both
  // have at-least-once delivery — the same event can arrive more than once.
  const seenEventIds = new Set<string>();
  let serverHandle: { close(): void } | undefined;
  if (slackAppToken !== undefined && gateThreadTs !== undefined) {
    // Mode 2 — Socket Mode (WebSocket push, no public URL required)
    serverHandle = connectSocketMode({
      appToken: slackAppToken,
      threadTs: gateThreadTs,
      onEvent: (event) => {
        if (seenEventIds.has(event.event_id)) return;
        seenEventIds.add(event.event_id);
        processCandidate(event.text).catch((err) => {
          console.warn(
            `Candidate processing failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      },
      signal: abortController.signal,
    });
  } else if (slackSigningSecret !== undefined && gateThreadTs !== undefined) {
    // Mode 3 — Events API (HTTP push, requires public URL)
    serverHandle = startSlackGateServer({
      port: slackEventsPort,
      signingSecret: slackSigningSecret,
      onEvent: (event) => {
        if (seenEventIds.has(event.event_id)) return;
        seenEventIds.add(event.event_id);
        if (event.thread_ts !== gateThreadTs) return;
        processCandidate(event.text).catch((err) => {
          console.warn(
            `Candidate processing failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      },
    });
  } else if (gateThreadTs !== undefined) {
    // Gate notification posted but no listener configured.
    console.log(
      '  ℹ  Gate notification posted. Set SLACK_APP_TOKEN (Socket Mode) or SLACK_SIGNING_SECRET (Events API) to resolve via Slack. Using terminal command fallback.',
    );
  }

  // Notify when neither Events nor polling can be used — no thread anchor available.
  if (gateThreadTs === undefined) {
    console.log(
      '  ℹ  Bidirectional Slack resolution unavailable (no thread anchor). Use terminal command shown above.',
    );
  }

  // Start reminder/escalation timers if we have a thread anchor.
  const clearTimers =
    gateThreadTs !== undefined
      ? startGateReminderTimers(
          slackBotToken,
          slackChannelId,
          gateThreadTs,
          gate,
          gateReminderIntervalMs,
          gateEscalationThresholdMs,
        )
      : (): void => {};

  try {
    // Poll the store as the unified done-detector — resolves when candidate processor
    // calls submitHumanResponse OR when the terminal command is used.
    await pollUntilGateResolved(store, runId, gate.gate_id, pollIntervalMs, abortController.signal);
  } finally {
    abortController.abort();
    clearTimers();
    serverHandle?.close();
  }
}

/**
 * Runs a workflow to completion using the provided dependencies.
 * Returns 'completed' when the run finishes normally; 'failed' otherwise.
 * Throws on setup failures (e.g. workflow file not found, provider error).
 */
export async function runAgent(deps: AgentDeps, options: AgentRunOptions): Promise<AgentRunResult> {
  if (options.existingRunId !== undefined && options.workflowPath !== undefined) {
    throw new Error('existingRunId and workflowPath are mutually exclusive');
  }

  // Load or use provided definition.
  const definition: WorkflowDefinition =
    options.definition !== undefined
      ? options.definition
      : loadWorkflowFromFile(
          options.workflowPath!.endsWith('.yaml') || options.workflowPath!.endsWith('.yml')
            ? options.workflowPath!
            : join(options.workflowPath!, 'workflow.yaml'),
        );

  // Register only when explicitly requested (--register flag).
  // By default realm agent does not write to ~/.realm/workflows/ as a side effect.
  if (options.register === true) {
    await deps.workflowStore.register(definition);
  }

  let runId: string;
  let currentRun;

  if (options.existingRunId !== undefined) {
    // --run-id path: attach to existing run
    currentRun = await deps.store.get(options.existingRunId);
    if (currentRun.terminal_state) {
      throw new Error(
        `Run ${options.existingRunId} is already in terminal state: ${currentRun.terminal_reason ?? currentRun.run_phase}`,
      );
    }
    runId = options.existingRunId;
    // in_progress_steps on attach: handled by engine's existing eligibility logic — no restart needed
  } else {
    // Normal path: create new run
    const initialRecord = await deps.store.create({
      workflowId: definition.id,
      workflowVersion: definition.version,
      params: options.params,
    });
    runId = initialRecord.id;
    currentRun = await deps.store.get(runId);
  }

  console.log(`\nRealm Agent — ${definition.name} v${definition.version}`);
  console.log(`Run ID: ${runId}\n`);

  // Initialise MCP client if any steps declare tools.
  let mcpClient: McpClient | undefined;
  if (definition.mcp_servers !== undefined && definition.mcp_servers.length > 0) {
    const serverIds = new Set(definition.mcp_servers.map((s) => s.id));
    for (const step of Object.values(definition.steps)) {
      for (const toolEntry of step.tools ?? []) {
        const serverId = toolEntry.split(':')[0] ?? '';
        if (!serverIds.has(serverId)) {
          throw new Error(`Step tool '${toolEntry}' references unknown MCP server '${serverId}'`);
        }
      }
    }
    mcpClient = (deps.mcpClientFactory ?? ((s, sig) => new McpClientImpl(s, sig)))(
      definition.mcp_servers,
      undefined, // AbortSignal not threaded into runAgent — disconnect() is in finally
    );
    if (!isToolCapable(deps.provider)) {
      throw new Error(
        'This workflow uses MCP tool-enabled steps, but the configured LLM provider does not support tool calling. ' +
          'Use --provider openai or --provider anthropic.',
      );
    }
  }

  try {
    while (!currentRun.terminal_state) {
      // --- Gate handling ---
      if (currentRun.pending_gate !== undefined) {
        const gate = currentRun.pending_gate;

        console.log(`\n⏸  Gate: ${gate.step_name} | ID: ${gate.gate_id}`);
        const gateStepDef = definition.steps[gate.step_name];
        const gateText =
          gate.resolved_message ??
          (gateStepDef?.display !== undefined
            ? renderDisplay(gateStepDef.display, gate.preview)
            : formatOutputForTerminal(gate.preview));
        const indented = gateText
          .trimEnd()
          .split('\n')
          .map((l) => `   ${l}`)
          .join('\n');
        console.log('\n' + indented + '\n');

        // Use the first choice as the approve command for the Slack notification.
        const approveCmd = `realm run respond ${runId} --gate ${gate.gate_id} --choice ${gate.choices[0] ?? 'approve'}`;

        const hasTransport =
          deps.onGate !== undefined ||
          (options.slackBotToken !== undefined && options.slackChannelId !== undefined);

        if (!hasTransport) {
          for (const choice of gate.choices) {
            const label = choice.charAt(0).toUpperCase() + choice.slice(1);
            console.log(
              `   ${label}: realm run respond ${runId} --gate ${gate.gate_id} --choice ${choice}`,
            );
          }
        }

        if (deps.onGate !== undefined) {
          await deps.onGate(runId, gate, approveCmd);
        } else if (options.slackBotToken !== undefined && options.slackChannelId !== undefined) {
          // Bidirectional path: post via chat.postMessage to receive a thread_ts,
          // then listen for replies via Events API or thread polling.
          const gateThreadTs = await postGateViaApi(
            options.slackBotToken,
            options.slackChannelId,
            gate,
            approveCmd,
          );
          await handleBidirectionalGate({
            gate,
            runId,
            definition,
            store: deps.store,
            provider: deps.provider,
            slackBotToken: options.slackBotToken,
            slackChannelId: options.slackChannelId,
            gateThreadTs,
            ...(options.slackSigningSecret !== undefined
              ? { slackSigningSecret: options.slackSigningSecret }
              : {}),
            slackEventsPort: options.slackEventsPort ?? 3100,
            ...(options.slackAppToken !== undefined
              ? { slackAppToken: options.slackAppToken }
              : {}),
            gateReminderIntervalMs: options.slackGateReminderIntervalMs ?? 600_000,
            gateEscalationThresholdMs: options.slackGateEscalationThresholdMs ?? 1_800_000,
            pollIntervalMs: options.pollIntervalMs ?? 3000,
          });
        } else {
          // One-way webhook notification + store polling.
          if (options.slackWebhookUrl !== undefined) {
            await postGateNotificationToSlack(options.slackWebhookUrl, gate, approveCmd);
          }
          await pollUntilGateResolved(
            deps.store,
            runId,
            gate.gate_id,
            options.pollIntervalMs ?? 3000,
          );
        }

        currentRun = await deps.store.get(runId);
        continue;
      }

      // --- Step execution ---
      const eligible = findEligibleSteps(definition, currentRun);
      if (eligible.length === 0) break;

      const stepName = eligible[0]!;
      const stepDef: StepDefinition = definition.steps[stepName]!;

      let stepInput: Record<string, unknown>;
      let toolCallsForMeta: ToolCallRecord[] | undefined;

      if (stepDef.execution === 'agent') {
        // Resolve template-expanded prompt via buildNextActions so {{ context.resources.* }}
        // references are substituted before the LLM call.
        const nextActions = buildNextActions(definition, currentRun);
        const nextAction =
          nextActions.find(
            (a) =>
              a.instruction !== null &&
              (a.instruction.call_with['command'] as string | undefined) === stepName,
          ) ?? nextActions[0];

        const prompt = nextAction?.prompt ?? stepDef.description;
        const inputSchema =
          (nextAction?.input_schema as Record<string, unknown> | undefined) ??
          (stepDef.input_schema as Record<string, unknown> | undefined);

        const descPreview = stepDef.description.slice(0, 80);
        console.log(`\n→ [agent] ${stepName}`);
        console.log(`  ${descPreview}${stepDef.description.length > 80 ? '…' : ''}`);

        if (stepDef.tools && stepDef.tools.length > 0 && mcpClient) {
          // Tools path: build tool definitions, call callStepWithTools.
          const byServer = new Map<string, string[]>();
          for (const entry of stepDef.tools) {
            const [serverId, toolName] = entry.split(':') as [string, string];
            if (!byServer.has(serverId)) byServer.set(serverId, []);
            byServer.get(serverId)!.push(toolName);
          }

          const toolDefs: ToolDefinition[] = [];
          for (const [serverId, allowList] of byServer) {
            const mcpTools = await mcpClient.getTools(serverId, allowList);

            const returnedNames = new Set(mcpTools.map((t) => t.name));
            for (const name of allowList) {
              if (!returnedNames.has(name)) {
                console.warn(
                  `⚠ Tool '${serverId}:${name}' declared in step '${stepName}' was not found in any connected MCP server and will not be available.`,
                );
              }
            }

            for (const mcpTool of mcpTools) {
              toolDefs.push({
                id: `${serverId}:${mcpTool.name}`,
                serverId,
                name: mcpTool.name,
                description: mcpTool.description,
                inputSchema: mcpTool.inputSchema,
              });
            }
          }

          const executor: ToolExecutor = async (namespacedName, args) => {
            const [serverId, toolName] = namespacedName.split(':') as [string, string];
            return mcpClient!.call(serverId, toolName, args);
          };

          let toolsResult;
          try {
            if (!isToolCapable(deps.provider)) {
              throw new Error(
                'invariant: provider lost tool capability between startup and step execution',
              );
            }
            toolsResult = await deps.provider.callStepWithTools(prompt, toolDefs, executor, {
              ...(stepDef.input_schema !== undefined
                ? { inputSchema: stepDef.input_schema as Record<string, unknown> }
                : {}),
              maxToolCalls: stepDef.max_tool_calls ?? 20,
              toolTimeoutMs: (stepDef.tool_timeout ?? 30) * 1000,
            });
          } catch (err) {
            console.error(
              `\n✗ Step '${stepName}' (tools) failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return 'failed';
          }
          stepInput = toolsResult.output;
          toolCallsForMeta = toolsResult.toolCalls;
        } else {
          // Retry the LLM call once on failure before giving up.
          let callError: unknown;
          stepInput = {};
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              stepInput = await deps.provider.callStep(prompt, inputSchema);
              callError = undefined;
              break;
            } catch (err) {
              callError = err;
              console.warn(
                `  ⚠  LLM call attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
          if (callError !== undefined) {
            console.error(`\n✗ Step '${stepName}' LLM call failed after 2 attempts`);
            return 'failed';
          }
        }
      } else {
        // Auto step — the engine dispatches to the service adapter directly.
        console.log(`→ [auto] ${stepName}`);
        stepInput = {};
      }

      const result = await executeChain(deps.store, definition, {
        runId,
        command: stepName,
        input: stepInput,
        dispatcher: async () => stepInput,
        registry: deps.registry,
        ...(toolCallsForMeta !== undefined ? { stepMeta: { toolCalls: toolCallsForMeta } } : {}),
      });

      if (result.status === 'error') {
        console.error(`\n✗ Step '${stepName}' failed: ${result.errors.join(', ')}`);
        return 'failed';
      }

      if (result.status === 'confirm_required') {
        // Gate will be handled at the top of the next iteration.
        currentRun = await deps.store.get(runId);
        continue;
      }

      currentRun = await deps.store.get(runId);
      console.log(`  ✓ → ${currentRun.run_phase}`);
    }
  } finally {
    if (mcpClient) {
      await mcpClient.disconnect();
    }
  }

  if (currentRun.run_phase === 'completed') {
    console.log(`\nRun complete: ${runId}`);

    // Print the last agent step's output so the result is visible without
    // a separate `realm run inspect` call.
    const lastAgentEvidence = [...currentRun.evidence]
      .reverse()
      .find(
        (snapshot) =>
          snapshot.status === 'success' &&
          snapshot.kind !== 'gate_response' &&
          definition.steps[snapshot.step_id]?.execution === 'agent',
      );
    if (lastAgentEvidence !== undefined) {
      console.log(`\nResult (${lastAgentEvidence.step_id}):`);
      const stepDef = definition.steps[lastAgentEvidence.step_id];
      const formatted =
        stepDef?.display !== undefined
          ? renderDisplay(stepDef.display, lastAgentEvidence.output_summary)
          : formatOutputForTerminal(lastAgentEvidence.output_summary);
      console.log(formatted);
    }

    return 'completed';
  }

  console.error(`\nRun ended in phase: ${currentRun.run_phase}`);
  return 'failed';
}
