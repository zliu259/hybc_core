import type { Edge, Node } from "@vue-flow/core";
import type {
  FlowNodeData,
  NodeType,
  TemplateConfig,
  TemplateNodeConfig
} from "./types";

const HORIZONTAL_GAP = 240;
const VERTICAL_GAP = 150;
const ORIGIN_X = 140;
const ORIGIN_Y = 60;

const NODE_NAMES: Record<NodeType, string> = {
  sequential: "顺序签",
  countersign: "会签",
  or_sign: "或签",
  auto: "自动",
  cc: "抄送",
  ai_gate: "AI关卡",
  start: "开始",
  end: "结束"
};

const VIRTUAL_START_ID = "start";
const VIRTUAL_END_ID = "end";

const isVirtualNode = (id: string, type: NodeType) => {
  return id === VIRTUAL_START_ID || id === VIRTUAL_END_ID || type === "start" || type === "end";
};

const collectNextKeys = (node: TemplateNodeConfig): string[] => {
  const output: string[] = [];
  if (typeof node.next_key === "string" && node.next_key) {
    output.push(node.next_key);
  }

  if (Array.isArray(node.conditions)) {
    for (const condition of node.conditions) {
      if (typeof condition.next_key === "string" && condition.next_key) {
        output.push(condition.next_key);
      }
    }
  }

  if (typeof node.default_next_key === "string" && node.default_next_key) {
    output.push(node.default_next_key);
  }

  return [...new Set(output)];
};

const toFlowNodeData = (node: TemplateNodeConfig): FlowNodeData => {
  return {
    key: node.key,
    type: node.type,
    name: node.name || NODE_NAMES[node.type] || node.key,
    assignees: node.assignee_userids ?? [],
    autoAction: node.auto_action,
    aiSlotId: node.ai_slot_id,
    timeoutHours: node.timeout_hours,
    nextKey: node.next_key,
    defaultNextKey: node.default_next_key,
    conditions: node.conditions
  };
};

const toTemplateNode = (
  node: Node<FlowNodeData>,
  nextKeys: string[]
): TemplateNodeConfig => {
  const normalizedNext = nextKeys.filter(key => key !== VIRTUAL_END_ID);
  const fallbackNext = normalizedNext[0] ?? null;
  const explicitNext = node.data.nextKey;

  return {
    key: node.id,
    type: node.data.type,
    name: node.data.name,
    assignee_userids: node.data.assignees,
    auto_action: node.data.autoAction,
    ai_slot_id: node.data.aiSlotId,
    timeout_hours: node.data.timeoutHours,
    conditions: node.data.conditions,
    default_next_key: node.data.defaultNextKey,
    next_key:
      typeof explicitNext === "string" || explicitNext === null
        ? explicitNext
        : fallbackNext
  };
};

const defaultGraph = (): { nodes: Node<FlowNodeData>[]; edges: Edge[] } => {
  const businessStartId = "node_start_1";
  const businessEndId = "node_end_1";

  const nodes: Node<FlowNodeData>[] = [
    {
      id: VIRTUAL_START_ID,
      type: "start",
      position: { x: ORIGIN_X + HORIZONTAL_GAP, y: ORIGIN_Y },
      data: { key: VIRTUAL_START_ID, type: "start", name: "开始", assignees: [] }
    },
    {
      id: businessStartId,
      type: "sequential",
      position: { x: ORIGIN_X + HORIZONTAL_GAP, y: ORIGIN_Y + VERTICAL_GAP },
      data: {
        key: businessStartId,
        type: "sequential",
        name: "流程发起",
        assignees: ["manager"],
        nextKey: businessEndId
      }
    },
    {
      id: businessEndId,
      type: "cc",
      position: { x: ORIGIN_X + HORIZONTAL_GAP, y: ORIGIN_Y + VERTICAL_GAP * 2 },
      data: {
        key: businessEndId,
        type: "cc",
        name: "抄送归档",
        assignees: ["finance_manager"],
        nextKey: null
      }
    },
    {
      id: VIRTUAL_END_ID,
      type: "end",
      position: { x: ORIGIN_X + HORIZONTAL_GAP, y: ORIGIN_Y + VERTICAL_GAP * 3 },
      data: { key: VIRTUAL_END_ID, type: "end", name: "结束", assignees: [] }
    }
  ];

  const edges: Edge[] = [
    { id: `edge-${VIRTUAL_START_ID}-${businessStartId}`, source: VIRTUAL_START_ID, target: businessStartId, type: "smoothstep" },
    { id: `edge-${businessStartId}-${businessEndId}`, source: businessStartId, target: businessEndId, type: "smoothstep" },
    { id: `edge-${businessEndId}-${VIRTUAL_END_ID}`, source: businessEndId, target: VIRTUAL_END_ID, type: "smoothstep" }
  ];

  return { nodes, edges };
};

export const graphToTemplate = (
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): TemplateConfig => {
  if (!nodes.length) {
    const fallback = defaultGraph();
    return graphToTemplate(fallback.nodes, fallback.edges);
  }

  const businessNodes = nodes.filter(node => !isVirtualNode(node.id, node.data.type));
  if (!businessNodes.length) {
    const fallback = defaultGraph();
    return graphToTemplate(fallback.nodes, fallback.edges);
  }

  const nodeIds = new Set(nodes.map(node => node.id));
  const nextMap = new Map<string, string[]>();
  nodes.forEach(node => nextMap.set(node.id, []));

  edges.forEach(edge => {
    if (!edge.source || !edge.target) return;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    const list = nextMap.get(edge.source);
    if (!list) return;
    if (!list.includes(edge.target)) {
      list.push(edge.target);
    }
  });

  const sortedBusinessNodes = [...businessNodes].sort((left, right) => {
    if (left.position.y === right.position.y) {
      return left.position.x - right.position.x;
    }
    return left.position.y - right.position.y;
  });

  let startKey = sortedBusinessNodes[0].id;
  const startEdges = nextMap.get(VIRTUAL_START_ID) ?? [];
  if (startEdges.length > 0 && businessNodes.some(node => node.id === startEdges[0])) {
    startKey = startEdges[0];
  }

  const templateNodes = sortedBusinessNodes.map(node => {
    const outbound = (nextMap.get(node.id) ?? []).filter(target => target !== VIRTUAL_END_ID);
    return toTemplateNode(node, outbound);
  });

  return {
    version: 1,
    start_key: startKey,
    nodes: templateNodes
  };
};

export const templateToGraph = (
  config: TemplateConfig
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } => {
  if (!config || !Array.isArray(config.nodes) || !config.nodes.length) {
    return defaultGraph();
  }

  const nodeMap = new Map<string, TemplateNodeConfig>();
  config.nodes.forEach(item => {
    nodeMap.set(item.key, {
      ...item,
      conditions: item.conditions ?? []
    });
  });

  const startKey = nodeMap.has(config.start_key) ? config.start_key : config.nodes[0].key;

  const levelMap = new Map<string, number>();
  const queue: string[] = [startKey];
  const visited = new Set<string>();
  levelMap.set(startKey, 0);

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key) continue;
    if (visited.has(key)) continue;
    visited.add(key);

    const current = nodeMap.get(key);
    const currentLevel = levelMap.get(key) ?? 0;
    if (!current) continue;

    collectNextKeys(current).forEach(nextKey => {
      if (!nodeMap.has(nextKey)) return;

      const nextLevel = currentLevel + 1;
      const prevLevel = levelMap.get(nextKey);
      if (prevLevel === undefined || nextLevel > prevLevel) {
        levelMap.set(nextKey, nextLevel);
      }

      if (!queue.includes(nextKey)) {
        queue.push(nextKey);
      }
    });
  }

  let maxLevel = 0;
  nodeMap.forEach((_item, key) => {
    const level = levelMap.get(key);
    if (level !== undefined) {
      maxLevel = Math.max(maxLevel, level);
      return;
    }
    maxLevel += 1;
    levelMap.set(key, maxLevel);
  });

  const lanes = new Map<number, number>();
  const businessNodes = [...nodeMap.values()]
    .sort((left, right) => {
      const leftLevel = levelMap.get(left.key) ?? 0;
      const rightLevel = levelMap.get(right.key) ?? 0;
      if (leftLevel === rightLevel) {
        return left.key.localeCompare(right.key);
      }
      return leftLevel - rightLevel;
    })
    .map(item => {
      const level = levelMap.get(item.key) ?? 0;
      const lane = lanes.get(level) ?? 0;
      lanes.set(level, lane + 1);

      return {
        id: item.key,
        type: item.type,
        position: {
          x: ORIGIN_X + lane * HORIZONTAL_GAP,
          y: ORIGIN_Y + VERTICAL_GAP + level * VERTICAL_GAP
        },
        data: toFlowNodeData(item)
      } satisfies Node<FlowNodeData>;
    });

  const startNode: Node<FlowNodeData> = {
    id: VIRTUAL_START_ID,
    type: "start",
    position: { x: ORIGIN_X + HORIZONTAL_GAP, y: ORIGIN_Y },
    data: { key: VIRTUAL_START_ID, type: "start", name: "开始", assignees: [] }
  };

  const endLevel = Math.max(...Array.from(levelMap.values(), level => level), 0) + 2;
  const endNode: Node<FlowNodeData> = {
    id: VIRTUAL_END_ID,
    type: "end",
    position: {
      x: ORIGIN_X + HORIZONTAL_GAP,
      y: ORIGIN_Y + endLevel * VERTICAL_GAP
    },
    data: { key: VIRTUAL_END_ID, type: "end", name: "结束", assignees: [] }
  };

  const edges: Edge[] = [];
  edges.push({
    id: `edge-${VIRTUAL_START_ID}-${startKey}`,
    source: VIRTUAL_START_ID,
    target: startKey,
    type: "smoothstep"
  });

  nodeMap.forEach(item => {
    const nextKeys = collectNextKeys(item);
    if (nextKeys.length === 0) {
      edges.push({
        id: `edge-${item.key}-${VIRTUAL_END_ID}`,
        source: item.key,
        target: VIRTUAL_END_ID,
        type: "smoothstep"
      });
      return;
    }

    nextKeys.forEach(nextKey => {
      if (!nodeMap.has(nextKey)) {
        return;
      }
      edges.push({
        id: `edge-${item.key}-${nextKey}`,
        source: item.key,
        target: nextKey,
        type: "smoothstep"
      });
    });
  });

  return {
    nodes: [startNode, ...businessNodes, endNode],
    edges
  };
};
