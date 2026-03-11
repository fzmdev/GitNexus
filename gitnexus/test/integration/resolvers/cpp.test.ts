/**
 * C++: diamond inheritance + include-based imports + ambiguous #include disambiguation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Heritage: diamond inheritance + include-based imports
// ---------------------------------------------------------------------------

describe('C++ diamond inheritance', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'cpp-diamond'),
      () => {},
    );
  }, 60000);

  it('detects exactly 4 classes in diamond hierarchy', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['Animal', 'Duck', 'Flyer', 'Swimmer']);
  });

  it('emits exactly 4 EXTENDS edges for full diamond', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(4);
    expect(edgeSet(extends_)).toEqual([
      'Duck → Flyer',
      'Duck → Swimmer',
      'Flyer → Animal',
      'Swimmer → Animal',
    ]);
  });

  it('resolves all 5 #include imports between header/source files', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(5);
    expect(edgeSet(imports)).toEqual([
      'duck.cpp → duck.h',
      'duck.h → flyer.h',
      'duck.h → swimmer.h',
      'flyer.h → animal.h',
      'swimmer.h → animal.h',
    ]);
  });

  it('captures 1 Method node from duck.cpp (speak)', () => {
    const methods = getNodesByLabel(result, 'Method');
    expect(methods).toEqual(['speak']);
  });
});

// ---------------------------------------------------------------------------
// Ambiguous: two headers with same class name, #include disambiguates
// ---------------------------------------------------------------------------

describe('C++ ambiguous symbol resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'cpp-ambiguous'),
      () => {},
    );
  }, 60000);

  it('detects 2 Handler classes', () => {
    const classes = getNodesByLabel(result, 'Class');
    expect(classes.filter(n => n === 'Handler').length).toBe(2);
    expect(classes).toContain('Processor');
  });

  it('resolves EXTENDS to handler_a.h (not handler_b.h)', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('Processor');
    expect(extends_[0].target).toBe('Handler');
    expect(extends_[0].targetFilePath).toBe('handler_a.h');
  });

  it('#include resolves to handler_a.h', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(1);
    expect(imports[0].targetFilePath).toBe('handler_a.h');
  });

  it('all heritage edges point to real graph nodes', () => {
    for (const edge of getRelationships(result, 'EXTENDS')) {
      const target = result.graph.getNode(edge.rel.targetId);
      expect(target).toBeDefined();
      expect(target!.properties.name).toBe(edge.target);
    }
  });
});
