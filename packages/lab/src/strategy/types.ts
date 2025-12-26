/**
 * Strategy Graph Types
 *
 * Types for compiling YAML strategy definitions into executable decision graphs.
 */

/**
 * Comparison operators
 */
export type ComparisonOp = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'ne';

/**
 * Cross operators
 */
export type CrossOp = 'cross_up' | 'cross_down';

/**
 * Logical operators
 */
export type LogicalOp = 'all' | 'any';

/**
 * Graph node types
 */
export type GraphNodeType = 'comparison' | 'cross' | 'logical' | 'feature_ref';

/**
 * Base graph node
 */
export interface BaseGraphNode {
  id: string;
  type: GraphNodeType;
}

/**
 * Feature reference node (leaf)
 */
export interface FeatureRefNode extends BaseGraphNode {
  type: 'feature_ref';
  featureName: string; // e.g., 'ema_9', 'rsi_14'
  columnIndex?: number; // Pre-resolved column index for vectorized evaluation
}

/**
 * Comparison node
 */
export interface ComparisonNode extends BaseGraphNode {
  type: 'comparison';
  operator: ComparisonOp;
  left: GraphNode;
  right: GraphNode | number | string; // Can compare to feature or constant
}

/**
 * Cross node
 */
export interface CrossNode extends BaseGraphNode {
  type: 'cross';
  operator: CrossOp;
  left: GraphNode;
  right: GraphNode;
}

/**
 * Logical node (all/any)
 */
export interface LogicalNode extends BaseGraphNode {
  type: 'logical';
  operator: LogicalOp;
  children: GraphNode[];
}

/**
 * Graph node union type
 */
export type GraphNode = FeatureRefNode | ComparisonNode | CrossNode | LogicalNode;

/**
 * Strategy graph
 */
export interface StrategyGraph {
  entryNodes: GraphNode[];
  exitNodes: GraphNode[];
  /**
   * All feature names referenced in the graph (for validation)
   */
  featureNames: string[];
}

/**
 * YAML condition tree (input format)
 */
export type ConditionTree =
  | { all: ConditionTree[] }
  | { any: ConditionTree[] }
  | { gt: { a: string | number; b: string | number } }
  | { lt: { a: string | number; b: string | number } }
  | { gte: { a: string | number; b: string | number } }
  | { lte: { a: string | number; b: string | number } }
  | { eq: { a: string | number; b: string | number } }
  | { ne: { a: string | number; b: string | number } }
  | { cross_up: { a: string; b: string } }
  | { cross_down: { a: string; b: string } };
