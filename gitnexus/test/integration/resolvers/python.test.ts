/**
 * Python: relative imports + class inheritance + ambiguous module disambiguation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Heritage: relative imports + class inheritance
// ---------------------------------------------------------------------------

describe('Python relative import & heritage resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'python-pkg'),
      () => {},
    );
  }, 60000);

  it('detects exactly 3 classes and 5 functions', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['AuthService', 'BaseModel', 'User']);
    expect(getNodesByLabel(result, 'Function')).toEqual(['authenticate', 'get_name', 'process_model', 'save', 'validate']);
  });

  it('emits exactly 1 EXTENDS edge: User → BaseModel', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('User');
    expect(extends_[0].target).toBe('BaseModel');
  });

  it('resolves all 3 relative imports', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(3);
    expect(edgeSet(imports)).toEqual([
      'auth.py → user.py',
      'helpers.py → base.py',
      'user.py → base.py',
    ]);
  });

  it('emits exactly 3 CALLS edges', () => {
    const calls = getRelationships(result, 'CALLS');
    expect(calls.length).toBe(3);
    expect(edgeSet(calls)).toEqual([
      'authenticate → validate',
      'process_model → save',
      'process_model → validate',
    ]);
  });

  it('no OVERRIDES edges target Property nodes', () => {
    const overrides = getRelationships(result, 'OVERRIDES');
    for (const edge of overrides) {
      const target = result.graph.getNode(edge.rel.targetId);
      expect(target).toBeDefined();
      expect(target!.label).not.toBe('Property');
    }
  });
});

// ---------------------------------------------------------------------------
// Ambiguous: Handler in two packages, relative import disambiguates
// ---------------------------------------------------------------------------

describe('Python ambiguous symbol resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'python-ambiguous'),
      () => {},
    );
  }, 60000);

  it('detects 2 Handler classes', () => {
    const classes = getNodesByLabel(result, 'Class');
    expect(classes.filter(n => n === 'Handler').length).toBe(2);
    expect(classes).toContain('UserHandler');
  });

  it('resolves EXTENDS to models/handler.py (not other/handler.py)', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('UserHandler');
    expect(extends_[0].target).toBe('Handler');
    expect(extends_[0].targetFilePath).toBe('models/handler.py');
  });

  it('import edge points to models/ not other/', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(1);
    expect(imports[0].targetFilePath).toBe('models/handler.py');
  });

  it('all heritage edges point to real graph nodes', () => {
    for (const edge of getRelationships(result, 'EXTENDS')) {
      const target = result.graph.getNode(edge.rel.targetId);
      expect(target).toBeDefined();
    }
  });
});
