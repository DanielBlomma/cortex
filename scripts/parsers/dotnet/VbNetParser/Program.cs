using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Text;
using Microsoft.CodeAnalysis.VisualBasic;
using Microsoft.CodeAnalysis.VisualBasic.Syntax;

var options = ParseArgs(args);
if (string.IsNullOrWhiteSpace(options.FilePath))
{
    Console.Error.WriteLine("Missing required --file argument.");
    Environment.Exit(1);
}

var source = options.UseStdin
    ? Console.In.ReadToEnd()
    : File.ReadAllText(options.FilePath);

var parseResult = ParseVisualBasic(source, options.FilePath, options.Language);
var json = JsonSerializer.Serialize(parseResult, new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = false
});

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
        }
    }

    return options;
}

static ParserOutput ParseVisualBasic(string source, string filePath, string language)
{
    var tree = VisualBasicSyntaxTree.ParseText(SourceText.From(source), path: filePath);
    var root = tree.GetCompilationUnitRoot();
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

    var collector = new VbChunkCollector(tree, root, source, language);
    return new ParserOutput(collector.Collect(), diagnostics);
}

sealed class VbChunkCollector
{
    private readonly SyntaxTree _tree;
    private readonly CompilationUnitSyntax _root;
    private readonly string _source;
    private readonly string _language;
    private readonly string[] _imports;

    public VbChunkCollector(SyntaxTree tree, CompilationUnitSyntax root, string source, string language)
    {
        _tree = tree;
        _root = root;
        _source = source;
        _language = language;
        _imports = root.Imports
            .SelectMany(importStatement => importStatement.ImportsClauses)
            .Select(GetImportName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    public List<ChunkOutput> Collect()
    {
        var chunks = new List<ChunkOutput>();

        foreach (var declaration in _root.Members)
        {
            CollectMember(chunks, declaration, null);
        }

        return chunks;
    }

    private void CollectMember(List<ChunkOutput> chunks, StatementSyntax member, string? parentName)
    {
        switch (member)
        {
            case NamespaceBlockSyntax namespaceBlock:
                foreach (var nested in namespaceBlock.Members)
                {
                    CollectMember(chunks, nested, parentName);
                }
                break;

            case ClassBlockSyntax classBlock:
                AddTypeChunk(chunks, classBlock.ClassStatement.Identifier.Text, "class", classBlock, parentName);
                foreach (var nested in classBlock.Members)
                {
                    CollectTypeMember(chunks, nested, classBlock.ClassStatement.Identifier.Text);
                }
                break;

            case ModuleBlockSyntax moduleBlock:
                AddTypeChunk(chunks, moduleBlock.ModuleStatement.Identifier.Text, "module", moduleBlock, parentName);
                foreach (var nested in moduleBlock.Members)
                {
                    CollectTypeMember(chunks, nested, moduleBlock.ModuleStatement.Identifier.Text);
                }
                break;

            case StructureBlockSyntax structureBlock:
                AddTypeChunk(chunks, structureBlock.StructureStatement.Identifier.Text, "structure", structureBlock, parentName);
                foreach (var nested in structureBlock.Members)
                {
                    CollectTypeMember(chunks, nested, structureBlock.StructureStatement.Identifier.Text);
                }
                break;

            case InterfaceBlockSyntax interfaceBlock:
                AddTypeChunk(chunks, interfaceBlock.InterfaceStatement.Identifier.Text, "interface", interfaceBlock, parentName);
                break;
        }
    }

    private void CollectTypeMember(List<ChunkOutput> chunks, StatementSyntax member, string parentTypeName)
    {
        switch (member)
        {
            case MethodBlockSyntax methodBlock:
                AddMethodChunk(chunks, methodBlock, parentTypeName);
                break;
            case ConstructorBlockSyntax constructorBlock:
                AddConstructorChunk(chunks, constructorBlock, parentTypeName);
                break;
            case PropertyBlockSyntax propertyBlock:
                AddPropertyChunk(chunks, propertyBlock, parentTypeName);
                break;
            case PropertyStatementSyntax propertyStatement:
                AddSimplePropertyChunk(chunks, propertyStatement, parentTypeName);
                break;
            case EventBlockSyntax eventBlock:
                AddTypeChunk(chunks, $"{parentTypeName}.{eventBlock.EventStatement.Identifier.Text}", "event", eventBlock, null);
                break;
            case FieldDeclarationSyntax fieldDeclaration:
                foreach (var declarator in fieldDeclaration.Declarators)
                {
                    foreach (var name in declarator.Names)
                    {
                        AddTypeChunk(chunks, $"{parentTypeName}.{name.Identifier.Text}", "field", fieldDeclaration, null);
                    }
                }
                break;
            case ClassBlockSyntax nestedClass:
                AddTypeChunk(chunks, $"{parentTypeName}.{nestedClass.ClassStatement.Identifier.Text}", "class", nestedClass, null);
                foreach (var nested in nestedClass.Members)
                {
                    CollectTypeMember(chunks, nested, nestedClass.ClassStatement.Identifier.Text);
                }
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

    private void AddMethodChunk(List<ChunkOutput> chunks, MethodBlockSyntax node, string parentTypeName)
    {
        var statement = node.BlockStatement;
        var name = $"{parentTypeName}.{statement.Identifier.Text}";
        var kind = statement.Kind() == SyntaxKind.SubStatement ? "method" : "function";
        chunks.Add(BuildChunk(
            name,
            kind,
            statement.ToString(),
            node,
            GetCalls(node),
            _imports,
            IsExported(statement)
        ));
    }

    private void AddConstructorChunk(List<ChunkOutput> chunks, ConstructorBlockSyntax node, string parentTypeName)
    {
        chunks.Add(BuildChunk(
            $"{parentTypeName}.New",
            "constructor",
            node.BlockStatement.ToString(),
            node,
            GetCalls(node),
            _imports,
            IsExported(node.BlockStatement)
        ));
    }

    private void AddPropertyChunk(List<ChunkOutput> chunks, PropertyBlockSyntax node, string parentTypeName)
    {
        chunks.Add(BuildChunk(
            $"{parentTypeName}.{node.PropertyStatement.Identifier.Text}",
            "property",
            node.PropertyStatement.ToString(),
            node,
            GetCalls(node),
            _imports,
            IsExported(node.PropertyStatement)
        ));
    }

    private void AddSimplePropertyChunk(List<ChunkOutput> chunks, PropertyStatementSyntax node, string parentTypeName)
    {
        chunks.Add(BuildChunk(
            $"{parentTypeName}.{node.Identifier.Text}",
            "property",
            node.ToString(),
            node,
            Array.Empty<string>(),
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
            ClassBlockSyntax classBlock => classBlock.ClassStatement.ToString(),
            ModuleBlockSyntax moduleBlock => moduleBlock.ModuleStatement.ToString(),
            StructureBlockSyntax structureBlock => structureBlock.StructureStatement.ToString(),
            InterfaceBlockSyntax interfaceBlock => interfaceBlock.InterfaceStatement.ToString(),
            _ => $"{kind} {name}"
        };
    }

    private static string GetImportName(ImportsClauseSyntax clause)
    {
        return clause switch
        {
            SimpleImportsClauseSyntax simpleClause => simpleClause.Name.ToString(),
            XmlNamespaceImportsClauseSyntax xmlClause => xmlClause.XmlNamespace.ToString(),
            AliasImportsClauseSyntax aliasClause => aliasClause.Name.ToString(),
            _ => clause.ToString()
        };
    }

    private static bool IsExported(SyntaxNode node)
    {
        SyntaxTokenList modifiers = node switch
        {
            TypeStatementSyntax typeStatement => typeStatement.Modifiers,
            MethodStatementSyntax methodStatement => methodStatement.Modifiers,
            PropertyStatementSyntax propertyStatement => propertyStatement.Modifiers,
            EventStatementSyntax eventStatement => eventStatement.Modifiers,
            FieldDeclarationSyntax fieldDeclaration => fieldDeclaration.Modifiers,
            _ => default
        };

        if (modifiers.Count == 0)
        {
            return false;
        }

        return modifiers.Any(modifier => modifier.IsKind(SyntaxKind.PublicKeyword));
    }

    private static IReadOnlyCollection<string> GetCalls(SyntaxNode node)
    {
        return node.DescendantNodes()
            .OfType<InvocationExpressionSyntax>()
            .Select(invocation => invocation.Expression)
            .Select(GetInvocationName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
    }

    private static string? GetInvocationName(ExpressionSyntax expression)
    {
        return expression switch
        {
            IdentifierNameSyntax identifier => identifier.Identifier.Text,
            GenericNameSyntax genericName => genericName.Identifier.Text,
            MemberAccessExpressionSyntax memberAccess => memberAccess.Name.Identifier.Text,
            InvocationExpressionSyntax nestedInvocation => GetInvocationName(nestedInvocation.Expression),
            _ => null
        };
    }
}

sealed record ParseOptions
{
    public bool UseStdin { get; set; }
    public string FilePath { get; set; } = "";
    public string Language { get; set; } = "vbnet";
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
