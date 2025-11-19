// FlowBuilder.tsx
import { useCallback, useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Connection,
  Controls,
  Background,
  MiniMap,
  BackgroundVariant,
  NodeChange,
  EdgeChange,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';

import EmailBlockNode from './EmailBlockNode';
import UndoRedoControls from './UndoRedoControls';
import useUndoRedo from '@/react-app/hooks/useUndoRedo';
import { EmailBlock, Connection as DBConnection, BLOCK_TYPE_CONFIG, CONDITION_TYPE_CONFIG } from '@/shared/types';

// nodeTypes is stable and defined once (outside component) to avoid ReactFlow remount warnings
const nodeTypes = {
  emailBlock: EmailBlockNode,
};

interface FlowBuilderProps {
  blocks: EmailBlock[];
  connections: DBConnection[];
  onUpdateBlock: (blockId: string, updates: { position_x: number; position_y: number }) => void;
  onEditBlock: (block: EmailBlock) => void;
  onDeleteBlock: (blockId: string) => void;
  onDuplicateBlock: (block: EmailBlock) => void;
  onCreateConnection: (sourceId: string, targetId: string) => void;
  onDeleteConnection: (connectionId: string) => void;
}

interface FlowState {
  blocks: EmailBlock[];
  connections: DBConnection[];
}

export default function FlowBuilder({
  blocks,
  connections,
  onUpdateBlock,
  onEditBlock,
  onDeleteBlock,
  onDuplicateBlock,
  onCreateConnection,
  onDeleteConnection,
}: FlowBuilderProps) {
  // Initialize undo/redo state (single source of truth)
  const {
    state: flowState,
    setState: setFlowState,
    replacePresent,
    doUndo,
    doRedo,
    canUndo,
    canRedo,
    reset,
    hasUnsavedChanges,
    markAsSaved,
  } = useUndoRedo<FlowState>({
    blocks: blocks || [],
    connections: connections || [],
  });

  // flag while we are applying history snapshots (prevent backend sync)
  const isApplyingHistoryRef = useRef(false);

  // additional guard: ignore parent->hook sync until this timestamp (ms since epoch)
  const suppressParentSyncUntilRef = useRef<number>(0);

  // previous counts to detect parent-originated changes
  const prevBlockCountRef = useRef<number>(0);
  const prevConnectionCountRef = useRef<number>(0);
  const initializedRef = useRef(false);

  // --- pending-delete machinery so undo can cancel server deletes ---
  const pendingDeletesRef = useRef<Record<string, number>>({});
  const SCHEDULE_DELETE_MS = 3000; // 3s undo window

  const scheduleDelete = useCallback((blockId: string) => {
    if (pendingDeletesRef.current[blockId]) return; // already scheduled
    const t = window.setTimeout(() => {
      delete pendingDeletesRef.current[blockId];
      // only call backend if not currently replaying undo/redo
      if (!isApplyingHistoryRef.current) {
        console.log('[FlowBuilder] executing scheduled backend delete', blockId);
        onDeleteBlock(blockId);
      } else {
        console.log('[FlowBuilder] skipped scheduled backend delete (applying history)', blockId);
      }
    }, SCHEDULE_DELETE_MS);
    pendingDeletesRef.current[blockId] = t as unknown as number;
    console.log('[FlowBuilder] scheduled backend delete for', blockId, 'in', SCHEDULE_DELETE_MS, 'ms');
  }, [onDeleteBlock]);

  const cancelDelete = useCallback((blockId: string) => {
    const t = pendingDeletesRef.current[blockId];
    if (t) {
      clearTimeout(t);
      delete pendingDeletesRef.current[blockId];
      console.log('[FlowBuilder] canceled pending delete for', blockId);
    }
  }, []);

  // configurable suppression duration after undo/redo (ms)
  const UNDO_REPLAY_SUPPRESSION_MS = 800;

  // cleanup pending timers on unmount
  useEffect(() => {
    return () => {
      Object.values(pendingDeletesRef.current).forEach((tid) => clearTimeout(tid));
      pendingDeletesRef.current = {};
    };
  }, []);

  useEffect(() => {
    const now = Date.now();

    if (isApplyingHistoryRef.current || now < suppressParentSyncUntilRef.current) {
      console.log('[FlowBuilder] skipping parent->hook sync (applying history or suppression window)', {
        isApplyingHistory: isApplyingHistoryRef.current,
        now,
        suppressUntil: suppressParentSyncUntilRef.current,
      });
      return;
    }

    const isInitialLoad = !initializedRef.current;
    const currentBlockCount = blocks?.length || 0;
    const currentConnectionCount = connections?.length || 0;

    if (isInitialLoad) {
      const newState = {
        blocks: blocks || [],
        connections: connections || [],
      };
      console.log('[FlowBuilder] initial reset -> blocks:', newState.blocks.length, 'conns:', newState.connections.length);
      reset(newState);
      prevBlockCountRef.current = currentBlockCount;
      prevConnectionCountRef.current = currentConnectionCount;
      initializedRef.current = true;
      return;
    }

    const blocksChanged = currentBlockCount !== prevBlockCountRef.current;
    const connectionsChanged = currentConnectionCount !== prevConnectionCountRef.current;
    const blockContentChanged =
      !blocksChanged &&
      blocks &&
      flowState.blocks &&
      JSON.stringify(blocks) !== JSON.stringify(flowState.blocks);

    if (blocksChanged || connectionsChanged || blockContentChanged) {
      console.log('[FlowBuilder] parent -> replacePresent (server truth)', { blocksChanged, connectionsChanged, blockContentChanged });
      const replaceFn = typeof replacePresent === 'function' ? replacePresent : setFlowState;
      replaceFn({ blocks: blocks || [], connections: connections || [] });
      // Parent is authoritative now — clear "unsaved" marker
      try {
        if (typeof markAsSaved === 'function') markAsSaved();
      } catch (e) {
        /* ignore */
      }
      prevBlockCountRef.current = currentBlockCount;
      prevConnectionCountRef.current = currentConnectionCount;
    }
  }, [blocks, connections, reset, setFlowState, flowState.blocks, flowState.connections, replacePresent, markAsSaved]);


  // Derived arrays for rendering (memoized)
  const currentBlocks = useMemo(() => flowState.blocks || [], [flowState.blocks]);
  const currentConnections = useMemo(() => flowState.connections || [], [flowState.connections]);

  // Debug render summary
  console.log('[FlowBuilder] render -> nodes:', currentBlocks.length, 'edges:', currentConnections.length);

  // ------------------ Handlers (defined before nodes/edges to keep stable refs) ------------------

  // Delete a block (updates hook and optionally calls backend)
  const handleDeleteBlock = useCallback((blockId: string) => {
    // remove from UI immediately (this will push a history snapshot via hook setState)
    setFlowState((prev) => {
      const next = {
        blocks: prev.blocks.filter((b) => b.id !== blockId),
        connections: prev.connections.filter((c) => c.source_block_id !== blockId && c.target_block_id !== blockId),
      };
      console.log('[FlowBuilder] handleDeleteBlock -> optimistic setFlowState', { blockId, nextBlocks: next.blocks.length, nextConns: next.connections.length });
      return next;
    });

    // schedule server delete (gives short window to undo)
    scheduleDelete(blockId);
  }, [setFlowState, scheduleDelete]);


  // Delete a connection (updates hook and optionally calls backend)
  const handleDeleteConnection = useCallback((connectionId: string) => {
    setFlowState((prev) => {
      const next = { ...prev, connections: prev.connections.filter((c) => c.id !== connectionId) };
      console.log('[FlowBuilder] handleDeleteConnection -> setFlowState', { connectionId, nextConns: next.connections.length });
      return next;
    });

    if (!isApplyingHistoryRef.current) {
      console.log('[FlowBuilder] handleDeleteConnection -> calling onDeleteConnection', connectionId);
      onDeleteConnection(connectionId);
    } else {
      console.log('[FlowBuilder] handleDeleteConnection -> suppressed backend sync (applying history)');
    }
  }, [setFlowState, onDeleteConnection]);

  // Apply Undo
  const handleUndo = useCallback(() => {
    console.log('[FlowBuilder] handleUndo called');
    isApplyingHistoryRef.current = true;
    suppressParentSyncUntilRef.current = Date.now() + UNDO_REPLAY_SUPPRESSION_MS;

    const restored = doUndo();
    console.log('[FlowBuilder] doUndo returned ->', !!restored);

    // If restored snapshot contains blocks that had pending deletes, cancel them:
    if (restored && Array.isArray(restored.blocks)) {
      const restoredIds = new Set(restored.blocks.map(b => b.id));
      Object.keys(pendingDeletesRef.current).forEach(pid => {
        if (restoredIds.has(pid)) cancelDelete(pid);
      });
    }

    setTimeout(() => {
      isApplyingHistoryRef.current = false;
      console.log('[FlowBuilder] undo suppression cleared');
    }, UNDO_REPLAY_SUPPRESSION_MS + 20);
  }, [doUndo, cancelDelete]);


  // Apply Redo
  const handleRedo = useCallback(() => {
    console.log('[FlowBuilder] handleRedo called');
    isApplyingHistoryRef.current = true;
    suppressParentSyncUntilRef.current = Date.now() + UNDO_REPLAY_SUPPRESSION_MS;

    const restored = doRedo();
    console.log('[FlowBuilder] doRedo returned ->', !!restored);

    if (restored && Array.isArray(restored.blocks)) {
      const restoredIds = new Set(restored.blocks.map(b => b.id));
      Object.keys(pendingDeletesRef.current).forEach(pid => {
        if (restoredIds.has(pid)) cancelDelete(pid);
      });
    }

    setTimeout(() => {
      isApplyingHistoryRef.current = false;
      console.log('[FlowBuilder] redo suppression cleared');
    }, UNDO_REPLAY_SUPPRESSION_MS + 20);
  }, [doRedo, cancelDelete]);


  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (canUndo) handleUndo();
      }
      if (((event.ctrlKey || event.metaKey) && event.key === 'y') || ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Z')) {
        event.preventDefault();
        if (canRedo) handleRedo();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, canUndo, canRedo]);

  // Node drag stop — update flowState and call backend (unless replaying history)
  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    const oldBlock = currentBlocks.find((b) => b.id === node.id);
    const oldPos = oldBlock ? { x: oldBlock.position_x, y: oldBlock.position_y } : undefined;
    const newPos = { x: Math.round(node.position.x), y: Math.round(node.position.y) };

    console.log('[FlowBuilder] onNodeDragStop -> oldPos:', oldPos, 'newPos:', newPos);

    setFlowState((prev) => {
      const next = { ...prev, blocks: prev.blocks.map((b) => (b.id === node.id ? { ...b, position_x: newPos.x, position_y: newPos.y } : b)) };
      return next;
    });

    if (!isApplyingHistoryRef.current) {
      console.log('[FlowBuilder] onNodeDragStop -> calling onUpdateBlock', node.id, newPos);
      onUpdateBlock(node.id, { position_x: newPos.x, position_y: newPos.y });
    } else {
      console.log('[FlowBuilder] onNodeDragStop -> suppressed backend sync (applying history)');
    }
  }, [setFlowState, onUpdateBlock, currentBlocks]);

  // Connection creation (optimistic UI)
  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target) return;

    // safe check for crypto.randomUUID without using "any"
    const hasRandomUUID = typeof crypto !== 'undefined' && typeof (crypto as unknown as { randomUUID?: () => string }).randomUUID === 'function';
    const tempId = hasRandomUUID ? (crypto as unknown as { randomUUID: () => string }).randomUUID() : `temp-${Date.now()}`;

    const newConn: DBConnection = {
      id: tempId,
      sequence_id: '',
      source_block_id: params.source,
      target_block_id: params.target,
      condition_type: 'default',
      custom_label: undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    console.log('[FlowBuilder] onConnect -> optimistic add', { source: params.source, target: params.target, tempId });

    setFlowState((prev) => ({ ...prev, connections: [...prev.connections, newConn] }));

    if (!isApplyingHistoryRef.current) {
      console.log('[FlowBuilder] onConnect -> calling onCreateConnection', params.source, params.target);
      onCreateConnection(params.source, params.target);
    } else {
      console.log('[FlowBuilder] onConnect -> suppressed backend sync (applying history)');
    }
  }, [setFlowState, onCreateConnection]);

  // Edge double-click delete
  const onEdgeDoubleClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    console.log('[FlowBuilder] onEdgeDoubleClick -> deleting edge', edge.id);
    handleDeleteConnection(edge.id);
  }, [handleDeleteConnection]);

  // ------------------ Build nodes and edges for ReactFlow ------------------
  const nodes: Node[] = useMemo(() =>
    currentBlocks.map((block) => {
      const latestBlock = blocks.find((b) => b.id === block.id) || block;
      return {
        id: block.id,
        type: 'emailBlock',
        position: { x: block.position_x, y: block.position_y },
        data: {
          ...latestBlock,
          position_x: block.position_x,
          position_y: block.position_y,
          onEdit: onEditBlock,
          onDelete: handleDeleteBlock,
          onDuplicate: onDuplicateBlock,
        },
      };
    }),
    [currentBlocks, blocks, onEditBlock, handleDeleteBlock, onDuplicateBlock]
  );

  const edges: Edge[] = useMemo(() =>
    currentConnections.map((connection) => {
      const conditionConfig = CONDITION_TYPE_CONFIG[connection.condition_type as keyof typeof CONDITION_TYPE_CONFIG];
      let displayLabel: string | undefined = undefined;
      if (connection.custom_label?.trim()) displayLabel = connection.custom_label.trim();
      else if (connection.condition_type !== 'default') displayLabel = conditionConfig?.label || connection.condition_type;

      return {
        id: connection.id,
        source: connection.source_block_id,
        target: connection.target_block_id,
        type: 'smoothstep',
        animated: connection.condition_type !== 'default' || !!connection.custom_label,
        style: {
          stroke: connection.custom_label ? '#8b5cf6' :
            connection.condition_type === 'default' ? '#6366f1' :
              connection.condition_type.includes('not') ? '#ef4444' : '#10b981',
          strokeWidth: 2,
        },
        label: displayLabel,
        labelStyle: { fontSize: 11, fontWeight: 500, color: connection.custom_label ? '#8b5cf6' : conditionConfig?.color || '#6b7280' },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9, rx: 4, ry: 4 },
      };
    }),
    [currentConnections]
  );

  // --- ReactFlow controlled local state (smooth dragging) ---
  const [reactFlowNodes, setNodes, onNodesChange] = useNodesState(nodes);
  const [reactFlowEdges, setEdges, onEdgesChange] = useEdgesState(edges);

  useEffect(() => {
    setNodes(nodes);
  }, [nodes, setNodes]);

  useEffect(() => {
    setEdges(edges);
  }, [edges, setEdges]);


  // Minimap color helper (memoized with callback)
  const getMiniMapNodeColor = useCallback((node: Node) => {
    const block = currentBlocks.find((b) => b.id === node.id);
    if (!block) return '#6b7280';
    const config = BLOCK_TYPE_CONFIG[block.type];
    return config.borderColor.includes('blue') ? '#3b82f6' :
      config.borderColor.includes('green') ? '#10b981' :
        config.borderColor.includes('purple') ? '#8b5cf6' :
          config.borderColor.includes('orange') ? '#f59e0b' :
            config.borderColor.includes('red') ? '#ef4444' :
              config.borderColor.includes('yellow') ? '#eab308' :
                config.borderColor.includes('pink') ? '#ec4899' : '#6b7280';
  }, [currentBlocks]);

  // ------------------ Render ------------------
  return (
    <div className="flex-1 h-full bg-gray-50">
      <ReactFlow
        nodes={reactFlowNodes}
        edges={reactFlowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onEdgeDoubleClick={onEdgeDoubleClick}
        nodeTypes={nodeTypes}
        fitView={currentBlocks.length === 0}
        fitViewOptions={{ padding: 50 }}
        minZoom={0.1}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
        connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 2 }}
        snapToGrid
        snapGrid={[20, 20]}
      >
        <div className="absolute top-4 left-4 z-10">
          <UndoRedoControls
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            hasUnsavedChanges={hasUnsavedChanges}
          />
        </div>

        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />

        <Controls showZoom showFitView showInteractive position="bottom-right" className="bg-white border border-gray-200 rounded-lg shadow-lg" />

        <MiniMap nodeColor={getMiniMapNodeColor} nodeStrokeWidth={3} pannable zoomable position="top-right" className="bg-white border border-gray-200 rounded-lg shadow-lg" />
      </ReactFlow>

      {/* Instructions overlay */}
      {currentBlocks.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center p-8 bg-white rounded-2xl shadow-lg border-2 border-dashed border-gray-300 max-w-md">
            <div className="text-6xl mb-4">📧</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Start Building Your Email Sequence</h3>
            <p className="text-gray-600 mb-4">Click on email blocks in the sidebar to add them to your flow. Connect them by dragging from the bottom handle to create your sequence.</p>
            <div className="text-sm text-gray-500 space-y-1">
              <p>💡 Tip: Double-click blocks to edit their content</p>
              <p>💡 Tip: Double-click connections to delete them</p>
              <p>💡 Tip: Drag to connect blocks together</p>
              <p>💡 Tip: Drag blocks to rearrange them</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
