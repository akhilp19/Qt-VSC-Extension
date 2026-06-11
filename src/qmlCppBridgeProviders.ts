import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QmlCppBridgeIndexer, CppQmlSymbol, QmlTypeInfo, QmlDirEntry } from './qmlCppBridge';

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

        // Check if this is a QML type instantiation (capitalized word at type position)
        const typeInfo = this.bridge.findQmlType(word);
        if (typeInfo && this.isTypeNameContext(document, position, word)) {
            this.outputChannel.appendLine(`[QML-C++ Bridge] Definition: type ${word} → ${typeInfo.filePath}:${typeInfo.line + 1}`);
            return new vscode.Location(
                vscode.Uri.file(typeInfo.filePath),
                new vscode.Position(typeInfo.line, typeInfo.character)
            );
        }

        // Determine context type for property/method
        let qmlTypeName = this.determineContextType(document, position, lineText, word);
        if (!qmlTypeName) {
            return undefined;
        }

        // Look up the symbol
        const symbol = this.bridge.findSymbol(qmlTypeName, word);
        if (symbol) {
            this.outputChannel.appendLine(`[QML-C++ Bridge] Definition: ${word} in ${qmlTypeName} → ${symbol.filePath}:${symbol.line + 1}`);
            return new vscode.Location(
                vscode.Uri.file(symbol.filePath),
                new vscode.Position(symbol.line, symbol.character)
            );
        }

        // Fallback: check qmldir-registered QML types
        const qmldirEntry = this.bridge.resolveQmlImport(word);
        if (qmldirEntry && fs.existsSync(qmldirEntry.filePath)) {
            this.outputChannel.appendLine(`[QML-C++ Bridge] Definition: ${word} → qmldir ${qmldirEntry.filePath}`);
            return new vscode.Location(
                vscode.Uri.file(qmldirEntry.filePath),
                new vscode.Position(0, 0)
            );
        }

        return undefined;
    }

    /**
     * Check if the word at position is in a QML type-name context (type instantiation).
     */
    private isTypeNameContext(document: vscode.TextDocument, position: vscode.Position, word: string): boolean {
        const lineText = document.lineAt(position).text;
        const beforeWord = lineText.substring(0, position.character);
        const afterWord = lineText.substring(position.character + word.length);

        // Type names are capitalized and appear at the start of a line or after braces
        // e.g., "MyType {" or "  MyType idName {" or "MyType.property"
        if (!/^[A-Z]/.test(word)) {
            return false;
        }

        // If followed by . it's a property access, not a type instantiation
        if (/^\s*\./.test(afterWord)) {
            return false;
        }

        // If preceded by . it's a property access
        if (/\.\s*$/.test(beforeWord)) {
            return false;
        }

        return true;
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

        // Check if we're typing a QML type name (capitalized, at beginning of expression)
        const wordRange = document.getWordRangeAtPosition(position, /[A-Z][a-zA-Z0-9_]*/);
        const word = wordRange ? document.getText(wordRange) : '';
        const isTypeContext = this.isQmlTypeContext(lineText, position, textBeforeCursor, word);

        if (isTypeContext) {
            return this.provideTypeCompletions();
        }

        // Determine if we're in a context where property/method completions make sense
        const enclosingType = this.findEnclosingQmlType(document, position);
        if (!enclosingType) {
            return [];
        }

        const symbols = this.bridge.findSymbolsForType(enclosingType);
        const items: vscode.CompletionItem[] = [];

        // Attached property support: if enclosingType has QML_ATTACHED, suggest attached type's symbols
        const enclosingTypeInfo = this.bridge.findQmlType(enclosingType);
        if (enclosingTypeInfo?.isAttached && enclosingTypeInfo.attachedType) {
            const attachedSymbols = this.bridge.findSymbolsForType(enclosingTypeInfo.attachedType);
            for (const symbol of attachedSymbols) {
                if (symbol.kind === 'property') {
                    const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Property);
                    item.detail = `${enclosingTypeInfo.attachedType} attached property`;
                    item.documentation = new vscode.MarkdownString(
                        `**Attached property** declared in C++ class \`${symbol.cppClassName}\`

\`\`\`cpp
${symbol.signature || symbol.name}
\`\`\``
                    );
                    item.insertText = new vscode.SnippetString(`${symbol.name}: \${1:value}`);
                    items.push(item);
                }
            }
        }

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

        // Add qmldir-registered types as completions when in type context
        if (isTypeContext) {
            const qmldirTypes = this.bridge.getQmldirTypes();
            for (const entry of qmldirTypes) {
                const item = new vscode.CompletionItem(entry.typeName, vscode.CompletionItemKind.Class);
                item.detail = `${entry.isSingleton ? 'Singleton' : 'Type'} — ${entry.moduleUri || 'QML module'}`;
                item.documentation = new vscode.MarkdownString(
                    `Defined in module \`${entry.moduleUri || 'unknown'}\` (v${entry.version})\n\n` +
                    `File: \`${path.basename(entry.filePath)}\``
                );
                item.insertText = entry.typeName;
                items.push(item);
            }
        }

        return items;
    }

    /**
     * Check if the cursor is in a QML type-name context.
     */
    private isQmlTypeContext(lineText: string, position: vscode.Position, textBeforeCursor: string, word: string): boolean {
        // Type names are capitalized
        if (!word || !/^[A-Z]/.test(word)) {
            return false;
        }

        // Check if we're at the start of a line expression (not after a dot)
        const trimmedBefore = textBeforeCursor.trim();
        if (trimmedBefore.endsWith('.') || trimmedBefore.endsWith('->')) {
            return false;
        }

        // Check if after the word we have a brace or id (type instantiation pattern)
        const afterWord = lineText.substring(position.character + word.length);
        if (/^\s*[\{\:]/.test(afterWord)) {
            return true;
        }

        // If we're at the very beginning of a line (modulo whitespace) with a capitalized word, likely a type
        if (/^\s*$/.test(textBeforeCursor.substring(0, textBeforeCursor.lastIndexOf(word)))) {
            return true;
        }

        return false;
    }

    private provideTypeCompletions(): vscode.CompletionItem[] {
        const types = this.bridge.getAllQmlTypes();
        const items: vscode.CompletionItem[] = [];

        for (const type of types) {
            const kind = type.isSingleton
                ? vscode.CompletionItemKind.Constant
                : vscode.CompletionItemKind.Class;
            const item = new vscode.CompletionItem(type.qmlTypeName, kind);
            item.detail = `${type.isSingleton ? 'Singleton' : 'Type'} — C++ class \`${type.cppClassName}\``;
            item.documentation = new vscode.MarkdownString(
                `Registered via **${type.isSingleton ? 'QML_SINGLETON + QML_ELEMENT' : 'QML_ELEMENT'}** ` +
                `in C++ class \`${type.cppClassName}\`\n\n` +
                `[Go to Definition](command:editor.action.revealDefinition?)`
            );
            item.insertText = type.qmlTypeName;
            items.push(item);
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
 * Provides hover information for QML type names registered in C++ via QML_ELEMENT / QML_SINGLETON.
 */
export class QmlTypeHoverProvider implements vscode.HoverProvider {
    private bridge: QmlCppBridgeIndexer;
    private outputChannel: vscode.OutputChannel;

    constructor(bridge: QmlCppBridgeIndexer, outputChannel: vscode.OutputChannel) {
        this.bridge = bridge;
        this.outputChannel = outputChannel;
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const wordRange = document.getWordRangeAtPosition(position, /[A-Z][a-zA-Z0-9_]*/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);
        const typeInfo = this.bridge.findQmlType(word);
        if (!typeInfo) {
            return undefined;
        }

        // Only show hover for type-name contexts (not property access)
        const lineText = document.lineAt(position).text;
        const beforeWord = lineText.substring(0, wordRange.start.character).trim();
        if (beforeWord.endsWith('.')) {
            return undefined;
        }

        const md = new vscode.MarkdownString();
        const registration = typeInfo.isSingleton
            ? 'QML_SINGLETON'
            : typeInfo.isAttached
                ? 'QML_ATTACHED'
                : 'QML_ELEMENT';
        md.appendCodeblock(
            `${typeInfo.isSingleton ? 'singleton ' : ''}${typeInfo.qmlTypeName} /* C++: ${typeInfo.cppClassName} */`,
            'qml'
        );
        md.appendMarkdown(
            `Registered in C++ via **${registration}**\n\n` +
            `- **File:** \`${path.basename(typeInfo.filePath)}\`\n` +
            `- **Line:** ${typeInfo.line + 1}\n`
        );
        if (typeInfo.isSingleton) {
            md.appendMarkdown('\n*Use as a singleton via `import` or direct property access.*');
        }
        if (typeInfo.isAttached && typeInfo.attachedType) {
            md.appendMarkdown(`\n*Attached type: \`${typeInfo.attachedType}\` — access properties via \`${typeInfo.qmlTypeName}.propertyName\`*`);
        }

        return new vscode.Hover(md, wordRange);
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
