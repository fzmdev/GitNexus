/**
 * Symbol Resolver
 *
 * Scope-aware symbol resolution using import context and file locality.
 * Replaces raw lookupFuzzy(name)[0] with deterministic multi-tier resolution.
 *
 * Shared between heritage-processor.ts and call-processor.ts.
 */

import type { SymbolTable, SymbolDefinition } from './symbol-table.js';
import type { ImportMap } from './import-processor.js';

/**
 * Resolve a bare symbol name to its best-matching definition using scope context.
 *
 * Resolution tiers (highest confidence first):
 * 1. Same file (lookupExactFull — authoritative)
 * 2. Import-scoped (lookupFuzzy filtered by importMap — high confidence)
 * 3. Global fuzzy (lookupFuzzy, prefer unique match — low confidence)
 *
 * Returns the full SymbolDefinition (nodeId + filePath + type) or null.
 */
export const resolveSymbol = (
  name: string,
  currentFilePath: string,
  symbolTable: SymbolTable,
  importMap: ImportMap,
): SymbolDefinition | null => {
  // Tier 1: Same file — authoritative match
  const localDef = symbolTable.lookupExactFull(currentFilePath, name);
  if (localDef) return localDef;

  // Get all global definitions for subsequent tiers
  const allDefs = symbolTable.lookupFuzzy(name);
  if (allDefs.length === 0) return null;

  // Tier 2: Import-scoped — check if any definition is in a file imported by currentFile
  const importedFiles = importMap.get(currentFilePath);
  if (importedFiles) {
    for (const def of allDefs) {
      if (importedFiles.has(def.filePath)) return def;
    }
  }

  // Tier 3: Global fuzzy — first available definition
  return allDefs[0];
};
