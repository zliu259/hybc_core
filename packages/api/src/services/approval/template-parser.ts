import type {
  NodeType,
  TemplateConfig,
  TemplateNodeConfig,
  RouteContext
} from "../../types/approval";

// ─── Parsed Types ──────────

export interface ParsedNode {
  key: string;
  type: NodeType;
  name: string;
  config: TemplateNodeConfig;
  nextKeys: string[];
}

export interface ParsedTemplate {
  nodes: Map<string, ParsedNode>;
  startKey: string;
  nodeOrder: string[];
}

// ─── Parser ──────────

/**
 * Parse and validate a JSON template config string into a navigable ParsedTemplate.
 * Throws on invalid config.
 */
export const parseTemplate = (configJson: string): ParsedTemplate => {
  let config: TemplateConfig;
  try {
    config = JSON.parse(configJson) as TemplateConfig;
  } catch {
    throw new Error("Invalid JSON in template config");
  }

  if (!config.version || !config.nodes || !config.start_key) {
    throw new Error("Template config missing required fields: version, nodes, start_key");
  }

  const nodesMap = new Map<string, ParsedNode>();
  const keys = new Set<string>();

  // Build node map
  for (const nodeConfig of config.nodes) {
    if (!nodeConfig.key || !nodeConfig.type || !nodeConfig.name) {
      throw new Error(`Node missing required fields (key, type, name)`);
    }

    if (keys.has(nodeConfig.key)) {
      throw new Error(`Duplicate node key: ${nodeConfig.key}`);
    }
    keys.add(nodeConfig.key);

    // Validate node type requirements
    if (
      (nodeConfig.type === "sequential" ||
        nodeConfig.type === "countersign" ||
        nodeConfig.type === "or_sign") &&
      !nodeConfig.assignee_userids?.length &&
      !nodeConfig.assignee_rule
    ) {
      throw new Error(
        `Node "${nodeConfig.key}" (${nodeConfig.type}) requires assignee_userids or assignee_rule`
      );
    }

    if (nodeConfig.type === "ai_gate" && !nodeConfig.ai_slot_id) {
      throw new Error(`Node "${nodeConfig.key}" (ai_gate) requires ai_slot_id`);
    }

    // Collect next keys
    const nextKeys: string[] = [];
    if (nodeConfig.next_key !== undefined && nodeConfig.next_key !== null) {
      nextKeys.push(nodeConfig.next_key);
    }
    if (nodeConfig.conditions) {
      for (const cond of nodeConfig.conditions) {
        if (cond.next_key) {
          nextKeys.push(cond.next_key);
        }
      }
      if (nodeConfig.default_next_key) {
        nextKeys.push(nodeConfig.default_next_key);
      }
    }

    nodesMap.set(nodeConfig.key, {
      key: nodeConfig.key,
      type: nodeConfig.type,
      name: nodeConfig.name,
      config: nodeConfig,
      nextKeys
    });
  }

  // Validate start_key exists
  if (!nodesMap.has(config.start_key)) {
    throw new Error(`start_key "${config.start_key}" not found in nodes`);
  }

  // Validate all referenced next_keys exist
  for (const [key, node] of nodesMap) {
    for (const nextKey of node.nextKeys) {
      if (!nodesMap.has(nextKey)) {
        throw new Error(`Node "${key}" references unknown next_key: "${nextKey}"`);
      }
    }
  }

  // BFS to check reachability from start_key
  const visited = new Set<string>();
  const queue = [config.start_key];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = nodesMap.get(current);
    if (node) {
      for (const nextKey of node.nextKeys) {
        if (!visited.has(nextKey)) {
          queue.push(nextKey);
        }
      }
    }
  }

  // Check for orphan nodes
  for (const key of nodesMap.keys()) {
    if (!visited.has(key)) {
      throw new Error(`Orphan node "${key}" is not reachable from start_key`);
    }
  }

  // Build topological order (BFS order from start)
  const nodeOrder = Array.from(visited);

  return {
    nodes: nodesMap,
    startKey: config.start_key,
    nodeOrder
  };
};

/**
 * Determine the next node key based on conditions and context.
 * Returns null if this is the end of the chain.
 */
export const getNextNodeKey = (
  node: ParsedNode,
  context: RouteContext
): string | null => {
  // If explicit next_key is set (linear chain)
  if (node.config.next_key !== undefined) {
    return node.config.next_key;
  }

  // If conditional branches exist
  if (node.config.conditions && node.config.conditions.length > 0) {
    for (const cond of node.config.conditions) {
      const fieldValue = context[cond.field];
      if (fieldValue !== undefined && evaluateCondition(fieldValue, cond.operator, cond.value)) {
        return cond.next_key;
      }
    }
    // Fallback to default
    return node.config.default_next_key ?? null;
  }

  // No next_key defined → end of chain
  return null;
};

/**
 * Validate a template config string without throwing.
 * Returns { valid, errors } for UI feedback.
 */
export const validateTemplate = (
  configJson: string
): { valid: boolean; errors: string[] } => {
  try {
    parseTemplate(configJson);
    return { valid: true, errors: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [message] };
  }
};

// ─── Internal Helpers ──────────

const evaluateCondition = (
  fieldValue: unknown,
  operator: string,
  condValue: unknown
): boolean => {
  const numField = Number(fieldValue);
  const numCond = Number(condValue);

  if (Number.isNaN(numField) || Number.isNaN(numCond)) {
    // String comparison for non-numeric
    return String(fieldValue) === String(condValue);
  }

  switch (operator) {
    case "gt":
      return numField > numCond;
    case "gte":
      return numField >= numCond;
    case "lt":
      return numField < numCond;
    case "lte":
      return numField <= numCond;
    case "eq":
      return numField === numCond;
    case "between": {
      // condValue should be lower bound; we can't access upper here
      // "between" is handled at threshold level, not condition level
      return numField >= numCond;
    }
    default:
      return false;
  }
};
