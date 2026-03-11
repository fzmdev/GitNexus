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

  it('emits CALLS edges from CreateUser (including constructor)', () => {
    const calls = getRelationships(result, 'CALLS');
    expect(calls.length).toBe(2);
    const targets = edgeSet(calls);
    expect(targets).toContain('CreateUser → Log');
    expect(targets).toContain('CreateUser → User');
  });

  it('resolves new User() to the User class via constructor discrimination', () => {
    const calls = getRelationships(result, 'CALLS');
    const ctorCall = calls.find(c => c.target === 'User');
    expect(ctorCall).toBeDefined();
    expect(ctorCall!.targetLabel).toBe('Class');
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

describe('C# call resolution with arity filtering', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'csharp-calls'),
      () => {},
    );
  }, 60000);

  it('resolves CreateUser → WriteAudit to Utils/OneArg.cs via arity narrowing', () => {
    const calls = getRelationships(result, 'CALLS');
    expect(calls.length).toBe(1);
    expect(calls[0].source).toBe('CreateUser');
    expect(calls[0].target).toBe('WriteAudit');
    expect(calls[0].targetFilePath).toBe('Utils/OneArg.cs');
    expect(calls[0].rel.reason).toBe('import-resolved');
  });
});

// ---------------------------------------------------------------------------
// Member-call resolution: obj.Method() resolves through pipeline
// ---------------------------------------------------------------------------

describe('C# member-call resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'csharp-member-calls'),
      () => {},
    );
  }, 60000);

  it('resolves ProcessUser → Save as a member call on User', () => {
    const calls = getRelationships(result, 'CALLS');
    const saveCall = calls.find(c => c.target === 'Save');
    expect(saveCall).toBeDefined();
    expect(saveCall!.source).toBe('ProcessUser');
    expect(saveCall!.targetFilePath).toBe('Models/User.cs');
  });

  it('detects User class and Save method', () => {
    expect(getNodesByLabel(result, 'Class')).toContain('User');
    expect(getNodesByLabel(result, 'Method')).toContain('Save');
  });

  it('emits HAS_METHOD edge from User to Save', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const edge = hasMethod.find(e => e.source === 'User' && e.target === 'Save');
    expect(edge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Primary constructor resolution: class User(string name, int age) { }
// ---------------------------------------------------------------------------

describe('C# primary constructor resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'csharp-primary-ctors'),
      () => {},
    );
  }, 60000);

  it('detects Constructor nodes for primary constructors on class and record', () => {
    const ctors = getNodesByLabel(result, 'Constructor');
    expect(ctors).toContain('User');
    expect(ctors).toContain('Person');
  });

  it('primary constructor has correct parameter count', () => {
    let userCtorParams: number | undefined;
    let personCtorParams: number | undefined;
    result.graph.forEachNode(n => {
      if (n.label === 'Constructor' && n.properties.name === 'User') {
        userCtorParams = n.properties.parameterCount as number;
      }
      if (n.label === 'Constructor' && n.properties.name === 'Person') {
        personCtorParams = n.properties.parameterCount as number;
      }
    });
    expect(userCtorParams).toBe(2);
    expect(personCtorParams).toBe(2);
  });

  it('resolves new User(...) as a CALLS edge to the Constructor node', () => {
    const calls = getRelationships(result, 'CALLS');
    const ctorCall = calls.find(c => c.target === 'User');
    expect(ctorCall).toBeDefined();
    expect(ctorCall!.source).toBe('Run');
    expect(ctorCall!.targetLabel).toBe('Constructor');
    expect(ctorCall!.targetFilePath).toBe('Models/User.cs');
  });

  it('also resolves user.Save() as a method call', () => {
    const calls = getRelationships(result, 'CALLS');
    const saveCall = calls.find(c => c.target === 'Save');
    expect(saveCall).toBeDefined();
    expect(saveCall!.source).toBe('Run');
  });

  it('emits HAS_METHOD edge from User class to User constructor', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const edge = hasMethod.find(e => e.source === 'User' && e.target === 'User');
    expect(edge).toBeDefined();
  });

  it('emits HAS_METHOD edge from Person record to Person constructor', () => {
    const hasMethod = getRelationships(result, 'HAS_METHOD');
    const edge = hasMethod.find(e => e.source === 'Person' && e.target === 'Person');
    expect(edge).toBeDefined();
  });
});
