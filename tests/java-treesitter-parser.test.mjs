import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scripts/parsers/java-treesitter.mjs";

test("java parser extracts a public class and its methods qualified as Class.method", async () => {
  const source = [
    "package com.app;",
    "public class Foo {",
    "  public int bar(String x) { return x.length(); }",
    "  public String baz() { return \"b\"; }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Foo.java", "java");
  const byName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(byName.has("Foo"));
  assert.equal(byName.get("Foo").kind, "class");
  assert.equal(byName.get("Foo").exported, true);
  assert.ok(byName.has("Foo.bar"));
  assert.equal(byName.get("Foo.bar").kind, "method");
  assert.ok(byName.has("Foo.baz"));
});

test("java parser extracts interface and its abstract methods", async () => {
  const source = [
    "package com.app;",
    "public interface Handler {",
    "  Response handle(Request r);",
    "  String name();",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Handler.java", "java");
  const byName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.ok(byName.has("Handler"));
  assert.equal(byName.get("Handler").kind, "interface");
  assert.ok(byName.has("Handler.handle"));
  assert.ok(byName.has("Handler.name"));
});

test("java parser extracts enum and record kinds", async () => {
  const source = [
    "package com.app;",
    "public enum State { IDLE, RUNNING, ERROR }",
    "public record Point(int x, int y) { }"
  ].join("\n");

  const result = await parseCode(source, "Types.java", "java");
  const byName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.equal(byName.get("State").kind, "enum");
  assert.equal(byName.get("Point").kind, "record");
});

test("java parser qualifies nested classes and methods", async () => {
  const source = [
    "package com.app;",
    "public class Outer {",
    "  public static class Inner {",
    "    public int deep() { return 1; }",
    "  }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Outer.java", "java");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Outer"));
  assert.ok(names.has("Outer.Inner"));
  assert.ok(names.has("Outer.Inner.deep"));
});

test("java parser labels constructors with .ctor suffix", async () => {
  const source = [
    "package com.app;",
    "public class Svc {",
    "  private int n;",
    "  public Svc(int n) { this.n = n; }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Svc.java", "java");
  const ctor = result.chunks.find((c) => c.name === "Svc.ctor");

  assert.ok(ctor);
  assert.equal(ctor.kind, "constructor");
  assert.equal(ctor.exported, true);
});

test("java parser marks package-private and protected as not exported", async () => {
  const source = [
    "package com.app;",
    "class Internal {",
    "  protected int hidden() { return 1; }",
    "  int packagePrivate() { return 2; }",
    "  public int apiMethod() { return 3; }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Internal.java", "java");
  const byName = new Map(result.chunks.map((c) => [c.name, c]));

  assert.equal(byName.get("Internal").exported, false);
  assert.equal(byName.get("Internal.hidden").exported, false);
  assert.equal(byName.get("Internal.packagePrivate").exported, false);
  assert.equal(byName.get("Internal.apiMethod").exported, true);
});

test("java parser extracts method calls including selector chains", async () => {
  const source = [
    "package com.app;",
    "public class Runner {",
    "  public void go() {",
    "    Helper.load();",
    "    work();",
    "    obj.method();",
    "    System.out.println(\"hi\");",
    "  }",
    "  public void work() { }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Runner.java", "java");
  const go = result.chunks.find((c) => c.name === "Runner.go");

  assert.ok(go);
  assert.ok(go.calls.includes("load"));
  assert.ok(go.calls.includes("work"));
  assert.ok(go.calls.includes("method"));
  assert.ok(go.calls.includes("println"));
});

test("java parser filters super() and this() from call edges", async () => {
  const source = [
    "package com.app;",
    "public class Child extends Parent {",
    "  public Child() {",
    "    super();",
    "    this.init();",
    "  }",
    "  private void init() { }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Child.java", "java");
  const ctor = result.chunks.find((c) => c.name === "Child.ctor");

  assert.ok(ctor);
  assert.ok(ctor.calls.includes("init"));
  assert.ok(!ctor.calls.includes("super"));
  assert.ok(!ctor.calls.includes("this"));
});

test("java parser extracts plain and wildcard imports", async () => {
  const source = [
    "package com.app;",
    "import java.util.List;",
    "import java.util.*;",
    "import static java.lang.Math.PI;",
    "import static java.lang.Math.max;",
    "",
    "public class Use {",
    "  public int compute() { return max(1, 2); }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Use.java", "java");
  const chunk = result.chunks.find((c) => c.name === "Use.compute");

  assert.ok(chunk);
  assert.ok(chunk.imports.includes("java.util.List"));
  assert.ok(chunk.imports.some((i) => i === "java.util.*" || i.startsWith("java.util")));
  assert.ok(chunk.imports.includes("java.lang.Math.PI"));
  assert.ok(chunk.imports.includes("java.lang.Math.max"));
});

test("java parser handles generic class with bounded type parameter", async () => {
  const source = [
    "package com.app;",
    "public class Wrapper<T extends Comparable<T>> {",
    "  private T value;",
    "  public Wrapper(T v) { this.value = v; }",
    "  public T get() { return value; }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Wrapper.java", "java");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Wrapper"));
  assert.ok(names.has("Wrapper.ctor"));
  assert.ok(names.has("Wrapper.get"));
});

test("java parser handles annotated declarations", async () => {
  const source = [
    "package com.app;",
    "@Deprecated",
    "public class Old {",
    "  @Override",
    "  public String toString() { return \"old\"; }",
    "}"
  ].join("\n");

  const result = await parseCode(source, "Old.java", "java");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Old"));
  assert.ok(names.has("Old.toString"));
});

test("java parser handles empty input without errors", async () => {
  const result = await parseCode("", "empty.java", "java");
  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});
