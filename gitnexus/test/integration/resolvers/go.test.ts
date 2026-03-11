/**
 * Go: package imports + cross-package calls + ambiguous struct disambiguation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Heritage: package imports + cross-package calls (exercises PackageMap)
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
// Ambiguous: Handler struct in two packages, package import disambiguates
// ---------------------------------------------------------------------------

describe('Go ambiguous symbol resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'go-ambiguous'),
      () => {},
    );
  }, 60000);

  it('detects 2 Handler structs in separate packages', () => {
    const structs: string[] = [];
    result.graph.forEachNode(n => {
      if (n.label === 'Struct') structs.push(`${n.properties.name}@${n.properties.filePath}`);
    });
    const handlers = structs.filter(s => s.startsWith('Handler@'));
    expect(handlers.length).toBe(2);
    expect(handlers.some(h => h.includes('internal/models/'))).toBe(true);
    expect(handlers.some(h => h.includes('internal/other/'))).toBe(true);
  });

  it('import resolves to internal/models/handler.go (not internal/other/)', () => {
    const imports = getRelationships(result, 'IMPORTS');
    const modelsImport = imports.find(e => e.targetFilePath.includes('models'));
    expect(modelsImport).toBeDefined();
    expect(modelsImport!.targetFilePath).toBe('internal/models/handler.go');
  });

  it('no import edge to internal/other/', () => {
    const imports = getRelationships(result, 'IMPORTS');
    for (const imp of imports) {
      expect(imp.targetFilePath).not.toMatch(/internal\/other\//);
    }
  });
});
