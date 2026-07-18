import {AgentAuth} from '@kinde-oss/kinde-convex-agent-auth';
import {components} from './_generated/api';

/**
 * The app's handle on the mounted agent-auth component. Everything the host app
 * does with the component (register agents, verify callers, start instances,
 * authorize actions) goes through this client.
 *
 * The component's own functions are unauthenticated machinery — the host app is
 * the security boundary. So this client is only ever used from host wrappers
 * that authenticate first: `internalMutation`/`internalAction` for provisioning,
 * and (in later phases) app-authenticated actions for the agent-facing surface.
 */
export const agentAuth = new AgentAuth(components.agentAuth);
