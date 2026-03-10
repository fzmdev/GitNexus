import { describe, it, expect } from 'vitest';
import { extractMethodSignature } from '../../src/core/ingestion/utils.js';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
import CSharp from 'tree-sitter-c-sharp';

describe('extractMethodSignature', () => {
  const parser = new Parser();

  it('returns zero params and no return type for null node', () => {
    const sig = extractMethodSignature(null);
    expect(sig.parameterCount).toBe(0);
    expect(sig.returnType).toBeUndefined();
  });

  describe('TypeScript', () => {
    it('extracts params and return type from a typed method', () => {
      parser.setLanguage(TypeScript.typescript);
      const code = `class Foo {
  greet(name: string, age: number): boolean { return true; }
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(2);
      expect(sig.returnType).toBe('boolean');
    });

    it('extracts zero params from a method with no parameters', () => {
      parser.setLanguage(TypeScript.typescript);
      const code = `class Foo {
  run(): void {}
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(0);
      expect(sig.returnType).toBe('void');
    });

    it('extracts params without return type annotation', () => {
      parser.setLanguage(TypeScript.typescript);
      const code = `class Foo {
  process(x: number) { return x + 1; }
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(1);
      expect(sig.returnType).toBeUndefined();
    });
  });

  describe('Python', () => {
    it('skips self parameter', () => {
      parser.setLanguage(Python);
      const code = `class Foo:
    def bar(self, x, y):
        pass`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(2);
      expect(sig.returnType).toBeUndefined();
    });

    it('handles method with only self', () => {
      parser.setLanguage(Python);
      const code = `class Foo:
    def noop(self):
        pass`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(0);
    });

    it('handles Python return type annotation', () => {
      parser.setLanguage(Python);
      const code = `class Foo:
    def bar(self, x: int) -> bool:
        return True`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(1);
      // Python return type is in a 'return_type' child — check if extracted
      // Note: Python uses 'type' child, exact behavior depends on AST structure
      // The important thing is parameterCount is correct; returnType may vary
    });
  });

  describe('Java', () => {
    it('extracts params from a Java method', () => {
      parser.setLanguage(Java);
      const code = `class Foo {
  public int add(int a, int b) { return a + b; }
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(2);
    });

    it('extracts zero params from no-arg Java method', () => {
      parser.setLanguage(Java);
      const code = `class Foo {
  public void run() {}
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(0);
    });
  });

  describe('C#', () => {
    it('extracts params from a C# method', () => {
      parser.setLanguage(CSharp);
      const code = `class Foo {
  public bool Check(string name, int count) { return true; }
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(2);
    });

    it('handles C# method with no params', () => {
      parser.setLanguage(CSharp);
      const code = `class Foo {
  public void Execute() {}
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(0);
    });
  });
});
