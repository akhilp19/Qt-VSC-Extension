import * as vscode from 'vscode';
import { QmlCppBridgeIndexer, CppQmlSymbol } from './qmlCppBridge';

/**
 * Provides "Go to Definition" from QML property/method usages to C++ declarations.
 */
export class QmlDefinitionProvider implements vscode.DefinitionProvider {
    private bridge: QmlCppBridgeIndexer;
    private outputChannel: vscode.OutputChannel;

    constructor(bridge: QmlCppBridgeIndexer, outputChannel: vscode.OutputChannel) {
        this.bridge = bridge;
        this.outputChannel = outputChannel;
    }

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const lineText = document.lineAt(position).text;

        // Determine context type
        let qmlTypeName = this.determineContextType(document, position, lineText, word);
        if (!qmlTypeName) {
            return undefined;
        }

        // Look up the symbol
        const symbol = this.bridge.findSymbol(qmlTypeName, word);
        if (!symbol) {
            return undefined;
        }

        this.outputChannel.appendLine(`[QML-C++ Bridge] Definition: ${word} in ${qmlTypeName} → ${symbol.filePath}:${symbol.line + 1}`);
        return new vscode.Location(
            vscode.Uri.file(symbol.filePath),
            new vscode.Position(symbol.line, symbol.character)
        );
    }

    /**
     * Determine the QML type context for a symbol at the given position.
     */
    private determineContextType(document: vscode.TextDocument, position: vscode.Position, lineText: string, word: string): string | undefined {
        // Check if this is an id.property or id.method() pattern
        const idPattern = new RegExp(`(\\w+)\\.${word}\\b`);
        const idMatch = lineText.match(idPattern);
        if (idMatch) {
            const id = idMatch[1];
            const resolvedType = this.bridge.resolveIdType(id);
            if (resolvedType) {
                return resolvedType;
            }
        }

        // Check if this is a property binding inside the root type
        // Walk up to find the enclosing QML type
        return this.findEnclosingQmlType(document, position);
    }

    /**
     * Find the QML type name that encloses the given position by scanning upward.
     */
    private findEnclosingQmlType(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const lines = document.getText().split('\n');
        let braceDepth = 0;
        const typeStack: string[] = [];

        for (let i = 0; i <= position.line; i++) {
            const line = lines[i];

            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;

            // Detect type instantiation before counting braces for this line
            const typeMatch = line.match(/^\s*([A-Z][A-Za-z0-9_.]*)\s*(?:\{|\w+\s*\{)/);
            if (typeMatch) {
                const typeName = typeMatch[1];
                typeStack.push(typeName);
            }

            braceDepth += openBraces - closeBraces;

            // Pop types when we exit their block
            while (braceDepth < typeStack.length - 1 && typeStack.length > 0) {
                typeStack.pop();
            }
        }

        return typeStack[typeStack.length - 1];
    }
}

/**
 * Provides autocomplete for QML files based on C++-exposed Q_PROPERTY and Q_INVOKABLE symbols.
 */
export class QmlCompletionProvider implements vscode.CompletionItemProvider {
    private bridge: QmlCppBridgeIndexer;
    private outputChannel: vscode.OutputChannel;

    constructor(bridge: QmlCppBridgeIndexer, outputChannel: vscode.OutputChannel) {
        this.bridge = bridge;
        this.outputChannel = outputChannel;
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const lineText = document.lineAt(position).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        // Determine if we're in a context where property/method completions make sense
        const enclosingType = this.findEnclosingQmlType(document, position);
        if (!enclosingType) {
            return [];
        }

        const symbols = this.bridge.findSymbolsForType(enclosingType);
        if (symbols.length === 0) {
            return [];
        }

        const items: vscode.CompletionItem[] = [];

        for (const symbol of symbols) {
            if (symbol.kind === 'property') {
                const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Property);
                item.detail = `${symbol.qmlTypeName} property`;
                item.documentation = new vscode.MarkdownString(
                    `**Q_PROPERTY** declared in C++ class \`${symbol.cppClassName}\`\n\n` +
                    `\`\`\`cpp\n${symbol.signature || symbol.name}\n\`\`\``
                );
                item.insertText = new vscode.SnippetString(`${symbol.name}: \${1:value}`);
                items.push(item);
            } else if (symbol.kind === 'method') {
                const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Method);
                item.detail = `${symbol.qmlTypeName} method`;
                item.documentation = new vscode.MarkdownString(
                    `**Q_INVOKABLE** declared in C++ class \`${symbol.cppClassName}\`\n\n` +
                    `\`\`\`cpp\n${symbol.signature || `${symbol.name}()`}\n\`\`\``
                );
                item.insertText = new vscode.SnippetString(`${symbol.name}(\${1})`);
                items.push(item);
            }
        }

        return items;
    }

    private findEnclosingQmlType(document: vscode.TextDocument, position: vscode.Position): string | undefined {
        const lines = document.getText().split('\n');
        let braceDepth = 0;
        const typeStack: string[] = [];

        for (let i = 0; i <= position.line; i++) {
            const line = lines[i];
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;

            const typeMatch = line.match(/^\s*([A-Z][A-Za-z0-9_.]*)\s*(?:\{|\w+\s*\{)/);
            if (typeMatch) {
                typeStack.push(typeMatch[1]);
            }

            braceDepth += openBraces - closeBraces;

            while (braceDepth < typeStack.length - 1 && typeStack.length > 0) {
                typeStack.pop();
            }
        }

        return typeStack[typeStack.length - 1];
    }
}

/**
 * Provides "Find All References" from C++ Q_INVOKABLE/Q_PROPERTY declarations to QML usages.
 * Experimental — matches by symbol name only.
 */
export class CppReferenceProvider implements vscode.ReferenceProvider {
    private bridge: QmlCppBridgeIndexer;
    private outputChannel: vscode.OutputChannel;

    constructor(bridge: QmlCppBridgeIndexer, outputChannel: vscode.OutputChannel) {
        this.bridge = bridge;
        this.outputChannel = outputChannel;
    }

    provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Location[]> {
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const lineText = document.lineAt(position).text;

        // Verify this is a QML-relevant declaration by checking the line context
        const isQProperty = /Q_PROPERTY\s*\(/.test(lineText) || this.isNearQProperty(document, position);
        const isQInvokable = /Q_INVOKABLE/.test(lineText);

        if (!isQProperty && !isQInvokable) {
            return undefined;
        }

        const usages = this.bridge.findQmlUsages(word);
        if (usages.length === 0) {
            return [];
        }

        this.outputChannel.appendLine(`[QML-C++ Bridge] References for ${word}: ${usages.length} QML usage(s)`);

        return usages.map(u => new vscode.Location(
            vscode.Uri.file(u.filePath),
            new vscode.Position(u.line, u.character)
        ));
    }

    /**
     * Check if the word is inside a Q_PROPERTY declaration by looking at surrounding lines.
     */
    private isNearQProperty(document: vscode.TextDocument, position: vscode.Position): boolean {
        for (let i = Math.max(0, position.line - 2); i <= Math.min(document.lineCount - 1, position.line + 2); i++) {
            if (/Q_PROPERTY\s*\(/.test(document.lineAt(i).text)) {
                return true;
            }
        }
        return false;
    }
}
