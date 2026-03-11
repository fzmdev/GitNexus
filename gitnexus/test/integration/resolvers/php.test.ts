/**
 * PHP: PSR-4 imports, extends, implements, trait use, enums, calls + ambiguous disambiguation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Heritage: PSR-4 imports, extends, implements, trait use, enums, calls
// ---------------------------------------------------------------------------

describe('PHP heritage & import resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'php-app'),
      () => {},
    );
  }, 60000);

  // --- Node detection ---

  it('detects 3 classes', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['BaseModel', 'User', 'UserService']);
  });

  it('detects 2 interfaces', () => {
    expect(getNodesByLabel(result, 'Interface')).toEqual(['Loggable', 'Repository']);
  });

  it('detects 2 traits', () => {
    expect(getNodesByLabel(result, 'Trait')).toEqual(['HasTimestamps', 'SoftDeletes']);
  });

  it('detects 1 enum (PHP 8.1)', () => {
    expect(getNodesByLabel(result, 'Enum')).toEqual(['UserRole']);
  });

  it('detects 8 namespaces across all files', () => {
    const ns = getNodesByLabel(result, 'Namespace');
    expect(ns.length).toBe(8);
  });

  // --- Heritage edges ---

  it('emits exactly 1 EXTENDS edge: User → BaseModel', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('User');
    expect(extends_[0].target).toBe('BaseModel');
  });

  it('emits 4 IMPLEMENTS edges: class→interface + class→trait', () => {
    const implements_ = getRelationships(result, 'IMPLEMENTS');
    expect(edgeSet(implements_)).toEqual([
      'BaseModel → HasTimestamps',
      'BaseModel → Loggable',
      'User → SoftDeletes',
      'UserService → Repository',
    ]);
  });

  // --- Import (use-statement) resolution via PSR-4 ---

  it('resolves 6 IMPORTS edges via PSR-4 composer.json', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(edgeSet(imports)).toEqual([
      'BaseModel.php → HasTimestamps.php',
      'BaseModel.php → Loggable.php',
      'User.php → SoftDeletes.php',
      'UserService.php → Repository.php',
      'UserService.php → User.php',
      'UserService.php → UserRole.php',
    ]);
  });

  // --- Method/function call edges ---

  it('emits CALLS edges from createUser', () => {
    const calls = getRelationships(result, 'CALLS')
      .filter(e => e.source === 'createUser');
    const targets = calls.map(c => c.target).sort();
    expect(targets).toContain('save');
    expect(targets).toContain('touch');
    expect(targets).toContain('label');
  });

  it('emits CALLS edge: save → getId', () => {
    const calls = getRelationships(result, 'CALLS')
      .filter(e => e.source === 'save' && e.target === 'getId');
    expect(calls.length).toBe(1);
  });

  // --- Methods and properties ---

  it('detects methods on classes, interfaces, traits, and enums', () => {
    const methods = getNodesByLabel(result, 'Method');
    expect(methods).toContain('getId');
    expect(methods).toContain('log');
    expect(methods).toContain('touch');
    expect(methods).toContain('softDelete');
    expect(methods).toContain('restore');
    expect(methods).toContain('find');
    expect(methods).toContain('save');
    expect(methods).toContain('createUser');
    expect(methods).toContain('instance');
    expect(methods).toContain('label');
    expect(methods).toContain('__construct');
  });

  it('detects properties on classes and traits', () => {
    const props = getNodesByLabel(result, 'Property');
    expect(props).toContain('id');
    expect(props).toContain('name');
    expect(props).toContain('email');
    expect(props).toContain('users');
    // $status defined in both HasTimestamps and SoftDeletes traits
    expect(props.filter(p => p === 'status').length).toBe(2);
  });

  // --- Property OVERRIDES exclusion ---

  it('does not emit OVERRIDES for property name collisions ($status in both traits)', () => {
    const overrides = getRelationships(result, 'OVERRIDES');
    // OVERRIDES should only target Method nodes, never Property nodes
    for (const edge of overrides) {
      const target = result.graph.getNode(edge.rel.targetId);
      expect(target).toBeDefined();
      expect(target!.label).not.toBe('Property');
    }
  });

  // --- MRO: OVERRIDES edge ---

  it('emits OVERRIDES edge for User overriding log (inherited from BaseModel)', () => {
    const overrides = getRelationships(result, 'OVERRIDES');
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    const logOverride = overrides.find(e => e.source === 'User' && e.target === 'log');
    expect(logOverride).toBeDefined();
  });

  // --- All heritage edges point to real graph nodes ---

  it('all heritage edges point to real graph nodes (no synthetic)', () => {
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
// Ambiguous: Handler + Dispatchable, PSR-4 use-imports disambiguate
// ---------------------------------------------------------------------------

describe('PHP ambiguous symbol resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'php-ambiguous'),
      () => {},
    );
  }, 60000);

  it('detects 2 Handler classes and 2 Dispatchable interfaces', () => {
    const classes = getNodesByLabel(result, 'Class');
    expect(classes.filter(n => n === 'Handler').length).toBe(2);
    const ifaces = getNodesByLabel(result, 'Interface');
    expect(ifaces.filter(n => n === 'Dispatchable').length).toBe(2);
  });

  it('resolves EXTENDS to app/Models/Handler.php (not app/Other/)', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('UserHandler');
    expect(extends_[0].target).toBe('Handler');
    expect(extends_[0].targetFilePath).toBe('app/Models/Handler.php');
  });

  it('resolves IMPLEMENTS to app/Models/Dispatchable.php (not app/Other/)', () => {
    const implements_ = getRelationships(result, 'IMPLEMENTS');
    expect(implements_.length).toBe(1);
    expect(implements_[0].source).toBe('UserHandler');
    expect(implements_[0].target).toBe('Dispatchable');
    expect(implements_[0].targetFilePath).toBe('app/Models/Dispatchable.php');
  });

  it('import edges point to app/Models/ not app/Other/', () => {
    const imports = getRelationships(result, 'IMPORTS');
    for (const imp of imports) {
      expect(imp.targetFilePath).toMatch(/^app\/Models\//);
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

describe('PHP call resolution with arity filtering', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'php-calls'),
      () => {},
    );
  }, 60000);

  it('resolves create_user → write_audit to app/Utils/OneArg/log.php via arity narrowing', () => {
    const calls = getRelationships(result, 'CALLS');
    expect(calls.length).toBe(1);
    expect(calls[0].source).toBe('create_user');
    expect(calls[0].target).toBe('write_audit');
    expect(calls[0].targetFilePath).toBe('app/Utils/OneArg/log.php');
    expect(calls[0].rel.reason).toBe('import-resolved');
  });
});

