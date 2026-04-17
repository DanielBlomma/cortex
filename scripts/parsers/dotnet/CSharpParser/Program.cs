using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

var options = ParseArgs(args);

if (options.Batch)
{
    RunBatchMode();
    return;
}

if (string.IsNullOrWhiteSpace(options.FilePath))
{
    Console.Error.WriteLine("Missing required --file argument (or use --batch for project-wide mode).");
    Environment.Exit(1);
}

var source = options.UseStdin
    ? Console.In.ReadToEnd()
    : File.ReadAllText(options.FilePath);

var parseResult = ParseCSharp(source, options.FilePath, options.Language, semanticModel: null);
var json = JsonSerializer.Serialize(parseResult, JsonOut());

Console.WriteLine(json);

return;

static ParseOptions ParseArgs(string[] args)
{
    var options = new ParseOptions();
    for (var index = 0; index < args.Length; index += 1)
    {
        var arg = args[index];
        switch (arg)
        {
            case "--stdin":
                options.UseStdin = true;
                break;
            case "--file":
                if (index + 1 < args.Length)
                {
                    options.FilePath = args[++index];
                }
                break;
            case "--language":
                if (index + 1 < args.Length)
                {
                    options.Language = args[++index];
                }
                break;
            case "--batch":
                options.Batch = true;
                break;
        }
    }

    return options;
}

static JsonSerializerOptions JsonOut() => new()
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = false
};

static JsonSerializerOptions JsonIn() => new()
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true
};

static ParserOutput ParseCSharp(string source, string filePath, string language, SemanticModel? semanticModel)
{
    var tree = semanticModel?.SyntaxTree ?? CSharpSyntaxTree.ParseText(source, path: filePath);
    var root = (CompilationUnitSyntax)tree.GetRoot();
    var diagnostics = tree.GetDiagnostics()
        .Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error)
        .Select(diagnostic => new ParserError(
            diagnostic.GetMessage(),
            diagnostic.Location.GetLineSpan().StartLinePosition.Line + 1,
            diagnostic.Location.GetLineSpan().StartLinePosition.Character + 1
        ))
        .ToList();

    if (diagnostics.Count > 0)
    {
        return new ParserOutput(new List<ChunkOutput>(), diagnostics);
    }

    var collector = new CSharpChunkCollector(tree, root, source, language, semanticModel);
    return new ParserOutput(collector.Collect(), diagnostics);
}

static void RunBatchMode()
{
    var input = Console.In.ReadToEnd();
    BatchInput? batch;
    try
    {
        batch = JsonSerializer.Deserialize<BatchInput>(input, JsonIn());
    }
    catch (JsonException ex)
    {
        Console.Error.WriteLine($"Invalid batch JSON: {ex.Message}");
        Environment.Exit(1);
        return;
    }

    if (batch?.Files == null || batch.Files.Count == 0)
    {
        var empty = new BatchOutput { Files = new Dictionary<string, ParserOutput>() };
        Console.WriteLine(JsonSerializer.Serialize(empty, JsonOut()));
        return;
    }

    var trees = batch.Files
        .Where(f => !string.IsNullOrEmpty(f.Path))
        .Select(f => CSharpSyntaxTree.ParseText(f.Source ?? string.Empty, path: f.Path!))
        .ToList();

    var references = Basic.Reference.Assemblies.Net100.References.All.ToList();
    var compilation = CSharpCompilation.Create(
        "Cortex",
        trees,
        references,
        new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary)
    );

    var result = new BatchOutput { Files = new Dictionary<string, ParserOutput>() };
    foreach (var tree in trees)
    {
        var model = compilation.GetSemanticModel(tree);
        var file = batch.Files.First(f => f.Path == tree.FilePath);
        var parseResult = ParseCSharp(file.Source ?? string.Empty, tree.FilePath, "csharp", model);
        result.Files[tree.FilePath] = parseResult;
    }

    Console.WriteLine(JsonSerializer.Serialize(result, JsonOut()));
}

sealed class CSharpChunkCollector
{
    private readonly SyntaxTree _tree;
    private readonly CompilationUnitSyntax _root;
    private readonly string _source;
    private readonly string _language;
    private readonly SemanticModel? _model;
    private readonly string[] _imports;

    public CSharpChunkCollector(SyntaxTree tree, CompilationUnitSyntax root, string source, string language, SemanticModel? model)
    {
        _tree = tree;
        _root = root;
        _source = source;
        _language = language;
        _model = model;
        _imports = CollectUsings(root);
    }

    private static string[] CollectUsings(CompilationUnitSyntax root)
    {
        var usings = new List<string>();

        foreach (var directive in root.Usings)
        {
            var name = directive.Name?.ToString();
            if (!string.IsNullOrWhiteSpace(name))
            {
                usings.Add(name);
            }
        }

        foreach (var member in root.Members)
        {
            if (member is BaseNamespaceDeclarationSyntax ns)
            {
                foreach (var directive in ns.Usings)
                {
                    var name = directive.Name?.ToString();
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        usings.Add(name);
                    }
                }
            }
        }

        return usings.Distinct(StringComparer.Ordinal).ToArray();
    }

    public List<ChunkOutput> Collect()
    {
        var chunks = new List<ChunkOutput>();
        foreach (var member in _root.Members)
        {
            CollectMember(chunks, member, null);
        }
        return chunks;
    }

    private void CollectMember(List<ChunkOutput> chunks, MemberDeclarationSyntax member, string? parentName)
    {
        switch (member)
        {
            case BaseNamespaceDeclarationSyntax namespaceDecl:
                foreach (var nested in namespaceDecl.Members)
                {
                    CollectMember(chunks, nested, parentName);
                }
                break;

            case ClassDeclarationSyntax classDecl:
                AddTypeChunk(chunks, classDecl.Identifier.Text, "class", classDecl, parentName);
                foreach (var nested in classDecl.Members)
                {
                    CollectTypeMember(chunks, nested, classDecl.Identifier.Text);
                }
                break;

            case StructDeclarationSyntax structDecl:
                AddTypeChunk(chunks, structDecl.Identifier.Text, "struct", structDecl, parentName);
                foreach (var nested in structDecl.Members)
                {
                    CollectTypeMember(chunks, nested, structDecl.Identifier.Text);
                }
                break;

            case InterfaceDeclarationSyntax interfaceDecl:
                AddTypeChunk(chunks, interfaceDecl.Identifier.Text, "interface", interfaceDecl, parentName);
                foreach (var nested in interfaceDecl.Members)
                {
                    CollectTypeMember(chunks, nested, interfaceDecl.Identifier.Text);
                }
                break;

            case EnumDeclarationSyntax enumDecl:
                AddTypeChunk(chunks, enumDecl.Identifier.Text, "enum", enumDecl, parentName);
                break;

            case RecordDeclarationSyntax recordDecl:
                AddTypeChunk(chunks, recordDecl.Identifier.Text, "record", recordDecl, parentName);
                foreach (var nested in recordDecl.Members)
                {
                    CollectTypeMember(chunks, nested, recordDecl.Identifier.Text);
                }
                break;
        }
    }

    private void CollectTypeMember(List<ChunkOutput> chunks, MemberDeclarationSyntax member, string parentTypeName)
    {
        switch (member)
        {
            case MethodDeclarationSyntax methodDecl:
                AddMethodChunk(chunks, methodDecl, parentTypeName);
                break;
            case ConstructorDeclarationSyntax ctorDecl:
                AddConstructorChunk(chunks, ctorDecl, parentTypeName);
                break;
            case PropertyDeclarationSyntax propDecl:
                AddPropertyChunk(chunks, propDecl, parentTypeName);
                break;
            case EventDeclarationSyntax eventDecl:
                AddTypeChunk(chunks, $"{parentTypeName}.{eventDecl.Identifier.Text}", "event", eventDecl, null);
                break;
            case FieldDeclarationSyntax fieldDecl:
                foreach (var variable in fieldDecl.Declaration.Variables)
                {
                    AddTypeChunk(chunks, $"{parentTypeName}.{variable.Identifier.Text}", "field", fieldDecl, null);
                }
                break;
            case ClassDeclarationSyntax nestedClass:
                AddTypeChunk(chunks, $"{parentTypeName}.{nestedClass.Identifier.Text}", "class", nestedClass, null);
                foreach (var nested in nestedClass.Members)
                {
                    CollectTypeMember(chunks, nested, $"{parentTypeName}.{nestedClass.Identifier.Text}");
                }
                break;
            case StructDeclarationSyntax nestedStruct:
                AddTypeChunk(chunks, $"{parentTypeName}.{nestedStruct.Identifier.Text}", "struct", nestedStruct, null);
                foreach (var nested in nestedStruct.Members)
                {
                    CollectTypeMember(chunks, nested, $"{parentTypeName}.{nestedStruct.Identifier.Text}");
                }
                break;
            case RecordDeclarationSyntax nestedRecord:
                AddTypeChunk(chunks, $"{parentTypeName}.{nestedRecord.Identifier.Text}", "record", nestedRecord, null);
                foreach (var nested in nestedRecord.Members)
                {
                    CollectTypeMember(chunks, nested, $"{parentTypeName}.{nestedRecord.Identifier.Text}");
                }
                break;
            case EnumDeclarationSyntax nestedEnum:
                AddTypeChunk(chunks, $"{parentTypeName}.{nestedEnum.Identifier.Text}", "enum", nestedEnum, null);
                break;
        }
    }

    private void AddTypeChunk(List<ChunkOutput> chunks, string name, string kind, SyntaxNode node, string? parentName)
    {
        chunks.Add(BuildChunk(
            parentName is null ? name : $"{parentName}.{name}",
            kind,
            BuildSignature(kind, name, node),
            node,
            GetCalls(node),
            _imports,
            IsExported(node)
        ));
    }

    private void AddMethodChunk(List<ChunkOutput> chunks, MethodDeclarationSyntax node, string parentTypeName)
    {
        var name = $"{parentTypeName}.{node.Identifier.Text}";
        chunks.Add(BuildChunk(
            name,
            "method",
            $"{node.ReturnType} {node.Identifier.Text}{node.ParameterList}",
            node,
            GetCalls(node),
            _imports,
            IsExported(node)
        ));
    }

    private void AddConstructorChunk(List<ChunkOutput> chunks, ConstructorDeclarationSyntax node, string parentTypeName)
    {
        chunks.Add(BuildChunk(
            $"{parentTypeName}.ctor",
            "constructor",
            $"{node.Identifier.Text}{node.ParameterList}",
            node,
            GetCalls(node),
            _imports,
            IsExported(node)
        ));
    }

    private void AddPropertyChunk(List<ChunkOutput> chunks, PropertyDeclarationSyntax node, string parentTypeName)
    {
        chunks.Add(BuildChunk(
            $"{parentTypeName}.{node.Identifier.Text}",
            "property",
            $"{node.Type} {node.Identifier.Text}",
            node,
            GetCalls(node),
            _imports,
            IsExported(node)
        ));
    }

    private ChunkOutput BuildChunk(
        string name,
        string kind,
        string signature,
        SyntaxNode node,
        IReadOnlyCollection<string> calls,
        IReadOnlyCollection<string> imports,
        bool exported)
    {
        var span = node.GetLocation().GetLineSpan();
        return new ChunkOutput(
            name,
            kind,
            signature,
            node.ToFullString(),
            span.StartLinePosition.Line + 1,
            span.EndLinePosition.Line + 1,
            _language,
            exported,
            calls.ToArray(),
            imports.ToArray()
        );
    }

    private static string BuildSignature(string kind, string name, SyntaxNode node)
    {
        return node switch
        {
            ClassDeclarationSyntax c => $"{ModifiersOf(c.Modifiers)} class {c.Identifier}{c.TypeParameterList}{BaseListOf(c.BaseList)}".Trim(),
            StructDeclarationSyntax s => $"{ModifiersOf(s.Modifiers)} struct {s.Identifier}{s.TypeParameterList}{BaseListOf(s.BaseList)}".Trim(),
            InterfaceDeclarationSyntax i => $"{ModifiersOf(i.Modifiers)} interface {i.Identifier}{i.TypeParameterList}{BaseListOf(i.BaseList)}".Trim(),
            EnumDeclarationSyntax e => $"{ModifiersOf(e.Modifiers)} enum {e.Identifier}{BaseListOf(e.BaseList)}".Trim(),
            RecordDeclarationSyntax r => $"{ModifiersOf(r.Modifiers)} record {r.Identifier}{r.TypeParameterList}{r.ParameterList}{BaseListOf(r.BaseList)}".Trim(),
            _ => $"{kind} {name}"
        };
    }

    private static string ModifiersOf(SyntaxTokenList modifiers)
    {
        return modifiers.Count > 0 ? modifiers.ToString() : "";
    }

    private static string BaseListOf(BaseListSyntax? baseList)
    {
        return baseList is not null ? $" : {baseList.Types}" : "";
    }

    private static bool IsExported(SyntaxNode node)
    {
        SyntaxTokenList modifiers = node switch
        {
            TypeDeclarationSyntax typeDecl => typeDecl.Modifiers,
            MethodDeclarationSyntax methodDecl => methodDecl.Modifiers,
            ConstructorDeclarationSyntax ctorDecl => ctorDecl.Modifiers,
            PropertyDeclarationSyntax propDecl => propDecl.Modifiers,
            EventDeclarationSyntax eventDecl => eventDecl.Modifiers,
            FieldDeclarationSyntax fieldDecl => fieldDecl.Modifiers,
            _ => default
        };

        if (modifiers.Count == 0)
        {
            return false;
        }

        return modifiers.Any(modifier => modifier.IsKind(SyntaxKind.PublicKeyword));
    }

    private IReadOnlyCollection<string> GetCalls(SyntaxNode node)
    {
        return node.DescendantNodes()
            .OfType<InvocationExpressionSyntax>()
            .Select(ResolveCallName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private string? ResolveCallName(InvocationExpressionSyntax invocation)
    {
        if (_model != null)
        {
            var info = _model.GetSymbolInfo(invocation);
            var method = info.Symbol as IMethodSymbol
                ?? info.CandidateSymbols.OfType<IMethodSymbol>().FirstOrDefault();
            if (method != null)
            {
                return FullyQualifiedMethodName(method);
            }
        }
        return GetInvocationSyntaxName(invocation.Expression);
    }

    private static string FullyQualifiedMethodName(IMethodSymbol method)
    {
        var container = method.ContainingType?.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat) ?? "";
        if (container.StartsWith("global::", StringComparison.Ordinal))
        {
            container = container.Substring("global::".Length);
        }
        return string.IsNullOrEmpty(container) ? method.Name : $"{container}.{method.Name}";
    }

    private static string? GetInvocationSyntaxName(ExpressionSyntax expression)
    {
        return expression switch
        {
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            GenericNameSyntax genericName => genericName.Identifier.Text,
            MemberAccessExpressionSyntax memberAccess => memberAccess.Name.Identifier.Text,
            InvocationExpressionSyntax nestedInvocation => GetInvocationSyntaxName(nestedInvocation.Expression),
            _ => null
        };
    }
}

sealed record ParseOptions
{
    public bool UseStdin { get; set; }
    public bool Batch { get; set; }
    public string FilePath { get; set; } = "";
    public string Language { get; set; } = "csharp";
}

sealed record ChunkOutput(
    string Name,
    string Kind,
    string Signature,
    string Body,
    int StartLine,
    int EndLine,
    string Language,
    bool Exported,
    string[] Calls,
    string[] Imports
);

sealed record ParserError(string Message, int Line, int Column);

sealed record ParserOutput(List<ChunkOutput> Chunks, List<ParserError> Errors);

sealed class BatchInput
{
    public List<BatchFile> Files { get; set; } = new();
}

sealed class BatchFile
{
    public string? Path { get; set; }
    public string? Source { get; set; }
}

sealed class BatchOutput
{
    public Dictionary<string, ParserOutput> Files { get; set; } = new();
}
