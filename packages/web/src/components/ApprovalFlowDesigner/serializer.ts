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

const defaultGraph = (): { nodes: Node<FlowNodeData>[]; edges: Edge[] } => {
  const nodes: Node<FlowNodeData>[] = [
    {
      id: "start",
      type: "start",
      position: { x: ORIGIN_X + HORIZONTAL_GAP, y: ORIGIN_Y },
      data: {
        key: "start",
        type: "start",
        name: "开始",
        assignees: []
      }
    },
    {
      id: "end",
      type: "end",
      position: { x: ORIGIN_X + HORIZONTAL_GAP, y: ORIGIN_Y + VERTICAL_GAP },
      data: {
        key: "end",
        type: "end",
        name: "结束",
        assignees: []
      }
    }
  ];

  const edges: Edge[] = [
    {
      id: "edge-start-end",
      source: "start",
      target: "end",
      type: "smoothstep"
    }
  ];

  return { nodes, edges };
};

const toFlowNodeData = (node: TemplateNodeConfig): FlowNodeData => {
  return {
    key: node.key,
    type: node.node_type,
    name: node.name || NODE_NAMES[node.node_type] || node.key,
    assignees: node.assignee_userids ?? [],
    autoAction: node.auto_action,
    aiSlotId: node.ai_slot_id,
    timeoutHours: node.timeout_hours
  };
};

const toTemplateNode = (
  node: Node<FlowNodeData>,
  nextKeys: string[]
): TemplateNodeConfig => {
  return {
    key: node.id,
    node_type: node.data.type,
    name: node.data.name,
    assignee_userids: node.data.assignees,
    auto_action: node.data.autoAction,
    ai_slot_id: node.data.aiSlotId,
    timeout_hours: node.data.timeoutHours,
    next_keys: nextKeys
  };
};

const normalizeTemplate = (config: TemplateConfig): TemplateConfig => {
  const normalizedNodes = Array.isArray(config.nodes) ? config.nodes : [];
  const hasStart = normalizedNodes.some(item => item.node_type === "start");
  const hasEnd = normalizedNodes.some(item => item.node_type === "end");

  const nodes: TemplateNodeConfig[] = [...normalizedNodes];

  if (!hasStart) {
    nodes.push({
      key: "start",
      node_type: "start",
      name: "开始",
      next_keys: ["end"]
    });
  }

  if (!hasEnd) {
    nodes.push({
      key: "end",
      node_type: "end",
      name: "结束",
      next_keys: []
    });
  }

  return {
    version: Number.isFinite(config.version) ? config.version : 1,
    start_key: config.start_key || "start",
    nodes
  };
};

export const graphToTemplate = (
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): TemplateConfig => {
  if (!nodes.length) {
    const fallback = defaultGraph();
    return graphToTemplate(fallback.nodes, fallback.edges);
  }

  const nodeIds = new Set(nodes.map(node => node.id));
  const nextMap = new Map<string, string[]>();

  nodes.forEach(node => {
    nextMap.set(node.id, []);
  });

  edges.forEach(edge => {
    if (!edge.source || !edge.target) {
      return;
    }

    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return;
    }

    const list = nextMap.get(edge.source);
    if (!list) {
      return;
    }

    if (!list.includes(edge.target)) {
      list.push(edge.target);
    }
  });

  const sortedNodes = [...nodes].sort((left, right) => {
    if (left.position.y === right.position.y) {
      return left.position.x - right.position.x;
    }
    return left.position.y - right.position.y;
  });

  const templateNodes = sortedNodes.map(node => {
    const nextKeys = nextMap.get(node.id) ?? [];
    return toTemplateNode(node, nextKeys);
  });

  const startNode =
    nodes.find(node => node.data.type === "start") ||
    nodes.find(node => node.id === "start") ||
    nodes[0];

  return {
    version: 1,
    start_key: startNode.id,
    nodes: templateNodes
  };
};

export const templateToGraph = (
  config: TemplateConfig
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } => {
  if (!config || !Array.isArray(config.nodes) || !config.nodes.length) {
    return defaultGraph();
  }

  const normalized = normalizeTemplate(config);
  const nodeMap = new Map<string, TemplateNodeConfig>();
  normalized.nodes.forEach(item => {
    nodeMap.set(item.key, {
      ...item,
      next_keys: item.next_keys ?? []
    });
  });

  const startKey = nodeMap.has(normalized.start_key)
    ? normalized.start_key
    : "start";

  const levelMap = new Map<string, number>();
  const queue: string[] = [startKey];
  levelMap.set(startKey, 0);

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key) {
      continue;
    }

    const current = nodeMap.get(key);
    const currentLevel = levelMap.get(key) ?? 0;
    if (!current) {
      continue;
    }

    current.next_keys.forEach(nextKey => {
      if (!nodeMap.has(nextKey)) {
        return;
      }

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
  const nodes = [...nodeMap.values()]
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
        type: item.node_type,
        position: {
          x: ORIGIN_X + lane * HORIZONTAL_GAP,
          y: ORIGIN_Y + level * VERTICAL_GAP
        },
        data: toFlowNodeData(item)
      } satisfies Node<FlowNodeData>;
    });

  const edges: Edge[] = [];
  nodeMap.forEach(item => {
    item.next_keys.forEach(nextKey => {
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

  return { nodes, edges };
};
