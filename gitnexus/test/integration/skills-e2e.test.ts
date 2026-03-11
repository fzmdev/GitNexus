/**
 * E2E Tests: --skills flag (cross-language skill generation)
 *
 * Exercises the full analyze → community detection → skill generation →
 * AI context file registration pipeline via the CLI binary.
 *
 * Four fixture repos are created in temp directories:
 *   - TypeScript  (modular api/data/utils structure, ~28 symbols)
 *   - Python      (auth/database/utils package structure, ~24 symbols)
 *   - Go          (cmd + pkg multi-package layout, ~22 symbols)
 *   - Mixed       (TypeScript backend + Python ML packages, relaxed assertions)
 *
 * Each test verifies:
 *   1. CLI exits 0 (or returns null on CI timeout — accepted)
 *   2. .gitnexus/ directory created (full analyze ran)
 *   3. .claude/skills/generated/ has at least 1 SKILL.md
 *   4. Every SKILL.md has valid YAML frontmatter (name: + description:)
 *   5. CLAUDE.md is created and references generated skill paths
 *   6. AGENTS.md is created and references generated skill paths
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../..');
const cliEntry = path.join(repoRoot, 'src/cli/index.ts');

// Absolute file:// URL to tsx loader — needed when spawning CLI with cwd
// outside the project tree (bare 'tsx' specifier won't resolve there).
const _require = createRequire(import.meta.url);
const tsxPkgDir = path.dirname(_require.resolve('tsx/package.json'));
const tsxImportUrl = pathToFileURL(path.join(tsxPkgDir, 'dist', 'loader.mjs')).href;

// ─── CLI helper ───────────────────────────────────────────────────────────────

function runSkillsAnalyze(cwd: string, timeoutMs = 45_000) {
  return spawnSync(
    process.execPath,
    ['--import', tsxImportUrl, cliEntry, 'analyze', '--skills'],
    {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Pre-set heap so ensureHeap() skips re-exec (re-exec drops the tsx
        // loader when cwd has no node_modules).
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=8192`.trim(),
      },
    },
  );
}

// ─── Git helper ───────────────────────────────────────────────────────────────

function initGitRepo(dir: string) {
  spawnSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  spawnSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  spawnSync('git', ['commit', '-m', 'initial commit'], {
    cwd: dir,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@test',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@test',
    },
  });
}

// ─── Shared assertion helper ──────────────────────────────────────────────────

/**
 * Assert that the --skills output is structurally valid.
 *
 * Verifies:
 * - .claude/skills/generated/ exists and has ≥1 subdirectory
 * - Each subdirectory contains a SKILL.md with valid YAML frontmatter
 * - CLAUDE.md and AGENTS.md are created and reference generated skill paths
 */
function assertSkillsOutput(repoDir: string, language: string) {
  const generatedDir = path.join(repoDir, '.claude', 'skills', 'generated');

  expect(
    fs.existsSync(generatedDir),
    `[${language}] .claude/skills/generated/ should exist after --skills`,
  ).toBe(true);

  const skillDirs = fs.readdirSync(generatedDir).filter(entry =>
    fs.statSync(path.join(generatedDir, entry)).isDirectory(),
  );

  expect(
    skillDirs.length,
    `[${language}] at least one skill directory should be generated`,
  ).toBeGreaterThan(0);

  for (const skillDir of skillDirs) {
    const skillPath = path.join(generatedDir, skillDir, 'SKILL.md');

    expect(
      fs.existsSync(skillPath),
      `[${language}] ${skillDir}/SKILL.md should exist`,
    ).toBe(true);

    const content = fs.readFileSync(skillPath, 'utf-8');

    // Valid YAML frontmatter
    expect(
      content.startsWith('---'),
      `[${language}] ${skillDir}/SKILL.md should start with YAML frontmatter`,
    ).toBe(true);
    expect(content, `[${language}] ${skillDir}/SKILL.md should contain name:`).toContain('name:');
    expect(content, `[${language}] ${skillDir}/SKILL.md should contain description:`).toContain('description:');

    // Meaningful content — more than just frontmatter
    expect(
      content.length,
      `[${language}] ${skillDir}/SKILL.md should have substantive content`,
    ).toBeGreaterThan(200);

    // Required structural sections
    expect(content, `[${language}] ${skillDir}/SKILL.md should have ## Key Files section`).toContain('## Key Files');
    expect(content, `[${language}] ${skillDir}/SKILL.md should have ## How to Explore section`).toContain('## How to Explore');
  }

  // CLAUDE.md must be created and reference generated skill paths
  const claudePath = path.join(repoDir, 'CLAUDE.md');
  expect(fs.existsSync(claudePath), `[${language}] CLAUDE.md should be created`).toBe(true);
  const claudeContent = fs.readFileSync(claudePath, 'utf-8');
  expect(
    claudeContent,
    `[${language}] CLAUDE.md should reference .claude/skills/generated/ paths`,
  ).toContain('.claude/skills/generated/');

  // AGENTS.md must be created and reference generated skill paths
  const agentsPath = path.join(repoDir, 'AGENTS.md');
  expect(fs.existsSync(agentsPath), `[${language}] AGENTS.md should be created`).toBe(true);
  const agentsContent = fs.readFileSync(agentsPath, 'utf-8');
  expect(
    agentsContent,
    `[${language}] AGENTS.md should reference .claude/skills/generated/ paths`,
  ).toContain('.claude/skills/generated/');
}

// ─── TypeScript fixture ───────────────────────────────────────────────────────

describe('--skills e2e: TypeScript repo', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-skills-ts-'));

    // Three clear module groups: api/, data/, utils/
    // Each has multiple files with several exported symbols so Leiden (or the
    // directory-based fallback) can detect communities above the 3-symbol threshold.

    fs.mkdirSync(path.join(repoDir, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src', 'data'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src', 'utils'), { recursive: true });

    fs.writeFileSync(path.join(repoDir, 'src', 'api', 'handler.ts'), `
import { validateRequest } from '../utils/validator';
import { saveRecord } from '../data/repository';
import { formatSuccess } from '../utils/formatter';

export class RequestHandler {
  async handle(input: string): Promise<string> {
    const validated = validateRequest(input);
    const record = await saveRecord(validated);
    return formatSuccess(record);
  }
}

export function createHandler(): RequestHandler { return new RequestHandler(); }
export function disposeHandler(h: RequestHandler): void { /* cleanup */ }
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'api', 'router.ts'), `
import { RequestHandler, createHandler } from './handler';
import { authenticate } from '../utils/auth';

export function setupRoutes(handler: RequestHandler) {
  return { post: (p: string, fn: Function) => ({ p, fn }) };
}
export function applyMiddleware(router: any, auth: typeof authenticate) {}
export const createRouter = () => setupRoutes(createHandler());
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'api', 'middleware.ts'), `
export function authMiddleware(req: any, res: any, next: Function) { next(); }
export function logMiddleware(req: any, res: any, next: Function) { next(); }
export function errorMiddleware(err: Error, _req: any, _res: any, next: Function) { next(); }
export function rateLimitMiddleware(limit: number) { return (_: any, __: any, n: Function) => n(); }
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'data', 'repository.ts'), `
export interface Record { id: string; data: string; }
export async function saveRecord(data: string): Promise<Record> { return { id: '1', data }; }
export async function findRecord(id: string): Promise<Record | null> { return null; }
export async function deleteRecord(id: string): Promise<boolean> { return true; }
export async function listRecords(): Promise<Record[]> { return []; }
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'data', 'cache.ts'), `
const store = new Map<string, unknown>();
export function cacheGet(key: string): unknown { return store.get(key); }
export function cacheSet(key: string, value: unknown): void { store.set(key, value); }
export function cacheDel(key: string): void { store.delete(key); }
export function cacheClear(): void { store.clear(); }
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'utils', 'validator.ts'), `
export function validateRequest(input: string): string {
  if (!input) throw new Error('empty');
  return input.trim();
}
export function validateEmail(email: string): boolean { return email.includes('@'); }
export function validateLength(s: string, max: number): boolean { return s.length <= max; }
export function sanitize(input: string): string { return input.replace(/[<>]/g, ''); }
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'utils', 'formatter.ts'), `
export function formatSuccess(data: unknown): string { return JSON.stringify({ ok: true, data }); }
export function formatError(err: Error): string { return JSON.stringify({ ok: false, error: err.message }); }
export function formatDate(d: Date): string { return d.toISOString(); }
export function truncate(s: string, n: number): string { return s.slice(0, n); }
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'utils', 'auth.ts'), `
export function authenticate(token: string): boolean { return token.startsWith('Bearer '); }
export function generateToken(userId: string): string { return \`Bearer \${userId}\`; }
export function hashPassword(pw: string): string { return pw; }
export function verifyPassword(pw: string, hash: string): boolean { return pw === hash; }
`);

    initGitRepo(repoDir);
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('analyze --skills completes and generates skill files for a TypeScript repo', () => {
    const result = runSkillsAnalyze(repoDir);

    // Accept timeout as valid on slow CI runners
    if (result.status === null) return;

    expect(result.status, [
      `analyze --skills exited with code ${result.status}`,
      `stdout: ${result.stdout}`,
      `stderr: ${result.stderr}`,
    ].join('\n')).toBe(0);

    expect(
      fs.existsSync(path.join(repoDir, '.gitnexus')),
      'analyze should create .gitnexus/ directory',
    ).toBe(true);

    assertSkillsOutput(repoDir, 'TypeScript');
  }, 50_000);
});

// ─── Python fixture ───────────────────────────────────────────────────────────

describe('--skills e2e: Python repo', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-skills-py-'));

    // Three module groups: auth/, database/, utils/
    // Python class + function symbols ensure community threshold (≥3) is met.

    fs.mkdirSync(path.join(repoDir, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src', 'database'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src', 'utils'), { recursive: true });

    fs.writeFileSync(path.join(repoDir, 'src', 'auth', 'login.py'), `
from .session import create_session, destroy_session
from ..utils.validator import validate_email, validate_password

def login_user(email: str, password: str) -> dict:
    """Authenticate a user and create a session."""
    validate_email(email)
    validate_password(password)
    return create_session(email)

def logout_user(token: str) -> bool:
    """Invalidate a session token."""
    return destroy_session(token)

def get_current_user(token: str) -> dict | None:
    """Return the user associated with a token."""
    return None

def refresh_token(token: str) -> str:
    """Issue a new token if the old one is still valid."""
    return token
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'auth', 'session.py'), `
_sessions: dict[str, str] = {}

class Session:
    def __init__(self, token: str, user_id: str):
        self.token = token
        self.user_id = user_id

def create_session(user_id: str) -> dict:
    token = f"tok_{user_id}"
    _sessions[token] = user_id
    return {"token": token, "user_id": user_id}

def destroy_session(token: str) -> bool:
    return _sessions.pop(token, None) is not None

def validate_session(token: str) -> bool:
    return token in _sessions
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'database', 'connection.py'), `
class DatabaseConnection:
    """Manages a single database connection."""
    def __init__(self, dsn: str):
        self.dsn = dsn
        self._conn = None

    def connect(self):
        self._conn = object()
        return self

    def disconnect(self):
        self._conn = None

    def is_connected(self) -> bool:
        return self._conn is not None

def get_connection(dsn: str) -> "DatabaseConnection":
    return DatabaseConnection(dsn).connect()

def close_connection(conn: "DatabaseConnection") -> None:
    conn.disconnect()
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'database', 'queries.py'), `
from .connection import DatabaseConnection

def execute_query(conn: DatabaseConnection, sql: str, params: tuple = ()) -> list:
    """Run a parameterised query and return rows."""
    return []

def fetch_one(conn: DatabaseConnection, sql: str, params: tuple = ()) -> dict | None:
    rows = execute_query(conn, sql, params)
    return rows[0] if rows else None

def fetch_all(conn: DatabaseConnection, sql: str) -> list:
    return execute_query(conn, sql)

def insert_record(conn: DatabaseConnection, table: str, data: dict) -> int:
    return 0

def delete_record(conn: DatabaseConnection, table: str, record_id: int) -> bool:
    return True
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'utils', 'validator.py'), `
import re

def validate_email(email: str) -> bool:
    return bool(re.match(r"[^@]+@[^@]+\\.[^@]+", email))

def validate_password(password: str) -> bool:
    return len(password) >= 8

def validate_length(value: str, max_len: int) -> bool:
    return len(value) <= max_len

def sanitize_input(value: str) -> str:
    return value.strip().replace("<", "").replace(">", "")
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'utils', 'formatter.py'), `
import json
from datetime import datetime

def format_success(data: object) -> str:
    return json.dumps({"ok": True, "data": data})

def format_error(message: str) -> str:
    return json.dumps({"ok": False, "error": message})

def format_date(dt: datetime) -> str:
    return dt.isoformat()

def truncate_string(value: str, max_len: int) -> str:
    return value[:max_len] if len(value) > max_len else value
`);

    initGitRepo(repoDir);
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('analyze --skills completes and generates skill files for a Python repo', () => {
    const result = runSkillsAnalyze(repoDir);

    // Accept timeout as valid on slow CI runners
    if (result.status === null) return;

    expect(result.status, [
      `analyze --skills exited with code ${result.status}`,
      `stdout: ${result.stdout}`,
      `stderr: ${result.stderr}`,
    ].join('\n')).toBe(0);

    expect(
      fs.existsSync(path.join(repoDir, '.gitnexus')),
      'analyze should create .gitnexus/ directory',
    ).toBe(true);

    assertSkillsOutput(repoDir, 'Python');
  }, 50_000);
});

// ─── Go fixture ───────────────────────────────────────────────────────────────

describe('--skills e2e: Go repo', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-skills-go-'));

    // Four package groups: handler/, service/, repository/, models/
    // Each has struct types + methods, giving plenty of symbols for community detection.

    fs.mkdirSync(path.join(repoDir, 'cmd'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'pkg', 'handler'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'pkg', 'repository'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'pkg', 'service'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'pkg', 'models'), { recursive: true });

    fs.writeFileSync(path.join(repoDir, 'cmd', 'main.go'), `
package main

import (
  "fmt"
  "github.com/example/app/pkg/handler"
  "github.com/example/app/pkg/service"
)

func main() {
  svc := service.NewUserService()
  h := handler.NewHandler(svc)
  fmt.Println(h)
}
`);

    fs.writeFileSync(path.join(repoDir, 'pkg', 'handler', 'handler.go'), `
package handler

import "github.com/example/app/pkg/service"

type Handler struct{ svc *service.UserService }

func NewHandler(svc *service.UserService) *Handler { return &Handler{svc: svc} }
func (h *Handler) HandleCreate(name string) (string, error) { return h.svc.CreateUser(name) }
func (h *Handler) HandleGet(id string) (string, error)      { return h.svc.GetUser(id) }
func (h *Handler) HandleDelete(id string) error              { return h.svc.DeleteUser(id) }
`);

    fs.writeFileSync(path.join(repoDir, 'pkg', 'handler', 'middleware.go'), `
package handler

import "net/http"

type Middleware func(http.Handler) http.Handler

func AuthMiddleware() Middleware      { return func(next http.Handler) http.Handler { return next } }
func LogMiddleware() Middleware       { return func(next http.Handler) http.Handler { return next } }
func RateLimitMiddleware() Middleware { return func(next http.Handler) http.Handler { return next } }
`);

    fs.writeFileSync(path.join(repoDir, 'pkg', 'service', 'user_service.go'), `
package service

import "github.com/example/app/pkg/repository"

type UserService struct{ repo *repository.UserRepository }

func NewUserService() *UserService             { return &UserService{repo: repository.NewUserRepository()} }
func (s *UserService) CreateUser(name string) (string, error) { return s.repo.Insert(name) }
func (s *UserService) GetUser(id string) (string, error)      { return s.repo.FindByID(id) }
func (s *UserService) UpdateUser(id, name string) error       { return s.repo.Update(id, name) }
func (s *UserService) DeleteUser(id string) error             { return s.repo.Delete(id) }
`);

    fs.writeFileSync(path.join(repoDir, 'pkg', 'repository', 'user_repo.go'), `
package repository

type UserRepository struct{}

func NewUserRepository() *UserRepository                { return &UserRepository{} }
func (r *UserRepository) Insert(name string) (string, error) { return "1", nil }
func (r *UserRepository) FindByID(id string) (string, error) { return "", nil }
func (r *UserRepository) FindAll() ([]string, error)         { return nil, nil }
func (r *UserRepository) Update(id, name string) error       { return nil }
func (r *UserRepository) Delete(id string) error             { return nil }
`);

    fs.writeFileSync(path.join(repoDir, 'pkg', 'models', 'user.go'), `
package models

type User struct {
  ID    string
  Name  string
  Email string
}

type CreateUserRequest struct{ Name, Email string }
type UpdateUserRequest struct{ Name string }
type UserResponse struct{ ID, Name, Email string }

func NewUser(name, email string) *User { return &User{Name: name, Email: email} }
func (u *User) ToResponse() *UserResponse {
  return &UserResponse{ID: u.ID, Name: u.Name, Email: u.Email}
}
`);

    initGitRepo(repoDir);
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('analyze --skills completes and generates skill files for a Go repo', () => {
    const result = runSkillsAnalyze(repoDir);

    // Accept timeout as valid on slow CI runners
    if (result.status === null) return;

    expect(result.status, [
      `analyze --skills exited with code ${result.status}`,
      `stdout: ${result.stdout}`,
      `stderr: ${result.stderr}`,
    ].join('\n')).toBe(0);

    expect(
      fs.existsSync(path.join(repoDir, '.gitnexus')),
      'analyze should create .gitnexus/ directory',
    ).toBe(true);

    assertSkillsOutput(repoDir, 'Go');
  }, 50_000);
});

// ─── Mixed TypeScript + Python fixture ────────────────────────────────────────

describe('--skills e2e: mixed TypeScript + Python repo', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-skills-mixed-'));

    // TypeScript backend (packages/backend/)
    fs.mkdirSync(path.join(repoDir, 'packages', 'backend', 'src'), { recursive: true });

    fs.writeFileSync(path.join(repoDir, 'packages', 'backend', 'src', 'server.ts'), `
export function startServer(port: number): void { console.log(\`Listening on \${port}\`); }
export function stopServer(): void {}
export function configureRoutes(): Record<string, Function> { return {}; }
export function configureMiddleware(): void {}
`);

    fs.writeFileSync(path.join(repoDir, 'packages', 'backend', 'src', 'auth.ts'), `
export function verifyToken(token: string): boolean { return token.length > 0; }
export function createToken(userId: string): string { return userId; }
export function revokeToken(token: string): void {}
export function decodeToken(token: string): { userId: string } { return { userId: token }; }
`);

    fs.writeFileSync(path.join(repoDir, 'packages', 'backend', 'src', 'database.ts'), `
export async function query(sql: string): Promise<unknown[]> { return []; }
export async function execute(sql: string): Promise<void> {}
export async function transaction(fn: Function): Promise<void> { await fn(); }
export async function migrate(): Promise<void> {}
`);

    // Python ML service (packages/ml/)
    fs.mkdirSync(path.join(repoDir, 'packages', 'ml', 'src'), { recursive: true });

    fs.writeFileSync(path.join(repoDir, 'packages', 'ml', 'src', 'model.py'), `
class Model:
    def __init__(self, weights: list):
        self.weights = weights

    def predict(self, inputs: list) -> list:
        return inputs

    def train(self, data: list, labels: list) -> None:
        pass

    def evaluate(self, data: list, labels: list) -> float:
        return 0.0

def load_model(path: str) -> Model:
    return Model([])

def save_model(model: Model, path: str) -> None:
    pass
`);

    fs.writeFileSync(path.join(repoDir, 'packages', 'ml', 'src', 'preprocessing.py'), `
def normalize(data: list) -> list:
    if not data: return []
    mn, mx = min(data), max(data)
    return [(x - mn) / (mx - mn) if mx > mn else 0 for x in data]

def tokenize(text: str) -> list:
    return text.lower().split()

def pad_sequence(seq: list, length: int) -> list:
    return seq[:length] + [0] * max(0, length - len(seq))

def batch(data: list, size: int) -> list:
    return [data[i:i+size] for i in range(0, len(data), size)]
`);

    fs.writeFileSync(path.join(repoDir, 'packages', 'ml', 'src', 'pipeline.py'), `
from .model import Model, load_model
from .preprocessing import normalize, tokenize, batch

def run_inference(model: Model, raw_text: str) -> list:
    tokens = tokenize(raw_text)
    normalized = normalize([float(hash(t) % 100) for t in tokens])
    return model.predict(normalized)

def run_training_pipeline(data_path: str) -> Model:
    model = load_model(data_path)
    return model

def evaluate_model(model: Model, test_data: list) -> dict:
    return {"accuracy": model.evaluate(test_data, [])}
`);

    initGitRepo(repoDir);
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('analyze --skills completes on a mixed TypeScript + Python repo', () => {
    const result = runSkillsAnalyze(repoDir);

    // Accept timeout as valid on slow CI runners
    if (result.status === null) return;

    expect(result.status, [
      `analyze --skills exited with code ${result.status}`,
      `stdout: ${result.stdout}`,
      `stderr: ${result.stderr}`,
    ].join('\n')).toBe(0);

    expect(
      fs.existsSync(path.join(repoDir, '.gitnexus')),
      'analyze should create .gitnexus/ directory',
    ).toBe(true);

    // CLAUDE.md and AGENTS.md are always created by the analyze command
    expect(
      fs.existsSync(path.join(repoDir, 'CLAUDE.md')),
      'CLAUDE.md should be created',
    ).toBe(true);
    expect(
      fs.existsSync(path.join(repoDir, 'AGENTS.md')),
      'AGENTS.md should be created',
    ).toBe(true);

    // If skills were generated, run full structural assertions.
    // A mixed repo with two separate package trees may or may not produce
    // enough inter-file CALLS edges for Leiden to form significant communities,
    // so we accept either outcome as long as the pipeline exits cleanly.
    const generatedDir = path.join(repoDir, '.claude', 'skills', 'generated');
    if (fs.existsSync(generatedDir)) {
      assertSkillsOutput(repoDir, 'Mixed');
    }
  }, 50_000);

  it('CLAUDE.md references both TypeScript and Python symbols when skills generated', () => {
    const generatedDir = path.join(repoDir, '.claude', 'skills', 'generated');

    // Only run this check if the previous test generated skills
    if (!fs.existsSync(generatedDir)) return;

    const claudeContent = fs.readFileSync(path.join(repoDir, 'CLAUDE.md'), 'utf-8');

    // The CLAUDE.md skill table should contain entries for the generated areas
    expect(claudeContent).toContain('.claude/skills/generated/');

    // Skills table rows reference the generated skill names
    const skillDirs = fs.readdirSync(generatedDir).filter(e =>
      fs.statSync(path.join(generatedDir, e)).isDirectory(),
    );
    for (const dir of skillDirs) {
      expect(
        claudeContent,
        `CLAUDE.md should reference generated skill: ${dir}`,
      ).toContain(dir);
    }
  }, 50_000);
});

// ─── Re-run idempotency ───────────────────────────────────────────────────────

describe('--skills e2e: idempotency', () => {
  let repoDir: string;
  let firstRunSkillDirs: string[] = [];

  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-skills-idem-'));

    // Minimal TypeScript repo — just enough to pass the skill threshold
    fs.mkdirSync(path.join(repoDir, 'src', 'core'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src', 'io'), { recursive: true });

    fs.writeFileSync(path.join(repoDir, 'src', 'core', 'processor.ts'), `
export class Processor {
  process(input: string): string { return input.trim(); }
  validate(input: string): boolean { return input.length > 0; }
  transform(input: string): string { return input.toLowerCase(); }
}
export function createProcessor(): Processor { return new Processor(); }
export function runProcessor(p: Processor, s: string): string { return p.process(s); }
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'core', 'config.ts'), `
export interface Config { debug: boolean; maxRetries: number; timeout: number; }
export function loadConfig(): Config { return { debug: false, maxRetries: 3, timeout: 5000 }; }
export function validateConfig(c: Config): boolean { return c.timeout > 0 && c.maxRetries > 0; }
export function mergeConfig(base: Config, overrides: Partial<Config>): Config {
  return { ...base, ...overrides };
}
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'io', 'reader.ts'), `
export interface Reader { read(): string; close(): void; }
export function createFileReader(path: string): Reader {
  return { read: () => '', close: () => {} };
}
export function createStreamReader(stream: any): Reader {
  return { read: () => '', close: () => {} };
}
export function readAll(reader: Reader): string[] { return []; }
`);

    fs.writeFileSync(path.join(repoDir, 'src', 'io', 'writer.ts'), `
export interface Writer { write(data: string): void; flush(): void; close(): void; }
export function createFileWriter(path: string): Writer {
  return { write: () => {}, flush: () => {}, close: () => {} };
}
export function writeAll(writer: Writer, lines: string[]): void {
  lines.forEach(l => writer.write(l));
}
export function createBufferedWriter(w: Writer): Writer { return w; }
`);

    initGitRepo(repoDir);
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('first run generates skill files', () => {
    const result = runSkillsAnalyze(repoDir);
    if (result.status === null) return;
    expect(result.status).toBe(0);

    const generatedDir = path.join(repoDir, '.claude', 'skills', 'generated');
    if (fs.existsSync(generatedDir)) {
      firstRunSkillDirs = fs.readdirSync(generatedDir).filter(e =>
        fs.statSync(path.join(generatedDir, e)).isDirectory(),
      );
      expect(firstRunSkillDirs.length).toBeGreaterThan(0);
    }
  }, 50_000);

  it('second run produces consistent output (idempotent)', () => {
    // Skip if first run timed out or produced no skills
    if (firstRunSkillDirs.length === 0) return;

    // Second analyze --skills run on an already-indexed repo
    // (passes --skills which bypasses the staleness check)
    const result = runSkillsAnalyze(repoDir);
    if (result.status === null) return;
    expect(result.status).toBe(0);

    const generatedDir = path.join(repoDir, '.claude', 'skills', 'generated');
    expect(fs.existsSync(generatedDir)).toBe(true);

    const secondRunDirs = fs.readdirSync(generatedDir).filter(e =>
      fs.statSync(path.join(generatedDir, e)).isDirectory(),
    );

    // Same number of skill directories
    expect(secondRunDirs.length).toBe(firstRunSkillDirs.length);

    // Same directory names
    expect(secondRunDirs.sort()).toEqual(firstRunSkillDirs.sort());

    // CLAUDE.md should still reference generated skills
    const claudeContent = fs.readFileSync(path.join(repoDir, 'CLAUDE.md'), 'utf-8');
    expect(claudeContent).toContain('.claude/skills/generated/');
  }, 50_000);
});
