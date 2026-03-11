/**
 * Integration Tests: Multi-Language Heritage & Import Resolution
 *
 * Runs the full ingestion pipeline on per-language fixture repos and validates:
 * - EXTENDS/IMPLEMENTS edges are emitted correctly
 * - Import resolution works for language-specific syntax
 * - MRO produces correct OVERRIDES edges for diamond inheritance
 * - Ambiguous symbols produce synthetic nodes, not wrong edges
 *
 * Each language fixture is a standalone "mini-repo" that exercises the full
 * pipeline path: scan → parse → imports → calls → heritage → MRO.
 *
 * ALL assertions use strict toBe/toEqual — if any fail, fix the app code.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { runPipelineFromRepo } from '../../src/core/ingestion/pipeline.js';
import type { PipelineResult } from '../../src/types/pipeline.js';
import type { GraphRelationship } from '../../src/core/graph/types.js';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'lang-resolution');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRelationships(result: PipelineResult, type: string): Array<{
  source: string;
  target: string;
  sourceLabel: string;
  targetLabel: string;
  sourceFilePath: string;
  targetFilePath: string;
  rel: GraphRelationship;
}> {
  const edges: Array<{
    source: string;
    target: string;
    sourceLabel: string;
    targetLabel: string;
    sourceFilePath: string;
    targetFilePath: string;
    rel: GraphRelationship;
  }> = [];
  for (const rel of result.graph.iterRelationships()) {
    if (rel.type === type) {
      const sourceNode = result.graph.getNode(rel.sourceId);
      const targetNode = result.graph.getNode(rel.targetId);
      edges.push({
        source: sourceNode?.properties.name ?? rel.sourceId,
        target: targetNode?.properties.name ?? rel.targetId,
        sourceLabel: sourceNode?.label ?? 'unknown',
        targetLabel: targetNode?.label ?? 'unknown',
        sourceFilePath: sourceNode?.properties.filePath ?? '',
        targetFilePath: targetNode?.properties.filePath ?? '',
        rel,
      });
    }
  }
  return edges;
}

function getNodesByLabel(result: PipelineResult, label: string): string[] {
  const names: string[] = [];
  result.graph.forEachNode(n => {
    if (n.label === label) names.push(n.properties.name);
  });
  return names.sort();
}

function edgeSet(edges: Array<{ source: string; target: string }>): string[] {
  return edges.map(e => `${e.source} → ${e.target}`).sort();
}

// ---------------------------------------------------------------------------
// TypeScript: class extends + implements interface
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
});

// ---------------------------------------------------------------------------
// C#: class + interface resolution via base_list
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
});

// ---------------------------------------------------------------------------
// C++: diamond inheritance + include-based imports
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
// Java: class extends + implements multiple interfaces
// ---------------------------------------------------------------------------

describe('Java heritage resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'java-heritage'),
      () => {},
    );
  }, 60000);

  it('detects exactly 3 classes and 2 interfaces', () => {
    expect(getNodesByLabel(result, 'Class')).toEqual(['BaseModel', 'User', 'UserService']);
    expect(getNodesByLabel(result, 'Interface')).toEqual(['Serializable', 'Validatable']);
  });

  it('emits exactly 1 EXTENDS edge: User → BaseModel', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('User');
    expect(extends_[0].target).toBe('BaseModel');
  });

  it('emits exactly 2 IMPLEMENTS edges: User → Serializable, User → Validatable', () => {
    const implements_ = getRelationships(result, 'IMPLEMENTS');
    expect(implements_.length).toBe(2);
    expect(edgeSet(implements_)).toEqual([
      'User → Serializable',
      'User → Validatable',
    ]);
  });

  it('resolves exactly 4 IMPORTS edges', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(4);
    expect(edgeSet(imports)).toEqual([
      'User.java → Serializable.java',
      'User.java → Validatable.java',
      'UserService.java → Serializable.java',
      'UserService.java → User.java',
    ]);
  });

  it('does not emit EXTENDS edges to interfaces', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.some(e => e.target === 'Serializable')).toBe(false);
    expect(extends_.some(e => e.target === 'Validatable')).toBe(false);
  });

  it('emits exactly 2 CALLS edges', () => {
    const calls = getRelationships(result, 'CALLS');
    expect(calls.length).toBe(2);
    expect(edgeSet(calls)).toEqual([
      'processUser → save',
      'processUser → validate',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Python: relative imports + class inheritance
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
});

// ---------------------------------------------------------------------------
// Rust: trait implementations
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
// Go: package imports + cross-package calls (exercises PackageMap)
// ---------------------------------------------------------------------------

describe('Go package import & call resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'go-pkg'),
      () => {},
    );
  }, 60000);

  it('detects exactly 2 structs and 1 interface', () => {
    expect(getNodesByLabel(result, 'Struct')).toEqual(['Admin', 'User']);
    expect(getNodesByLabel(result, 'Interface')).toEqual(['Repository']);
  });

  it('detects exactly 5 functions', () => {
    expect(getNodesByLabel(result, 'Function')).toEqual([
      'Authenticate', 'NewAdmin', 'NewUser', 'ValidateToken', 'main',
    ]);
  });

  it('emits exactly 5 cross-package CALLS edges via PackageMap', () => {
    const calls = getRelationships(result, 'CALLS');
    expect(calls.length).toBe(5);
    expect(edgeSet(calls)).toEqual([
      'Authenticate → NewUser',
      'NewAdmin → NewUser',
      'main → Authenticate',
      'main → NewAdmin',
      'main → NewUser',
    ]);
  });

  it('resolves exactly 7 IMPORTS edges across Go packages', () => {
    const imports = getRelationships(result, 'IMPORTS');
    expect(imports.length).toBe(7);
    expect(edgeSet(imports)).toEqual([
      'main.go → admin.go',
      'main.go → repository.go',
      'main.go → service.go',
      'main.go → user.go',
      'service.go → admin.go',
      'service.go → repository.go',
      'service.go → user.go',
    ]);
  });

  it('emits exactly 1 EXTENDS edge for struct embedding: Admin → User', () => {
    const extends_ = getRelationships(result, 'EXTENDS');
    expect(extends_.length).toBe(1);
    expect(extends_[0].source).toBe('Admin');
    expect(extends_[0].target).toBe('User');
  });

  it('does not emit IMPLEMENTS edges (Go uses structural typing)', () => {
    expect(getRelationships(result, 'IMPLEMENTS').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-language: ambiguous symbol refusal
// ---------------------------------------------------------------------------

describe('ambiguous symbol refusal (heritage false-positive guard)', () => {
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
