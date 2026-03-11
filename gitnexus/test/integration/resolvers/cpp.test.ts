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

describe('C++ call resolution with arity filtering', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'cpp-calls'),
      () => {},
    );
  }, 60000);

  it('resolves run → write_audit to one.h via arity narrowing', () => {
    const calls = getRelationships(result, 'CALLS');
    expect(calls.length).toBe(1);
    expect(calls[0].source).toBe('run');
    expect(calls[0].target).toBe('write_audit');
    expect(calls[0].targetFilePath).toBe('one.h');
    expect(calls[0].rel.reason).toBe('import-resolved');
  });
});

// ---------------------------------------------------------------------------
// Member-call resolution: obj.method() resolves through pipeline
// ---------------------------------------------------------------------------

describe('C++ member-call resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'cpp-member-calls'),
      () => {},
    );
  }, 60000);

  it('resolves processUser → save as a member call on User', () => {
    const calls = getRelationships(result, 'CALLS');
    const saveCall = calls.find(c => c.target === 'save');
    expect(saveCall).toBeDefined();
    expect(saveCall!.source).toBe('processUser');
    expect(saveCall!.targetFilePath).toBe('user.h');
  });

  it('detects User class and save method', () => {
    expect(getNodesByLabel(result, 'Class')).toContain('User');
    expect(getNodesByLabel(result, 'Method')).toContain('save');
  });

  it('emits HAS_METHOD edge from User to save', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const edge = hasMethod.find(e => e.source === 'User' && e.target === 'save');
    expect(edge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Constructor resolution: new Foo() resolves to Class
// ---------------------------------------------------------------------------

describe('C++ constructor-call resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'cpp-constructor-calls'),
      () => {},
    );
  }, 60000);

  it('resolves new User() as a CALLS edge to the User class', () => {
    const calls = getRelationships(result, 'CALLS');
    const ctorCall = calls.find(c => c.target === 'User');
    expect(ctorCall).toBeDefined();
    expect(ctorCall!.source).toBe('processUser');
    expect(ctorCall!.targetLabel).toBe('Class');
    expect(ctorCall!.targetFilePath).toBe('user.h');
    expect(ctorCall!.rel.reason).toBe('import-resolved');
  });

  it('detects User class and save method', () => {
    expect(getNodesByLabel(result, 'Class')).toContain('User');
    expect(getNodesByLabel(result, 'Method')).toContain('save');
  });

  it('resolves #include import', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(1);
    expect(imports[0].targetFilePath).toBe('user.h');
  });
});

