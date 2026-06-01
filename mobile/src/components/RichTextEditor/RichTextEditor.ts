// Native span-based rich text layout engine — replaces contenteditable
export type InlineStyle = 'bold' | 'italic' | 'underline';

export interface TextSpan {
  id: string;
  text: string;
  styles: Set<InlineStyle>;
}

export interface BlockNode {
  id: string;
  type: 'paragraph' | 'blockquote';
  spans: TextSpan[];
  children?: BlockNode[];   // nested blockquote support
}

export interface CursorPosition {
  blockId: string;
  spanId: string;
  offset: number;
  timestamp: number;  // telemetry
}

export interface EditorState {
  blocks: BlockNode[];
  cursor: CursorPosition | null;
}

let _spanCounter = 0;
let _blockCounter = 0;
const nextSpanId  = () => `span-${++_spanCounter}`;
const nextBlockId = () => `block-${++_blockCounter}`;

export function createEditor(): EditorState {
  return { blocks: [], cursor: null };
}

export function insertBlock(state: EditorState, type: BlockNode['type']): EditorState {
  return { ...state, blocks: [...state.blocks, { id: nextBlockId(), type, spans: [] }] };
}

export function insertSpan(
  state: EditorState,
  blockId: string,
  text: string,
  styles: InlineStyle[] = [],
): EditorState {
  const span: TextSpan = { id: nextSpanId(), text, styles: new Set(styles) };
  return {
    ...state,
    blocks: state.blocks.map(b =>
      b.id === blockId ? { ...b, spans: [...b.spans, span] } : b,
    ),
  };
}

// Nest a blockquote inside a parent block at the text-system level
export function nestBlockquote(state: EditorState, parentId: string): EditorState {
  const child: BlockNode = { id: nextBlockId(), type: 'blockquote', spans: [] };
  return {
    ...state,
    blocks: state.blocks.map(b =>
      b.id === parentId ? { ...b, children: [...(b.children ?? []), child] } : b,
    ),
  };
}

// Record cursor position for telemetry
export function moveCursor(
  state: EditorState,
  blockId: string,
  spanId: string,
  offset: number,
): EditorState {
  return { ...state, cursor: { blockId, spanId, offset, timestamp: Date.now() } };
}

export function serializeToText(state: EditorState): string {
  function renderBlock(block: BlockNode): string {
    const text = block.spans.map(s => s.text).join('');
    const nested = (block.children ?? []).map(renderBlock).join('\n');
    return nested ? `${text}\n${nested}` : text;
  }
  return state.blocks.map(renderBlock).join('\n');
}
