using System.Text.Json;
using System.Text.Json.Serialization;
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

var parseResult = ParseVisualBasic(source, options.FilePath, options.Language, options.Dialect);
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
            case "--dialect":
                options.Dialect = true;
                break;
        }
    }

    return options;
}

static ParserOutput ParseVisualBasic(string source, string filePath, string language, bool includeDialect)
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
        return new ParserOutput(
            new List<ChunkOutput>(),
            diagnostics,
            includeDialect ? new DialectPayload(new List<DialectCandidate>(), 0) : null
        );
    }

    var collector = new VbChunkCollector(tree, root, source, language);
    return new ParserOutput(
        collector.Collect(),
        diagnostics,
        includeDialect ? VbDialectCollector.Collect(root) : null
    );
}

static class VbDialectCollector
{
    private const int SerializedCandidateLimit = 513;

    public static DialectPayload Collect(CompilationUnitSyntax root)
    {
        var candidates = new List<DialectCandidate>();
        var identities = new HashSet<string>(StringComparer.Ordinal);
        var observedCount = 0;

        void Add(SyntaxNode node, string category, string kind, string form, int? ordinal = null)
        {
            if (node.Span.Length <= 0)
            {
                return;
            }
            var syntaxKind = node.Kind().ToString();
            var identity = string.Join("\0", node.SpanStart, node.Span.End, category, kind, form, syntaxKind, ordinal);
            if (!identities.Add(identity))
            {
                return;
            }
            observedCount += 1;
            if (candidates.Count < SerializedCandidateLimit)
            {
                candidates.Add(new DialectCandidate(
                    node.SpanStart,
                    node.Span.End,
                    category,
                    kind,
                    form,
                    syntaxKind,
                    ordinal
                ));
            }
        }

        foreach (var node in root.DescendantNodesAndSelf())
        {
            switch (node)
            {
                case CompilationUnitSyntax:
                    Add(node, "declaration_structure", "module", "declaration");
                    break;
                case NamespaceBlockSyntax:
                    Add(node, "declaration_structure", "namespace", "declaration");
                    break;
                case ConstructorBlockSyntax:
                    Add(node, "declaration_structure", "constructor", "declaration");
                    break;
                case MethodBlockSyntax method:
                    Add(node, "declaration_structure", method.BlockStatement.Kind() == SyntaxKind.FunctionStatement ? "function" : "method", "declaration");
                    if (HasTestAttribute(method.BlockStatement.AttributeLists))
                    {
                        Add(node, "test_shape", "test_declaration", "declaration");
                    }
                    break;
                case PropertyBlockSyntax:
                case PropertyStatementSyntax:
                    Add(node, "declaration_structure", "property", "declaration");
                    break;
                case FieldDeclarationSyntax:
                    Add(node, "declaration_structure", "field", "declaration");
                    Add(node, "data_representation", "field", "declaration");
                    break;
                case ParameterSyntax:
                    Add(node, "declaration_structure", "parameter", "declaration");
                    Add(node, "data_representation", "parameter", "declaration");
                    break;
                case ClassBlockSyntax:
                case ModuleBlockSyntax:
                case StructureBlockSyntax:
                case InterfaceBlockSyntax:
                case EnumBlockSyntax:
                    Add(node, "declaration_structure", "type", "declaration");
                    if (node is StructureBlockSyntax)
                    {
                        Add(node, "data_representation", "record", "declaration");
                    }
                    if (node is EnumBlockSyntax)
                    {
                        Add(node, "data_representation", "variant", "declaration");
                    }
                    break;
            }

            switch (node)
            {
                case MultiLineIfBlockSyntax:
                case SingleLineIfStatementSyntax:
                case SelectBlockSyntax:
                case TernaryConditionalExpressionSyntax:
                    Add(node, "control_flow", "branch", node is TernaryConditionalExpressionSyntax ? "expression" : "statement");
                    break;
                case ForBlockSyntax:
                case ForEachBlockSyntax:
                case WhileBlockSyntax:
                case DoLoopBlockSyntax:
                    Add(node, "control_flow", "loop", "statement");
                    break;
                case ReturnStatementSyntax:
                    Add(node, "control_flow", "early_return", "statement");
                    Add(node, "data_representation", "return", "statement");
                    break;
                case InvocationExpressionSyntax invocation:
                    Add(node, "control_flow", "delegation", "expression");
                    if (IsAssertion(invocation))
                    {
                        Add(node, "test_shape", "assertion", "expression");
                    }
                    break;
            }

            switch (node)
            {
                case ThrowStatementSyntax:
                    Add(node, "error_flow", "raise", "statement");
                    break;
                case TryBlockSyntax:
                case CatchBlockSyntax:
                    Add(node, "error_flow", "handler", node is CatchBlockSyntax ? "clause" : "statement");
                    break;
                case FinallyBlockSyntax:
                    Add(node, "error_flow", "cleanup", "clause");
                    break;
            }

            switch (node)
            {
                case VariableDeclaratorSyntax:
                    Add(node, "data_representation", "state", "declaration");
                    break;
                case ArrayCreationExpressionSyntax:
                case CollectionInitializerSyntax:
                    Add(node, "data_representation", "container", "expression");
                    break;
            }

            if (node is AttributeSyntax attribute)
            {
                var attributeName = QualifiedAttributeName(attribute.Name.ToString());
                if (new[] {
                    "Xunit.InlineData", "Xunit.MemberData", "Xunit.ClassData", "Xunit.Theory",
                    "NUnit.Framework.TestCase", "NUnit.Framework.TestCaseSource",
                    "Microsoft.VisualStudio.TestTools.UnitTesting.DataRow"
                }.Contains(attributeName, StringComparer.Ordinal))
                {
                    Add(node, "test_shape", "parameterization", "attribute");
                }
                else if (new[] {
                    "NUnit.Framework.SetUp", "NUnit.Framework.OneTimeSetUp",
                    "Microsoft.VisualStudio.TestTools.UnitTesting.TestInitialize"
                }.Contains(attributeName, StringComparer.Ordinal))
                {
                    Add(node, "test_shape", "setup", "attribute");
                }
                else if (new[] {
                    "NUnit.Framework.TearDown", "NUnit.Framework.OneTimeTearDown",
                    "Microsoft.VisualStudio.TestTools.UnitTesting.TestCleanup"
                }.Contains(attributeName, StringComparer.Ordinal))
                {
                    Add(node, "test_shape", "teardown", "attribute");
                }
                else if (new[] {
                    "Xunit.Collection", "NUnit.Framework.TestFixture",
                    "Microsoft.VisualStudio.TestTools.UnitTesting.TestClass"
                }.Contains(attributeName, StringComparer.Ordinal))
                {
                    Add(node, "test_shape", "suite", "attribute");
                }
            }
        }

        foreach (var callable in root.DescendantNodes().Where(node =>
                     node is MethodBlockSyntax or ConstructorBlockSyntax or LambdaExpressionSyntax))
        {
            var ordinal = 0;
            foreach (var invocation in callable.DescendantNodes().OfType<InvocationExpressionSyntax>())
            {
                var nearestCallable = invocation.Ancestors().FirstOrDefault(node =>
                    node is MethodBlockSyntax or ConstructorBlockSyntax or LambdaExpressionSyntax);
                if (!ReferenceEquals(nearestCallable, callable))
                {
                    continue;
                }
                Add(invocation, "control_flow", "ordered_calls", "expression", ordinal);
                ordinal += 1;
            }
        }

        return new DialectPayload(candidates, observedCount);
    }

    private static bool HasTestAttribute(SyntaxList<AttributeListSyntax> lists)
    {
        var expected = new HashSet<string>(new[] {
            "Xunit.Fact", "Xunit.Theory", "NUnit.Framework.Test", "NUnit.Framework.TestCase",
            "Microsoft.VisualStudio.TestTools.UnitTesting.TestMethod"
        }, StringComparer.Ordinal);
        return lists.SelectMany(list => list.Attributes)
            .Any(attribute => expected.Contains(QualifiedAttributeName(attribute.Name.ToString())));
    }

    private static bool IsAssertion(InvocationExpressionSyntax invocation)
    {
        var target = invocation.Expression.ToString().Replace("Global.", "", StringComparison.OrdinalIgnoreCase);
        return target.StartsWith("Xunit.Assert.", StringComparison.Ordinal) ||
            target.StartsWith("NUnit.Framework.Assert.", StringComparison.Ordinal) ||
            target.StartsWith("Microsoft.VisualStudio.TestTools.UnitTesting.Assert.", StringComparison.Ordinal) ||
            target.StartsWith("Microsoft.VisualStudio.TestTools.UnitTesting.CollectionAssert.", StringComparison.Ordinal) ||
            target.StartsWith("Microsoft.VisualStudio.TestTools.UnitTesting.StringAssert.", StringComparison.Ordinal);
    }

    private static string QualifiedAttributeName(string value)
    {
        var name = value.StartsWith("Global.", StringComparison.OrdinalIgnoreCase)
            ? value["Global.".Length..]
            : value;
        return name.EndsWith("Attribute", StringComparison.Ordinal)
            ? name[..^"Attribute".Length]
            : name;
    }
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
        var identifierText = statement switch
        {
            MethodStatementSyntax methodStmt => methodStmt.Identifier.Text,
            SubNewStatementSyntax => "New",
            OperatorStatementSyntax opStmt => opStmt.OperatorToken.Text,
            _ => statement.ToString().Split('(')[0].Trim()
        };
        var name = $"{parentTypeName}.{identifierText}";
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
            _ => clause.ToString()
        };
    }

    private static bool IsExported(SyntaxNode node)
    {
        SyntaxTokenList modifiers = node switch
        {
            TypeBlockSyntax typeBlock => typeBlock.BlockStatement.Modifiers,
            MethodBlockSyntax methodBlock => methodBlock.BlockStatement.Modifiers,
            PropertyBlockSyntax propertyBlock => propertyBlock.PropertyStatement.Modifiers,
            EventBlockSyntax eventBlock => eventBlock.EventStatement.Modifiers,
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
            .Select(name => name!)
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
    public bool Dialect { get; set; }
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

sealed record ParserOutput(
    List<ChunkOutput> Chunks,
    List<ParserError> Errors,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DialectPayload? Dialect
);

sealed record DialectPayload(
    List<DialectCandidate> Candidates,
    int ObservedCount
);

sealed record DialectCandidate(
    int StartOffset,
    int EndOffset,
    string Category,
    string Kind,
    string Form,
    string SyntaxKind,
    int? Ordinal
);
