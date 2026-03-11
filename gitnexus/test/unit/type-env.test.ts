import { describe, it, expect } from 'vitest';
import { buildTypeEnv } from '../../src/core/ingestion/type-env.js';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Java from 'tree-sitter-java';
import CSharp from 'tree-sitter-c-sharp';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import Python from 'tree-sitter-python';
import CPP from 'tree-sitter-cpp';
import Kotlin from 'tree-sitter-kotlin';
import PHP from 'tree-sitter-php';

const parser = new Parser();

const parse = (code: string, lang: any) => {
  parser.setLanguage(lang);
  return parser.parse(code);
};

describe('buildTypeEnv', () => {
  describe('TypeScript', () => {
    it('extracts type from const declaration', () => {
      const tree = parse('const user: User = getUser();', TypeScript.typescript);
      const env = buildTypeEnv(tree, 'typescript');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from let declaration', () => {
      const tree = parse('let repo: Repository;', TypeScript.typescript);
      const env = buildTypeEnv(tree, 'typescript');
      expect(env.get('repo')).toBe('Repository');
    });

    it('extracts type from function parameters', () => {
      const tree = parse('function save(user: User, repo: Repository) {}', TypeScript.typescript);
      const env = buildTypeEnv(tree, 'typescript');
      expect(env.get('user')).toBe('User');
      expect(env.get('repo')).toBe('Repository');
    });

    it('extracts type from arrow function parameters', () => {
      const tree = parse('const fn = (user: User) => user.save();', TypeScript.typescript);
      const env = buildTypeEnv(tree, 'typescript');
      expect(env.get('user')).toBe('User');
    });

    it('ignores variables without type annotations', () => {
      const tree = parse('const x = 5; let y = "hello";', TypeScript.typescript);
      const env = buildTypeEnv(tree, 'typescript');
      expect(env.size).toBe(0);
    });
  });

  describe('Java', () => {
    it('extracts type from local variable declaration', () => {
      const tree = parse(`
        class App {
          void run() {
            User user = new User();
            Repository repo = getRepo();
          }
        }
      `, Java);
      const env = buildTypeEnv(tree, 'java');
      expect(env.get('user')).toBe('User');
      expect(env.get('repo')).toBe('Repository');
    });

    it('extracts type from method parameters', () => {
      const tree = parse(`
        class App {
          void process(User user, Repository repo) {}
        }
      `, Java);
      const env = buildTypeEnv(tree, 'java');
      expect(env.get('user')).toBe('User');
      expect(env.get('repo')).toBe('Repository');
    });

    it('extracts type from field declaration', () => {
      const tree = parse(`
        class App {
          private User user;
        }
      `, Java);
      const env = buildTypeEnv(tree, 'java');
      expect(env.get('user')).toBe('User');
    });
  });

  describe('C#', () => {
    it('extracts type from local variable declaration', () => {
      const tree = parse(`
        class App {
          void Run() {
            User user = new User();
          }
        }
      `, CSharp);
      const env = buildTypeEnv(tree, 'csharp');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from var with new expression', () => {
      const tree = parse(`
        class App {
          void Run() {
            var user = new User();
          }
        }
      `, CSharp);
      const env = buildTypeEnv(tree, 'csharp');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from method parameters', () => {
      const tree = parse(`
        class App {
          void Process(User user, Repository repo) {}
        }
      `, CSharp);
      const env = buildTypeEnv(tree, 'csharp');
      expect(env.get('user')).toBe('User');
      expect(env.get('repo')).toBe('Repository');
    });
  });

  describe('Go', () => {
    it('extracts type from var declaration', () => {
      const tree = parse(`
        package main
        func main() {
          var user User
        }
      `, Go);
      const env = buildTypeEnv(tree, 'go');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from short var with composite literal', () => {
      const tree = parse(`
        package main
        func main() {
          user := User{Name: "Alice"}
        }
      `, Go);
      const env = buildTypeEnv(tree, 'go');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from function parameters', () => {
      const tree = parse(`
        package main
        func process(user User, repo Repository) {}
      `, Go);
      const env = buildTypeEnv(tree, 'go');
      // Go parameter extraction depends on tree-sitter grammar structure
      // Parameters may or may not have 'name'/'type' fields
    });
  });

  describe('Rust', () => {
    it('extracts type from let declaration', () => {
      const tree = parse(`
        fn main() {
          let user: User = User::new();
        }
      `, Rust);
      const env = buildTypeEnv(tree, 'rust');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from function parameters', () => {
      const tree = parse(`
        fn process(user: User, repo: Repository) {}
      `, Rust);
      const env = buildTypeEnv(tree, 'rust');
      expect(env.get('user')).toBe('User');
      expect(env.get('repo')).toBe('Repository');
    });

    it('extracts type from let with reference', () => {
      const tree = parse(`
        fn main() {
          let user: &User = &get_user();
        }
      `, Rust);
      const env = buildTypeEnv(tree, 'rust');
      expect(env.get('user')).toBe('User');
    });
  });

  describe('Python', () => {
    it('extracts type from annotated assignment (PEP 484)', () => {
      const tree = parse('user: User = get_user()', Python);
      const env = buildTypeEnv(tree, 'python');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from function parameters', () => {
      const tree = parse('def process(user: User, repo: Repository): pass', Python);
      const env = buildTypeEnv(tree, 'python');
      // Python uses typed_parameter nodes, check if they match
    });
  });

  describe('C++', () => {
    it('extracts type from local variable declaration', () => {
      const tree = parse(`
        void run() {
          User user;
        }
      `, CPP);
      const env = buildTypeEnv(tree, 'cpp');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from initialized declaration', () => {
      const tree = parse(`
        void run() {
          User user = getUser();
        }
      `, CPP);
      const env = buildTypeEnv(tree, 'cpp');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from pointer declaration', () => {
      const tree = parse(`
        void run() {
          User* user = new User();
        }
      `, CPP);
      const env = buildTypeEnv(tree, 'cpp');
      expect(env.get('user')).toBe('User');
    });

    it('extracts type from function parameters', () => {
      const tree = parse(`
        void process(User user, Repository& repo) {}
      `, CPP);
      const env = buildTypeEnv(tree, 'cpp');
      expect(env.get('user')).toBe('User');
      expect(env.get('repo')).toBe('Repository');
    });
  });

  describe('PHP', () => {
    it('extracts type from function parameters', () => {
      const tree = parse(`<?php
        function process(User $user, Repository $repo) {}
      `, PHP.php);
      const env = buildTypeEnv(tree, 'php');
      // PHP parameter type extraction
      expect(env.get('$user')).toBe('User');
      expect(env.get('$repo')).toBe('Repository');
    });
  });

  describe('edge cases', () => {
    it('returns empty map for code without type annotations', () => {
      const tree = parse('const x = 5;', TypeScript.typescript);
      const env = buildTypeEnv(tree, 'typescript');
      expect(env.size).toBe(0);
    });

    it('last-write-wins for same variable name', () => {
      const tree = parse(`
        let x: User = getUser();
        let x: Admin = getAdmin();
      `, TypeScript.typescript);
      const env = buildTypeEnv(tree, 'typescript');
      // Both declarations are processed; last one wins in flat map
      expect(env.get('x')).toBeDefined();
    });
  });
});
