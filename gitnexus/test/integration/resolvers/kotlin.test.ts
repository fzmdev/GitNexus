/**
 * Kotlin: data class extends + implements interfaces + ambiguous import disambiguation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Heritage: data class extends + implements interfaces (delegation specifiers)
// ---------------------------------------------------------------------------

describe('Kotlin heritage resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'kotlin-heritage'),
      () => {},
    );
  }, 60000);

  it('detects exactly 3 classes and 2 interfaces', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['BaseModel', 'User', 'UserService']);
    expect(getNodesByLabel(result, 'Interface')).toEqual(['Serializable', 'Validatable']);
  });

  it('detects 6 functions (interface declarations + implementations + service)', () => {
    expect(getNodesByLabel(result, 'Function')).toEqual([
      'processUser', 'save', 'serialize', 'serialize', 'validate', 'validate',
    ]);
  });

  it('emits exactly 1 EXTENDS edge: User → BaseModel', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('User');
    expect(extends_[0].target).toBe('BaseModel');
  });

  it('emits exactly 2 IMPLEMENTS edges via symbol table resolution', () => {
    const implements_ = getRelationships(result, 'IMPLEMENTS');
    expect(implements_.length).toBe(2);
    expect(edgeSet(implements_)).toEqual([
      'User → Serializable',
      'User → Validatable',
    ]);
  });

  it('resolves exactly 4 IMPORTS edges (JVM-style package imports)', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(4);
    expect(edgeSet(imports)).toEqual([
      'User.kt → Serializable.kt',
      'User.kt → Validatable.kt',
      'UserService.kt → Serializable.kt',
      'UserService.kt → User.kt',
    ]);
  });

  it('does not emit EXTENDS edges to interfaces', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.some(e => e.target === 'Serializable')).toBe(false);
    expect(extends_.some(e => e.target === 'Validatable')).toBe(false);
  });

  it('no OVERRIDES edges target Property nodes', () => {
    const overrides = getRelationships(result, 'OVERRIDES');
    for (const edge of overrides) {
      const target = result.graph.getNode(edge.rel.targetId);
      expect(target).toBeDefined();
      expect(target!.label).not.toBe('Property');
    }
  });

  it('all heritage edges point to real graph nodes', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    const implements_ = getRelationships(result, 'IMPLEMENTS');

    for (const edge of [...extends_, ...implements_]) {
      const target = result.graph.getNode(edge.rel.targetId);
      expect(target).toBeDefined();
      expect(target!.properties.name).toBe(edge.target);
    }
  });
});

// ---------------------------------------------------------------------------
// Ambiguous: Handler + Runnable in two packages, explicit imports disambiguate
// ---------------------------------------------------------------------------

describe('Kotlin ambiguous symbol resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'kotlin-ambiguous'),
      () => {},
    );
  }, 60000);

  it('detects 2 Handler classes and 2 Runnable interfaces', () => {
    const classes = getNodesByLabel(result, 'Class');
    expect(classes.filter(n => n === 'Handler').length).toBe(2);
    const ifaces = getNodesByLabel(result, 'Interface');
    expect(ifaces.filter(n => n === 'Runnable').length).toBe(2);
  });

  it('resolves EXTENDS to models/Handler.kt (not other/Handler.kt)', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('UserHandler');
    expect(extends_[0].target).toBe('Handler');
    expect(extends_[0].targetFilePath).toBe('models/Handler.kt');
  });

  it('resolves IMPLEMENTS to models/Runnable.kt (not other/Runnable.kt)', () => {
    const implements_ = getRelationships(result, 'IMPLEMENTS');
    expect(implements_.length).toBe(1);
    expect(implements_[0].source).toBe('UserHandler');
    expect(implements_[0].target).toBe('Runnable');
    expect(implements_[0].targetFilePath).toBe('models/Runnable.kt');
  });

  it('import edges point to models/ not other/', () => {
    const imports = getRelationships(result, 'IMPORTS');
    for (const imp of imports) {
      expect(imp.targetFilePath).toMatch(/^models\//);
    }
  });

  it('all heritage edges point to real graph nodes', () => {
    for (const edge of [...getRelationships(result, 'EXTENDS'), ...getRelationships(result, 'IMPLEMENTS')]) {
      const target = result.graph.getNode(edge.rel.targetId);
      expect(target).toBeDefined();
      expect(target!.properties.name).toBe(edge.target);
    }
  });
});
