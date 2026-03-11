/**
 * C#: heritage resolution via base_list + ambiguous namespace-import refusal
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Heritage: class + interface resolution via base_list
// ---------------------------------------------------------------------------

describe('C# heritage resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'csharp-proj'),
      () => {},
    );
  }, 60000);

  it('detects exactly 3 classes and 2 interfaces', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['BaseEntity', 'User', 'UserService']);
    expect(getNodesByLabel(result, 'Interface')).toEqual(['ILogger', 'IRepository']);
  });

  it('emits exactly 1 EXTENDS edge: User → BaseEntity', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('User');
    expect(extends_[0].target).toBe('BaseEntity');
  });

  it('emits exactly 1 IMPLEMENTS edge: User → IRepository', () => {
    const implements_ = getRelationships(result, 'IMPLEMENTS');
    expect(implements_.length).toBe(1);
    expect(implements_[0].source).toBe('User');
    expect(implements_[0].target).toBe('IRepository');
  });

  it('emits CALLS edge: CreateUser → Log', () => {
    const calls = getRelationships(result, 'CALLS');
    expect(calls.length).toBe(1);
    expect(calls[0].source).toBe('CreateUser');
    expect(calls[0].target).toBe('Log');
  });

  it('detects 4 namespaces', () => {
    const ns = getNodesByLabel(result, 'Namespace');
    expect(ns.length).toBe(4);
  });

  it('detects properties on classes', () => {
    const props = getNodesByLabel(result, 'Property');
    expect(props).toContain('Id');
    expect(props).toContain('Name');
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
// Ambiguous: using-namespace can't disambiguate same-named types
// ---------------------------------------------------------------------------

describe('C# ambiguous symbol resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'csharp-ambiguous'),
      () => {},
    );
  }, 60000);

  it('detects 2 Handler classes and 2 IProcessor interfaces', () => {
    const classes = getNodesByLabel(result, 'Class');
    expect(classes.filter(n => n === 'Handler').length).toBe(2);
    const ifaces = getNodesByLabel(result, 'Interface');
    expect(ifaces.filter(n => n === 'IProcessor').length).toBe(2);
  });

  it('heritage targets are synthetic (correct refusal for ambiguous namespace import)', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    const implements_ = getRelationships(result, 'IMPLEMENTS');

    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('UserHandler');
    expect(implements_.length).toBe(1);
    expect(implements_[0].source).toBe('UserHandler');

    // The key invariant: no edge points to Other/
    if (extends_[0].targetFilePath) {
      expect(extends_[0].targetFilePath).not.toMatch(/Other\//);
    }
    if (implements_[0].targetFilePath) {
      expect(implements_[0].targetFilePath).not.toMatch(/Other\//);
    }
  });
});
