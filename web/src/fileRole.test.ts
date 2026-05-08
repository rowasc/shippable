import { describe, expect, it } from "vitest";
import { classifyFileRole } from "./fileRole";
import type { SymbolShape, SymbolSummary } from "./types";

describe("classifyFileRole — path-floor", () => {
  it("classifies *.test.ts as test", () => {
    expect(classifyFileRole("src/parseDiff.test.ts").pathRole).toBe("test");
  });
  it("classifies *.spec.tsx as test", () => {
    expect(classifyFileRole("web/components/Foo.spec.tsx").pathRole).toBe("test");
  });
  it("classifies *Test.php as test", () => {
    expect(classifyFileRole("src/CartTest.php").pathRole).toBe("test");
  });
  it("classifies files in __tests__/ as test", () => {
    expect(classifyFileRole("src/__tests__/foo.ts").pathRole).toBe("test");
  });
  it("classifies files in e2e/ as test", () => {
    expect(classifyFileRole("e2e/login.ts").pathRole).toBe("test");
  });
  it("classifies *.tsx in components/ as component", () => {
    expect(classifyFileRole("web/src/components/Sidebar.tsx").pathRole).toBe("component");
  });
  it("classifies use*.ts in hooks/ as hook", () => {
    expect(classifyFileRole("web/src/hooks/useFoo.ts").pathRole).toBe("hook");
  });
  it("classifies *.types.ts as type-def", () => {
    expect(classifyFileRole("web/src/diff.types.ts").pathRole).toBe("type-def");
  });
  it("classifies bare types.ts as type-def", () => {
    expect(classifyFileRole("web/src/types.ts").pathRole).toBe("type-def");
  });
  it("classifies *Route.php as route", () => {
    expect(classifyFileRole("server/SignupRoute.php").pathRole).toBe("route");
  });
  it("classifies *Controller.php as route", () => {
    expect(classifyFileRole("server/CartController.php").pathRole).toBe("route");
  });
  it("classifies routes.ts as route", () => {
    expect(classifyFileRole("server/src/routes.ts").pathRole).toBe("route");
  });
  it("classifies *.css as style", () => {
    expect(classifyFileRole("web/src/App.css").pathRole).toBe("style");
  });
  it("classifies *.scss as style", () => {
    expect(classifyFileRole("web/src/legacy.scss").pathRole).toBe("style");
  });
  it("classifies *.md as doc", () => {
    expect(classifyFileRole("docs/architecture.md").pathRole).toBe("doc");
  });
  it("classifies library/prompts/*.md as prompt", () => {
    expect(classifyFileRole("library/prompts/explain-this-hunk.md").pathRole).toBe("prompt");
  });
  it("classifies *.sql as migration", () => {
    expect(classifyFileRole("migrations/001_init.sql").pathRole).toBe("migration");
  });
  it("classifies files in migrations/ as migration", () => {
    expect(classifyFileRole("server/migrations/0042_users.ts").pathRole).toBe("migration");
  });
  it("classifies package.json as config", () => {
    expect(classifyFileRole("web/package.json").pathRole).toBe("config");
  });
  it("classifies tsconfig.json as config", () => {
    expect(classifyFileRole("web/tsconfig.json").pathRole).toBe("config");
  });
  it("classifies *.lock as config", () => {
    expect(classifyFileRole("web/package-lock.lock").pathRole).toBe("config");
  });
  it("classifies vite.config.* as config", () => {
    expect(classifyFileRole("web/vite.config.ts").pathRole).toBe("config");
  });
  it("classifies tauri.conf.json as config", () => {
    expect(classifyFileRole("src-tauri/tauri.conf.json").pathRole).toBe("config");
  });
  it("classifies fixtures/ as fixture", () => {
    expect(classifyFileRole("test-fixtures/php-multifile/Cart.php").pathRole).toBe("fixture");
  });
  it("classifies __fixtures__/ as fixture", () => {
    expect(classifyFileRole("server/src/__fixtures__/stub-lsp.ts").pathRole).toBe("fixture");
  });
  it("falls through to code for unmatched files", () => {
    expect(classifyFileRole("server/src/index.ts").pathRole).toBe("code");
    expect(classifyFileRole("web/src/parseDiff.ts").pathRole).toBe("code");
  });
});

describe("classifyFileRole — fileRole === pathRole when no LSP", () => {
  it("returns identical roles when no shape/symbols supplied", () => {
    const result = classifyFileRole("web/src/parseDiff.ts");
    expect(result.pathRole).toBe(result.fileRole);
  });

  it("returns identical roles when symbols is empty", () => {
    const result = classifyFileRole("web/src/parseDiff.ts", {}, []);
    expect(result.pathRole).toBe(result.fileRole);
  });
});

describe("classifyFileRole — LSP-shape upgrade", () => {
  it("promotes a colocated useFoo.ts outside hooks/ to hook", () => {
    const symbols: SymbolSummary[] = [
      { name: "useTimeout", kind: "Function", line: 0 },
    ];
    const shape: SymbolShape = { functions: 1 };
    const result = classifyFileRole("web/src/feature/useTimeout.ts", shape, symbols);
    expect(result.pathRole).toBe("code");
    expect(result.fileRole).toBe("hook");
  });

  it("promotes a type-only module without .types.ts suffix to type-def", () => {
    const symbols: SymbolSummary[] = [
      { name: "Foo", kind: "Interface", line: 0 },
      { name: "Bar", kind: "Type", line: 5 },
      { name: "Baz", kind: "Enum", line: 9 },
    ];
    const shape: SymbolShape = { interfaces: 1, types: 1, enums: 1 };
    const result = classifyFileRole("web/src/api.ts", shape, symbols);
    expect(result.pathRole).toBe("code");
    expect(result.fileRole).toBe("type-def");
  });

  it("promotes a property-heavy single-class file to entity", () => {
    const symbols: SymbolSummary[] = [
      { name: "Cart", kind: "Class", line: 0 },
    ];
    const shape: SymbolShape = { classes: 1, properties: 8, methods: 1 };
    const result = classifyFileRole("server/Cart.php", shape, symbols);
    expect(result.pathRole).toBe("code");
    expect(result.fileRole).toBe("entity");
  });

  it("does not promote a method-heavy class to entity", () => {
    const symbols: SymbolSummary[] = [
      { name: "PaymentGateway", kind: "Class", line: 0 },
    ];
    const shape: SymbolShape = { classes: 1, properties: 1, methods: 6 };
    const result = classifyFileRole("server/PaymentGateway.php", shape, symbols);
    expect(result.fileRole).toBe("code");
  });

  it("promotes a top-level App.tsx outside components/ to component", () => {
    const symbols: SymbolSummary[] = [
      { name: "App", kind: "Function", line: 0 },
    ];
    const shape: SymbolShape = { functions: 1 };
    const result = classifyFileRole("web/src/App.tsx", shape, symbols);
    expect(result.pathRole).toBe("code");
    expect(result.fileRole).toBe("component");
  });

  it("does not let LSP override the test path role", () => {
    // A test file with one class that looks like an entity must stay test.
    const symbols: SymbolSummary[] = [
      { name: "FixtureBag", kind: "Class", line: 0 },
    ];
    const shape: SymbolShape = { classes: 1, properties: 9, methods: 0 };
    const result = classifyFileRole("src/CartTest.php", shape, symbols);
    expect(result.pathRole).toBe("test");
    expect(result.fileRole).toBe("test");
  });
});
