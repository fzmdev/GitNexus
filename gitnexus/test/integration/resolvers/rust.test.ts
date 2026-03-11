/**
 * Rust: trait implementations + ambiguous module import disambiguation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Heritage: trait implementations
// ---------------------------------------------------------------------------

describe('Rust trait implementation resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'rust-traits'),
      () => {},
    );
  }, 60000);

  it('detects exactly 1 struct and 2 traits', () => {
    expect(getNodesByLabel(result, 'Struct')).toEqual(['Button']);
    expect(getNodesByLabel(result, 'Trait')).toEqual(['Clickable', 'Drawable']);
  });

  it('emits exactly 2 IMPLEMENTS edges with reason trait-impl', () => {
    const implements_ = getRelationships(result, 'IMPLEMENTS');
    expect(implements_.length).toBe(2);
    expect(edgeSet(implements_)).toEqual([
      'Button → Clickable',
      'Button → Drawable',
    ]);
    for (const edge of implements_) {
      expect(edge.rel.reason).toBe('trait-impl');
    }
  });

  it('does not emit any EXTENDS edges for trait impls', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(0);
  });

  it('resolves exactly 1 IMPORTS edge: main.rs → button.rs', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(1);
    expect(imports[0].source).toBe('main.rs');
    expect(imports[0].target).toBe('button.rs');
  });

  it('detects 2 modules and 4 functions', () => {
    expect(getNodesByLabel(result, 'Module')).toEqual(['impls', 'traits']);
    expect(getNodesByLabel(result, 'Function')).toEqual(['draw', 'is_enabled', 'main', 'on_click', 'resize']);
  });
});

// ---------------------------------------------------------------------------
// Ambiguous: Handler struct in two modules, crate:: import disambiguates
// ---------------------------------------------------------------------------

describe('Rust ambiguous symbol resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'rust-ambiguous'),
      () => {},
    );
  }, 60000);

  it('detects 2 Handler structs in separate modules', () => {
    const structs: string[] = [];
    result.graph.forEachNode(n => {
      if (n.label === 'Struct') structs.push(`${n.properties.name}@${n.properties.filePath}`);
    });
    const handlers = structs.filter(s => s.startsWith('Handler@'));
    expect(handlers.length).toBe(2);
    expect(handlers.some(h => h.includes('src/models/'))).toBe(true);
    expect(handlers.some(h => h.includes('src/other/'))).toBe(true);
  });

  it('import resolves to src/models/mod.rs (not src/other/mod.rs)', () => {
    const imports = getRelationships(result, 'IMPORTS');
    const modelsImport = imports.find(e => e.targetFilePath.includes('models'));
    expect(modelsImport).toBeDefined();
    expect(modelsImport!.targetFilePath).toBe('src/models/mod.rs');
  });

  it('no import edge to src/other/', () => {
    const imports = getRelationships(result, 'IMPORTS');
    for (const imp of imports) {
      expect(imp.targetFilePath).not.toMatch(/src\/other\//);
    }
  });
});
