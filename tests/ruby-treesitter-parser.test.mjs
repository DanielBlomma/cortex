import test from "node:test";
import assert from "node:assert/strict";
import { parseCode } from "../scaffold/scripts/parsers/ruby-treesitter.mjs";

test("ruby parser extracts a top-level method", async () => {
  const source = [
    "def add(a, b)",
    "  a + b",
    "end"
  ].join("\n");

  const result = await parseCode(source, "math.rb", "ruby");
  const chunk = result.chunks.find((c) => c.name === "add");

  assert.ok(chunk);
  assert.equal(chunk.kind, "method");
  assert.equal(chunk.language, "ruby");
});

test("ruby parser qualifies instance methods with Class#method", async () => {
  const source = [
    "class Dog",
    "  def bark",
    "    'woof'",
    "  end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "dog.rb", "ruby");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("Dog"));
  assert.ok(names.includes("Dog#bark"));
  const method = result.chunks.find((c) => c.name === "Dog#bark");
  assert.equal(method.kind, "method");
});

test("ruby parser qualifies singleton methods with Class.method", async () => {
  const source = [
    "class Config",
    "  def self.load(path)",
    "    File.read(path)",
    "  end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "config.rb", "ruby");
  const names = result.chunks.map((c) => c.name);

  assert.ok(names.includes("Config"));
  assert.ok(names.includes("Config.load"));
  const singleton = result.chunks.find((c) => c.name === "Config.load");
  assert.equal(singleton.kind, "class_method");
});

test("ruby parser distinguishes instance and singleton methods by separator", async () => {
  const source = [
    "class User",
    "  def name",
    "    @name",
    "  end",
    "  def self.create(attrs)",
    "    new(**attrs)",
    "  end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "user.rb", "ruby");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("User#name"), "instance method should use #");
  assert.ok(names.has("User.create"), "singleton method should use .");
});

test("ruby parser qualifies nested module and class with ::", async () => {
  const source = [
    "module App",
    "  class User",
    "    def full_name",
    "      @name",
    "    end",
    "  end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "app.rb", "ruby");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("App"));
  assert.ok(names.has("App::User"));
  assert.ok(names.has("App::User#full_name"));
});

test("ruby parser extracts calls and filters out stdlib noise", async () => {
  const source = [
    "class Runner",
    "  def go",
    "    helper()",
    "    obj.method",
    "    SomeClass.class_method(arg)",
    "    puts 'hi'",
    "  end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "r.rb", "ruby");
  const go = result.chunks.find((c) => c.name === "Runner#go");

  assert.ok(go);
  assert.ok(go.calls.includes("helper"));
  assert.ok(go.calls.includes("method"));
  assert.ok(go.calls.includes("class_method"));
  assert.ok(!go.calls.includes("puts"), "puts should be filtered as stdlib noise");
});

test("ruby parser extracts require, require_relative, and autoload paths", async () => {
  const source = [
    "require 'json'",
    "require_relative './util'",
    "require 'active_record'",
    "autoload :Logger, 'logger'",
    "",
    "class App",
    "  def run",
    "    nil",
    "  end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "app.rb", "ruby");
  const run = result.chunks.find((c) => c.name === "App#run");

  assert.ok(run);
  assert.ok(run.imports.includes("json"));
  assert.ok(run.imports.includes("./util"));
  assert.ok(run.imports.includes("active_record"));
  assert.ok(run.imports.includes("logger"));
});

test("ruby parser ignores require calls made inside method bodies", async () => {
  const source = [
    "class Lazy",
    "  def load_json",
    "    require 'json'",
    "    JSON.parse('{}')",
    "  end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "lazy.rb", "ruby");
  const run = result.chunks.find((c) => c.name === "Lazy#load_json");

  assert.ok(run);
  // The require inside the method body should NOT be promoted to the
  // file-level imports — but it also shouldn't appear as a call edge
  // because require is in the CALL_FILTER.
  assert.ok(!run.calls.includes("require"));
});

test("ruby parser marks _-prefixed method names as not exported", async () => {
  const source = [
    "class Svc",
    "  def public_api; end",
    "  def _internal; end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "svc.rb", "ruby");
  const api = result.chunks.find((c) => c.name === "Svc#public_api");
  const internal = result.chunks.find((c) => c.name === "Svc#_internal");

  assert.equal(api.exported, true);
  assert.equal(internal.exported, false);
});

test("ruby parser handles class inheritance", async () => {
  const source = [
    "class Dog < Animal",
    "  def bark",
    "    'woof'",
    "  end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "dog.rb", "ruby");
  const cls = result.chunks.find((c) => c.name === "Dog");

  assert.ok(cls);
  assert.equal(cls.kind, "class");
});

test("ruby parser handles modules with both instance and singleton methods", async () => {
  const source = [
    "module Utils",
    "  def self.helper",
    "    'util'",
    "  end",
    "  def instance_m",
    "    1",
    "  end",
    "end"
  ].join("\n");

  const result = await parseCode(source, "utils.rb", "ruby");
  const names = new Set(result.chunks.map((c) => c.name));

  assert.ok(names.has("Utils"));
  assert.ok(names.has("Utils.helper"));
  assert.ok(names.has("Utils#instance_m"));
});

test("ruby parser handles empty input without errors", async () => {
  const result = await parseCode("", "empty.rb", "ruby");
  assert.deepEqual(result.errors, []);
  assert.equal(result.chunks.length, 0);
});
