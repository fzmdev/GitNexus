/**
 * TypeScript: heritage resolution + ambiguous symbol disambiguation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Heritage: class extends + implements interface
// ---------------------------------------------------------------------------

describe('TypeScript heritage resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'typescript-ambiguous'),
      () => {},
    );
  }, 60000);

  it('detects exactly 3 classes and 1 interface', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['BaseService', 'ConsoleLogger', 'UserService']);
    expect(getNodesByLabel(result, 'Interface')).toEqual(['ILogger']);
  });

  it('emits exactly 3 IMPORTS edges', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(3);
    expect(edgeSet(imports)).toEqual([
      'logger.ts → models.ts',
      'service.ts → logger.ts',
      'service.ts → models.ts',
    ]);
  });

  it('emits exactly 1 EXTENDS edge: UserService → BaseService', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('UserService');
    expect(extends_[0].target).toBe('BaseService');
  });

  it('emits exactly 2 IMPLEMENTS edges', () => {
    const implements_ = getRelationships(result, 'IMPLEMENTS');
    expect(implements_.length).toBe(2);
    expect(edgeSet(implements_)).toEqual([
      'ConsoleLogger → ILogger',
      'UserService → ILogger',
    ]);
  });

  it('emits HAS_METHOD edges linking methods to classes', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    expect(hasMethod.length).toBe(4);
    expect(edgeSet(hasMethod)).toEqual([
      'BaseService → getName',
      'ConsoleLogger → log',
      'UserService → getUsers',
      'UserService → log',
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
// Ambiguous: multiple definitions, imports disambiguate
// ---------------------------------------------------------------------------

describe('TypeScript ambiguous symbol resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'typescript-ambiguous'),
      () => {},
    );
  }, 60000);

  it('UserService has exactly 1 EXTENDS + 1 IMPLEMENTS', () => {
    const extends_ = getRelationships(result, 'EXTENDS').filter(e => e.source === 'UserService');
    const implements_ = getRelationships(result, 'IMPLEMENTS').filter(e => e.source === 'UserService');
    expect(extends_.length).toBe(1);
    expect(implements_.length).toBe(1);
  });

  it('ConsoleLogger has exactly 1 IMPLEMENTS and 0 EXTENDS', () => {
    const extends_ = getRelationships(result, 'EXTENDS').filter(e => e.source === 'ConsoleLogger');
    const implements_ = getRelationships(result, 'IMPLEMENTS').filter(e => e.source === 'ConsoleLogger');
    expect(extends_.length).toBe(0);
    expect(implements_.length).toBe(1);
    expect(implements_[0].target).toBe('ILogger');
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
