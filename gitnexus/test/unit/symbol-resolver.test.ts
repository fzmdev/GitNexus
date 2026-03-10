import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSymbol } from '../../src/core/ingestion/symbol-resolver.js';
import { createSymbolTable } from '../../src/core/ingestion/symbol-table.js';
import { createImportMap } from '../../src/core/ingestion/import-processor.js';
import type { ImportMap } from '../../src/core/ingestion/import-processor.js';

describe('resolveSymbol', () => {
  let symbolTable: ReturnType<typeof createSymbolTable>;
  let importMap: ImportMap;

  beforeEach(() => {
    symbolTable = createSymbolTable();
    importMap = createImportMap();
  });

  describe('Tier 1: Same-file resolution', () => {
    it('resolves symbol defined in the same file', () => {
      symbolTable.add('src/models/user.ts', 'User', 'Class:src/models/user.ts:User', 'Class');

      const result = resolveSymbol('User', 'src/models/user.ts', symbolTable, importMap);

      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('Class:src/models/user.ts:User');
      expect(result!.filePath).toBe('src/models/user.ts');
      expect(result!.type).toBe('Class');
    });

    it('prefers same-file over imported definition', () => {
      symbolTable.add('src/local.ts', 'Config', 'Class:src/local.ts:Config', 'Class');
      symbolTable.add('src/shared.ts', 'Config', 'Class:src/shared.ts:Config', 'Class');
      importMap.set('src/local.ts', new Set(['src/shared.ts']));

      const result = resolveSymbol('Config', 'src/local.ts', symbolTable, importMap);

      expect(result!.nodeId).toBe('Class:src/local.ts:Config');
      expect(result!.filePath).toBe('src/local.ts');
    });
  });

  describe('Tier 2: Import-scoped resolution', () => {
    it('resolves symbol from an imported file', () => {
      symbolTable.add('src/services/auth.ts', 'AuthService', 'Class:src/services/auth.ts:AuthService', 'Class');
      importMap.set('src/controllers/login.ts', new Set(['src/services/auth.ts']));

      const result = resolveSymbol('AuthService', 'src/controllers/login.ts', symbolTable, importMap);

      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('Class:src/services/auth.ts:AuthService');
      expect(result!.filePath).toBe('src/services/auth.ts');
    });

    it('prefers imported definition over non-imported with same name', () => {
      symbolTable.add('src/services/logger.ts', 'Logger', 'Class:src/services/logger.ts:Logger', 'Class');
      symbolTable.add('src/testing/mock-logger.ts', 'Logger', 'Class:src/testing/mock-logger.ts:Logger', 'Class');
      importMap.set('src/app.ts', new Set(['src/services/logger.ts']));

      const result = resolveSymbol('Logger', 'src/app.ts', symbolTable, importMap);

      expect(result!.nodeId).toBe('Class:src/services/logger.ts:Logger');
      expect(result!.filePath).toBe('src/services/logger.ts');
    });

    it('handles file with no imports', () => {
      symbolTable.add('src/utils.ts', 'Helper', 'Class:src/utils.ts:Helper', 'Class');

      const result = resolveSymbol('Helper', 'src/app.ts', symbolTable, importMap);

      // Falls through to Tier 3 (fuzzy global)
      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('Class:src/utils.ts:Helper');
    });
  });

  describe('Tier 3: Fuzzy global resolution', () => {
    it('falls back to global when not in imports', () => {
      symbolTable.add('src/external/base.ts', 'BaseModel', 'Class:src/external/base.ts:BaseModel', 'Class');
      importMap.set('src/app.ts', new Set(['src/other.ts']));

      const result = resolveSymbol('BaseModel', 'src/app.ts', symbolTable, importMap);

      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('Class:src/external/base.ts:BaseModel');
    });

    it('returns first definition when multiple exist globally', () => {
      symbolTable.add('src/a.ts', 'Config', 'Class:src/a.ts:Config', 'Class');
      symbolTable.add('src/b.ts', 'Config', 'Class:src/b.ts:Config', 'Class');

      const result = resolveSymbol('Config', 'src/other.ts', symbolTable, importMap);

      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('Class:src/a.ts:Config');
    });
  });

  describe('null cases', () => {
    it('returns null for unknown symbol', () => {
      const result = resolveSymbol('NonExistent', 'src/app.ts', symbolTable, importMap);
      expect(result).toBeNull();
    });

    it('returns null when symbol table is empty', () => {
      const result = resolveSymbol('Anything', 'src/app.ts', symbolTable, importMap);
      expect(result).toBeNull();
    });
  });

  describe('type preservation', () => {
    it('preserves Interface type for heritage resolution', () => {
      symbolTable.add('src/interfaces.ts', 'ILogger', 'Interface:src/interfaces.ts:ILogger', 'Interface');
      importMap.set('src/app.ts', new Set(['src/interfaces.ts']));

      const result = resolveSymbol('ILogger', 'src/app.ts', symbolTable, importMap);

      expect(result!.type).toBe('Interface');
    });

    it('preserves Class type for heritage resolution', () => {
      symbolTable.add('src/base.ts', 'BaseService', 'Class:src/base.ts:BaseService', 'Class');
      importMap.set('src/app.ts', new Set(['src/base.ts']));

      const result = resolveSymbol('BaseService', 'src/app.ts', symbolTable, importMap);

      expect(result!.type).toBe('Class');
    });
  });

  describe('heritage-specific scenarios', () => {
    it('resolves C# interface vs class ambiguity via imports', () => {
      // ILogger exists as Interface in one file and Class in another
      symbolTable.add('src/logging/ilogger.cs', 'ILogger', 'Interface:src/logging/ilogger.cs:ILogger', 'Interface');
      symbolTable.add('src/testing/ilogger.cs', 'ILogger', 'Class:src/testing/ilogger.cs:ILogger', 'Class');
      importMap.set('src/services/auth.cs', new Set(['src/logging/ilogger.cs']));

      const result = resolveSymbol('ILogger', 'src/services/auth.cs', symbolTable, importMap);

      expect(result!.type).toBe('Interface');
      expect(result!.filePath).toBe('src/logging/ilogger.cs');
    });

    it('resolves parent class from imported file for extends', () => {
      symbolTable.add('src/api/controller.ts', 'UserController', 'Class:src/api/controller.ts:UserController', 'Class');
      symbolTable.add('src/base/controller.ts', 'BaseController', 'Class:src/base/controller.ts:BaseController', 'Class');
      importMap.set('src/api/controller.ts', new Set(['src/base/controller.ts']));

      const result = resolveSymbol('BaseController', 'src/api/controller.ts', symbolTable, importMap);

      expect(result!.nodeId).toBe('Class:src/base/controller.ts:BaseController');
    });
  });
});

describe('lookupExactFull', () => {
  it('returns full SymbolDefinition for same-file lookup', () => {
    const symbolTable = createSymbolTable();
    symbolTable.add('src/models/user.ts', 'User', 'Class:src/models/user.ts:User', 'Class');

    const result = symbolTable.lookupExactFull('src/models/user.ts', 'User');

    expect(result).not.toBeUndefined();
    expect(result!.nodeId).toBe('Class:src/models/user.ts:User');
    expect(result!.filePath).toBe('src/models/user.ts');
    expect(result!.type).toBe('Class');
  });

  it('returns undefined for non-existent symbol', () => {
    const symbolTable = createSymbolTable();
    const result = symbolTable.lookupExactFull('src/app.ts', 'NonExistent');
    expect(result).toBeUndefined();
  });

  it('returns undefined for wrong file', () => {
    const symbolTable = createSymbolTable();
    symbolTable.add('src/a.ts', 'Foo', 'Class:src/a.ts:Foo', 'Class');

    const result = symbolTable.lookupExactFull('src/b.ts', 'Foo');
    expect(result).toBeUndefined();
  });
});
