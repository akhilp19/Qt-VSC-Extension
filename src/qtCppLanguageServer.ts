#!/usr/bin/env node
import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    TextDocumentSyncKind,
    CompletionItem,
    CompletionItemKind,
    Hover,
    MarkupKind,
    Definition,
    Location,
    ReferenceParams,
    RenameParams,
    WorkspaceEdit,
    CodeAction,
    CodeActionKind,
    Diagnostic,
    DiagnosticSeverity,
    Range,
    Position,
    TextDocumentPositionParams,
    TextDocumentChangeEvent,
    DidChangeConfigurationNotification,
    TextDocumentIdentifier,
    OptionalVersionedTextDocumentIdentifier,
    CodeActionParams,
    DidChangeConfigurationParams
} from 'vscode-languageserver/lib/node/main';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { findQtClass, searchQtMethods, QtMethod } from './qtApiData';

// ─────────────────────────────────────────────────────────────
// Index data structures
// ─────────────────────────────────────────────────────────────

type QtSymbolKind = 'signal' | 'slot' | 'method' | 'property' | 'class' | 'qml-type';

interface QtSymbol {
    uri: string;
    range: Range;
    name: string;
    kind: QtSymbolKind;
    className: string;
    signature?: string;
    qmlTypeName?: string;
    propertyType?: string;
    docs?: string;
}

interface QtClass {
    uri: string;
    range: Range;
    name: string;
    baseClasses: string[];
    hasQObject: boolean;
    symbols: Map<string, QtSymbol>;
    qmlTypeName?: string;
}

interface ConnectCall {
    uri: string;
    range: Range;
    senderVar?: string;
    senderRange?: Range;
    signalName?: string;
    signalRange?: Range;
    receiverVar?: string;
    receiverRange?: Range;
    slotName?: string;
    slotRange?: Range;
}

interface EmitCall {
    uri: string;
    range: Range;
    signalName: string;
    className?: string;
}

interface DocumentIndex {
    classes: Map<string, QtClass>;
    symbols: Map<string, QtSymbol[]>;
    connects: ConnectCall[];
    emits: EmitCall[];
}

// ─────────────────────────────────────────────────────────────
// Connection & documents
// ─────────────────────────────────────────────────────────────

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const workspaceIndexes = new Map<string, DocumentIndex>();
let workspaceFolders: string[] = [];
let qtIncludePath: string | undefined;
let diagnosticsEnabled = true;
let mocIntelliSenseV2Enabled = true;

// ─────────────────────────────────────────────────────────────
// Initialize
// ─────────────────────────────────────────────────────────────

connection.onInitialize((params: InitializeParams): InitializeResult => {
    workspaceFolders = (params.workspaceFolders || []).map((f: { uri: string }) => f.uri.replace('file://', ''));
    const initOptions = params.initializationOptions as Record<string, unknown> | undefined;
    qtIncludePath = typeof initOptions?.qtIncludePath === 'string' ? initOptions.qtIncludePath : undefined;
    diagnosticsEnabled = initOptions?.diagnosticsEnabled !== false;
    mocIntelliSenseV2Enabled = initOptions?.mocIntelliSenseV2Enabled !== false;

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                triggerCharacters: ['.', '>', ':', '(', '&']
            },
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            renameProvider: { prepareProvider: true },
            codeActionProvider: true,
            diagnosticProvider: {
                identifier: 'qt-cpp',
                interFileDependencies: true,
                workspaceDiagnostics: false
            }
        }
    };
});

connection.onInitialized(() => {
    void connection.client.register(DidChangeConfigurationNotification.type, undefined);
});

// ─────────────────────────────────────────────────────────────
// Parsing helpers
// ─────────────────────────────────────────────────────────────

function getLine(text: string, offset: number): { line: number; character: number } {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset; i++) {
        if (text[i] === '\n') {
            line++;
            character = 0;
        } else {
            character++;
        }
    }
    return { line, character };
}

function rangeFromMatch(text: string, match: RegExpMatchArray, groupIndex = 0): Range {
    const startOffset = match.index ?? 0;
    const endOffset = startOffset + match[groupIndex].length;
    return {
        start: getLine(text, startOffset),
        end: getLine(text, endOffset)
    };
}

function getWordRange(text: string, line: number, character: number): Range | undefined {
    const lines = text.split('\n');
    const lineText = lines[line];
    if (!lineText) { return undefined; }

    let start = character;
    while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1] ?? '')) {
        start--;
    }
    let end = character;
    while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end] ?? '')) {
        end++;
    }

    if (start === end) { return undefined; }
    return { start: { line, character: start }, end: { line, character: end } };
}

function getWordAt(text: string, line: number, character: number): string | undefined {
    const range = getWordRange(text, line, character);
    if (!range) { return undefined; }
    const lines = text.split('\n');
    return lines[line].substring(range.start.character, range.end.character);
}

function stripComments(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/.*$/gm, '');
}

function normalizePropertyType(type: string): string {
    return type
        .replace(/\s+/g, '')
        .replace(/(?:const|volatile|mutable|static|constexpr)\b/g, '')
        .replace(/[*&]+$/, '')
        .replace(/<.*>/, '')
        .trim();
}

// ─────────────────────────────────────────────────────────────
// Indexer
// ─────────────────────────────────────────────────────────────

function indexDocument(uri: string, text: string): DocumentIndex {
    const index: DocumentIndex = {
        classes: new Map(),
        symbols: new Map(),
        connects: [],
        emits: []
    };

    const filePath = uri.replace('file://', '');
    const code = stripComments(text);
    const lines = code.split('\n');

    let braceDepth = 0;
    let currentClass: QtClass | undefined;
    let inSignals = false;
    let inSlots = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Track brace depth
        for (const ch of line) {
            if (ch === '{') { braceDepth++; }
            else if (ch === '}') {
                braceDepth--;
                if (currentClass && braceDepth <= 0) {
                    currentClass = undefined;
                    inSignals = false;
                    inSlots = false;
                }
            }
        }

        // Class declaration
        const classMatch = trimmed.match(/class\s+(?:Q_\w+\s+)?(\w+)(?:\s*:\s*(.+?))?\s*(?:\{|\{|$)/);
        if (classMatch) {
            const className = classMatch[1];
            const baseClause = classMatch[2] || '';
            const baseClasses = baseClause.split(',').map(b => {
                const parts = b.trim().split(/\s+/);
                return parts[parts.length - 1] || '';
            }).filter(Boolean);

            currentClass = {
                uri,
                range: { start: { line: i, character: 0 }, end: { line: i, character: line.length } },
                name: className,
                baseClasses,
                hasQObject: false,
                symbols: new Map()
            };
            index.classes.set(className, currentClass);
            braceDepth++;
            inSignals = false;
            inSlots = false;
            continue;
        }

        if (!currentClass) { continue; }

        // Q_OBJECT
        if (/\bQ_OBJECT\b/.test(trimmed)) {
            currentClass.hasQObject = true;
        }

        // QML_ELEMENT / QML_NAMED_ELEMENT
        const namedElementMatch = trimmed.match(/QML_NAMED_ELEMENT\s*\(\s*"([^"]+)"\s*\)/);
        if (namedElementMatch) {
            currentClass.qmlTypeName = namedElementMatch[1];
        } else if (/\bQML_ELEMENT\b/.test(trimmed)) {
            currentClass.qmlTypeName = currentClass.name;
        }

        // signals: / Q_SIGNALS
        if (/^(?:public\s+|protected\s+|private\s+)?signals\s*:/.test(trimmed) || /\bQ_SIGNALS\s*:/.test(trimmed)) {
            inSignals = true;
            inSlots = false;
            continue;
        }

        // slots: / Q_SLOTS
        if (/^(?:public\s+|protected\s+|private\s+)?slots\s*:/.test(trimmed) || /\bQ_SLOTS\s*:/.test(trimmed)) {
            inSignals = false;
            inSlots = true;
            continue;
        }

        // Access specifiers reset signals/slots
        if (/^\s*(public|protected|private)\s*:/.test(trimmed)) {
            inSignals = false;
            inSlots = false;
        }

        // Q_PROPERTY
        const propMatch = trimmed.match(/Q_PROPERTY\s*\(\s*([^)]+)\)/);
        if (propMatch) {
            const tokens = propMatch[1].trim().split(/\s+/);
            if (tokens.length >= 2) {
                const propName = tokens[1];
                const propType = normalizePropertyType(tokens[0]);
                addSymbol(index, currentClass, {
                    uri,
                    range: rangeFromMatch(code, propMatch, 1),
                    name: propName,
                    kind: 'property',
                    className: currentClass.name,
                    signature: propMatch[1].trim(),
                    propertyType: propType
                });
            }
        }

        // Q_INVOKABLE and methods
        const methodMatch = trimmed.match(/(?:(Q_INVOKABLE)\s+)?(?:virtual\s+)?(?:[^\s;()]+\s+)+(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?\s*(?:override\s*)?\s*(?:=\s*0\s*)?;/);
        if (methodMatch) {
            const isInvokable = !!methodMatch[1];
            const methodName = methodMatch[2];
            const signature = `(${methodMatch[3]})`;
            let kind: QtSymbolKind = 'method';
            if (inSignals) { kind = 'signal'; }
            else if (inSlots) { kind = 'slot'; }
            else if (isInvokable) { kind = 'method'; }
            else { continue; }

            addSymbol(index, currentClass, {
                uri,
                range: { start: { line: i, character: line.indexOf(methodName) }, end: { line: i, character: line.indexOf(methodName) + methodName.length } },
                name: methodName,
                kind,
                className: currentClass.name,
                signature
            });
        }
    }

    // Second pass: find connect() and emit() calls
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // emit calls
        const emitRegex = /\bemit\s+(\w+)\s*\(/g;
        let emitMatch: RegExpExecArray | null;
        while ((emitMatch = emitRegex.exec(line)) !== null) {
            index.emits.push({
                uri,
                range: rangeFromMatch(code, emitMatch, 1),
                signalName: emitMatch[1]
            });
        }

        // connect calls (simplified single-line parsing)
        const connectRegex = /\bconnect\s*\(/g;
        let connectMatch: RegExpExecArray | null;
        while ((connectMatch = connectRegex.exec(line)) !== null) {
            const startIdx = connectMatch.index + connectMatch[0].length;
            const callText = line.substring(startIdx);
            const callMatch = callText.match(/^\s*([^,]+),\s*([^,]+),\s*([^,]+)(?:,\s*([^)]+))?\s*\)/);
            if (callMatch) {
                const signalMacro = callMatch[2].trim();
                const slotMacro = callMatch[4]?.trim();
                const signalName = extractMacroName(signalMacro);
                const slotName = slotMacro ? extractMacroName(slotMacro) : undefined;

                index.connects.push({
                    uri,
                    range: { start: getLine(code, connectMatch.index), end: getLine(code, connectMatch.index + connectMatch[0].length + (callMatch[0]?.length || 0)) },
                    senderVar: callMatch[1].trim(),
                    signalName,
                    receiverVar: callMatch[3].trim(),
                    slotName
                });
            }
        }
    }

    // Optional: run moc to validate and enrich
    if (filePath.endsWith('.h') || filePath.endsWith('.hpp')) {
        enrichWithMoc(index, filePath, text);
    }

    return index;
}

function addSymbol(index: DocumentIndex, cls: QtClass, symbol: QtSymbol): void {
    cls.symbols.set(symbol.name, symbol);
    const existing = index.symbols.get(symbol.name) || [];
    existing.push(symbol);
    index.symbols.set(symbol.name, existing);
}

function extractMacroName(macroText: string): string | undefined {
    const match = macroText.match(/(?:SIGNAL|SLOT)\s*\(\s*(\w+)\s*\(/);
    return match ? match[1] : undefined;
}

function enrichWithMoc(index: DocumentIndex, filePath: string, text: string): void {
    try {
        const tmpDir = path.join(process.cwd(), '.qt-lsp-tmp');
        if (!fs.existsSync(tmpDir)) { fs.mkdirSync(tmpDir, { recursive: true }); }
        const base = path.basename(filePath, path.extname(filePath));
        const mocOut = path.join(tmpDir, `moc_${base}.cpp`);

        let mocPath = 'moc';
        if (qtIncludePath) {
            const candidate = path.join(path.dirname(qtIncludePath), 'bin', 'moc');
            if (fs.existsSync(candidate)) { mocPath = candidate; }
        }

        execSync(`"${mocPath}" "${filePath}" -o "${mocOut}"`, { encoding: 'utf-8', stdio: 'pipe' });
        if (fs.existsSync(mocOut)) {
            const mocText = fs.readFileSync(mocOut, 'utf-8');
            // If moc fails to generate because Q_OBJECT is missing, the output will be mostly empty
            if (!/qt_meta_stringdata/.test(mocText)) {
                // Mark classes as potentially missing Q_OBJECT if they have signals/slots
                for (const cls of index.classes.values()) {
                    let hasSignalsOrSlots = false;
                    for (const sym of cls.symbols.values()) {
                        if (sym.kind === 'signal' || sym.kind === 'slot') {
                            hasSignalsOrSlots = true;
                            break;
                        }
                    }
                    if (hasSignalsOrSlots && !cls.hasQObject) {
                        cls.hasQObject = false; // diagnostic will use this
                    }
                }
            }
            fs.unlinkSync(mocOut);
        }
    } catch {
        // ignore moc failures
    }
}

// ─────────────────────────────────────────────────────────────
// Index management
// ─────────────────────────────────────────────────────────────

function reindexDocument(uri: string, text: string): void {
    const index = indexDocument(uri, text);
    workspaceIndexes.set(uri, index);
    if (diagnosticsEnabled) {
        sendDiagnostics(uri, index, text);
    }
}

function removeDocument(uri: string): void {
    workspaceIndexes.delete(uri);
    connection.sendDiagnostics({ uri, diagnostics: [] });
}

// ─────────────────────────────────────────────────────────────
// Cross-document queries
// ─────────────────────────────────────────────────────────────

function findSymbol(name: string): QtSymbol[] {
    const results: QtSymbol[] = [];
    for (const index of workspaceIndexes.values()) {
        const syms = index.symbols.get(name);
        if (syms) { results.push(...syms); }
    }
    return results;
}

function findClass(name: string): QtClass | undefined {
    for (const index of workspaceIndexes.values()) {
        const cls = index.classes.get(name);
        if (cls) { return cls; }
    }
    return undefined;
}

function findSymbolInClass(className: string, name: string): QtSymbol | undefined {
    const cls = findClass(className);
    return cls?.symbols.get(name);
}

function resolveClassOfVariable(text: string, line: number, variable: string): string | undefined {
    const lines = text.split('\n');
    const regex = new RegExp(`\\b(${variable})\\s*[=:]\\s*new\\s+(\\w+)\\s*[(<]`);
    for (let i = line; i >= 0; i--) {
        const match = lines[i]?.match(regex);
        if (match) { return match[2]; }
    }
    return undefined;
}

function resolveVariableDeclarationType(text: string, line: number, variable: string): string | undefined {
    const lines = text.split('\n');

    // Explicit declarations: ClassName *varName, ClassName& varName, ClassName varName(...), etc.
    const explicitRegex = new RegExp(`\\b([A-Za-z_][A-Za-z0-9_:]*)\\s*[*&]?\\s+\\b${variable}\\b(?:\\s*[=;:(]|\\s*\\{)`);

    // auto varName = new ClassName(...)
    const autoNewRegex = new RegExp(`\\bauto\\s*[*&]?\\s*\\b${variable}\\s*[=:]\\s*new\\s+([A-Za-z_][A-Za-z0-9_:]*)\\s*[(<]`);

    // auto varName = qobject_cast<ClassName *>(...)
    const autoCastRegex = new RegExp(`\\bauto\\s*[*&]?\\s*\\b${variable}\\s*[=:]\\s*qobject_cast<\\s*([A-Za-z_][A-Za-z0-9_:]*)\\s*[*&]?\\s*>`);

    // ClassName *varName = qobject_cast<ClassName *>(...)
    const explicitCastRegex = new RegExp(`\\b([A-Za-z_][A-Za-z0-9_:]*)\\s*[*&]\\s*\\b${variable}\\s*[=:]\\s*qobject_cast<`);

    for (let i = line; i >= 0; i--) {
        const lineText = lines[i] || '';

        const autoNewMatch = lineText.match(autoNewRegex);
        if (autoNewMatch) { return autoNewMatch[1]; }

        const autoCastMatch = lineText.match(autoCastRegex);
        if (autoCastMatch) { return autoCastMatch[1]; }

        const explicitCastMatch = lineText.match(explicitCastRegex);
        if (explicitCastMatch) { return explicitCastMatch[1]; }

        const explicitMatch = lineText.match(explicitRegex);
        if (explicitMatch) { return explicitMatch[1]; }

        // Stop scanning at a top-level closing brace to avoid unrelated scopes.
        if (/^\s*\}\s*$/.test(lineText)) {
            return undefined;
        }
    }
    return undefined;
}

function getEnclosingClassAtLine(text: string, line: number): string | undefined {
    const lines = text.split('\n');
    let braceDepth = 0;
    for (let i = line; i >= 0; i--) {
        const lineText = lines[i] || '';
        for (const ch of lineText) {
            if (ch === '}') { braceDepth++; }
            else if (ch === '{') { braceDepth--; }
        }
        if (braceDepth < 0) {
            const classMatch = lineText.match(/class\s+(?:Q_\w+\s+)?(\w+)(?:\s*:\s*(.+?))?\s*(?:\{|\{|$)/);
            if (classMatch) { return classMatch[1]; }
        }
    }
    return undefined;
}

function getPropertyTypeCompletions(typeName: string, prefix: string): CompletionItem[] {
    const cls = findQtClass(typeName);
    if (!cls) { return []; }

    const methods = prefix ? searchQtMethods(typeName, prefix) : cls.methods;
    return methods.map((m: QtMethod) => ({
        label: m.name,
        kind: m.isSignal ? CompletionItemKind.Event : m.isSlot ? CompletionItemKind.Method : CompletionItemKind.Method,
        detail: `${cls.name}::${m.signature}`,
        documentation: m.description,
        insertText: m.name
    }));
}

function isInsideConnect(text: string, line: number, character: number): boolean {
    const lineText = text.split('\n')[line] || '';
    const before = lineText.substring(0, character);
    return /\bconnect\s*\([^)]*$/.test(before);
}

// ─────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────

function sendDiagnostics(uri: string, index: DocumentIndex, text: string): void {
    const diagnostics: Diagnostic[] = [];

    for (const cls of index.classes.values()) {
        let hasSignalsOrSlots = false;
        for (const sym of cls.symbols.values()) {
            if (sym.kind === 'signal' || sym.kind === 'slot') {
                hasSignalsOrSlots = true;
                break;
            }
        }
        if (hasSignalsOrSlots && !cls.hasQObject) {
            diagnostics.push({
                range: cls.range,
                severity: DiagnosticSeverity.Error,
                code: 'qt-missing-qobject',
                source: 'qt-cpp',
                message: `Class "${cls.name}" contains signals/slots but is missing the Q_OBJECT macro.`,
                data: { className: cls.name }
            });
        }
    }

    for (const conn of index.connects) {
        if (conn.signalName && conn.slotName) {
            diagnostics.push({
                range: conn.range,
                severity: DiagnosticSeverity.Information,
                code: 'qt-old-style-connect',
                source: 'qt-cpp',
                message: 'Consider using type-safe function-pointer connect() syntax instead of SIGNAL()/SLOT() macros.',
                data: conn
            });
        }
    }

    connection.sendDiagnostics({ uri, diagnostics });
}

// ─────────────────────────────────────────────────────────────
// Document sync handlers
// ─────────────────────────────────────────────────────────────

documents.onDidOpen((event: TextDocumentChangeEvent<TextDocument>) => {
    reindexDocument(event.document.uri, event.document.getText());
});

documents.onDidChangeContent((event: TextDocumentChangeEvent<TextDocument>) => {
    reindexDocument(event.document.uri, event.document.getText());
});

documents.onDidClose((event: TextDocumentChangeEvent<TextDocument>) => {
    removeDocument(event.document.uri);
});

// ─────────────────────────────────────────────────────────────
// LSP Handlers
// ─────────────────────────────────────────────────────────────

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    const doc = documents.get(params.textDocument.uri);
    const index = workspaceIndexes.get(params.textDocument.uri);
    if (!doc || !index) { return []; }

    const text = doc.getText();
    const line = params.position.line;
    const character = params.position.character;
    const lineText = text.split('\n')[line] || '';
    const before = lineText.substring(0, character);

    const items: CompletionItem[] = [];

    // Inside connect()
    if (isInsideConnect(text, line, character)) {
        items.push({
            label: 'SIGNAL',
            kind: CompletionItemKind.Snippet,
            insertText: 'SIGNAL(${1:signal}(${2:args}))',
            insertTextFormat: 2,
            detail: 'Qt SIGNAL macro'
        });
        items.push({
            label: 'SLOT',
            kind: CompletionItemKind.Snippet,
            insertText: 'SLOT(${1:slot}(${2:args}))',
            insertTextFormat: 2,
            detail: 'Qt SLOT macro'
        });
        items.push({ label: 'this', kind: CompletionItemKind.Keyword });
        items.push({
            label: 'lambda',
            kind: CompletionItemKind.Snippet,
            insertText: '[=]() {\n\t${1:// handle signal}\n}',
            insertTextFormat: 2
        });

        // Suggest signals of inferred sender
        const connectMatch = before.match(/connect\s*\(\s*([^,]+),\s*$/);
        if (connectMatch) {
            const senderVar = connectMatch[1].trim();
            const senderClass = resolveClassOfVariable(text, line, senderVar) || senderVar;
            const cls = findClass(senderClass);
            if (cls) {
                for (const sym of cls.symbols.values()) {
                    if (sym.kind === 'signal') {
                        items.push({
                            label: sym.name,
                            kind: CompletionItemKind.Event,
                            detail: `${cls.name}::${sym.name}${sym.signature || ''}`,
                            insertText: `SIGNAL(${sym.name}${sym.signature || '()'})`
                        });
                    }
                }
            }
        }
        return items;
    }

    // Property member access: obj->property. or obj.property.
    if (mocIntelliSenseV2Enabled) {
        const propAccessMatch = before.match(/(\b\w+)\s*(?:->|\.)\s*(\w+)\s*(?:->|\.)\s*(\w*)$/);
        if (propAccessMatch) {
            const varName = propAccessMatch[1];
            const propName = propAccessMatch[2];
            const prefix = propAccessMatch[3] || '';

            let className = resolveVariableDeclarationType(text, line, varName)
                || resolveClassOfVariable(text, line, varName)
                || (varName === 'this' ? getEnclosingClassAtLine(text, line) : undefined)
                || varName;

            const cls = findClass(className);
            if (cls) {
                const propSym = cls.symbols.get(propName);
                if (propSym && propSym.kind === 'property' && propSym.propertyType) {
                    const typeCompletions = getPropertyTypeCompletions(propSym.propertyType, prefix);
                    if (typeCompletions.length > 0) {
                        return typeCompletions;
                    }
                }
            }
        }
    }

    // Member access -> or .
    const memberMatch = before.match(/(\b\w+)\s*(?:->|\.)\s*(\w*)$/);
    if (memberMatch) {
        const varName = memberMatch[1];
        const prefix = memberMatch[2] || '';
        const className = resolveVariableDeclarationType(text, line, varName)
            || resolveClassOfVariable(text, line, varName)
            || (varName === 'this' ? getEnclosingClassAtLine(text, line) : undefined)
            || varName;
        const cls = findClass(className);
        if (cls) {
            for (const sym of cls.symbols.values()) {
                if (!prefix || sym.name.toLowerCase().startsWith(prefix.toLowerCase())) {
                    items.push({
                        label: sym.name,
                        kind: sym.kind === 'signal' ? CompletionItemKind.Event : sym.kind === 'slot' ? CompletionItemKind.Method : CompletionItemKind.Property,
                        detail: `${cls.name}::${sym.name}${sym.signature || ''}`,
                        insertText: sym.name
                    });
                }
            }
        }
        return items;
    }

    // Class body / general Qt completions
    const wordMatch = before.match(/\b(\w*)$/);
    const prefix = wordMatch ? wordMatch[1].toLowerCase() : '';

    const macros = ['Q_OBJECT', 'signals:', 'private slots:', 'public slots:', 'protected slots:', 'Q_PROPERTY', 'Q_INVOKABLE', 'Q_SIGNALS', 'Q_SLOTS', 'Q_ENUM', 'QML_ELEMENT', 'QML_NAMED_ELEMENT', 'QML_SINGLETON'];
    for (const macro of macros) {
        if (macro.toLowerCase().startsWith(prefix)) {
            items.push({ label: macro, kind: CompletionItemKind.Keyword, detail: 'Qt macro' });
        }
    }

    // Known classes and symbols
    for (const [name, syms] of index.symbols) {
        if (name.toLowerCase().startsWith(prefix)) {
            const sym = syms[0];
            items.push({
                label: name,
                kind: sym.kind === 'class' ? CompletionItemKind.Class : CompletionItemKind.Method,
                detail: `${sym.className}::${name}`
            });
        }
    }

    return items;
});

connection.onHover((params: TextDocumentPositionParams): Hover | undefined => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) { return undefined; }

    const text = doc.getText();
    const word = getWordAt(text, params.position.line, params.position.character);
    if (!word) { return undefined; }

    const lineText = text.split('\n')[params.position.line] || '';

    // SIGNAL/SLOT macro hover
    const macroMatch = lineText.match(new RegExp(`(SIGNAL|SLOT)\\s*\\(\\s*${word}\\s*\\(`));
    if (macroMatch) {
        const symbols = findSymbol(word);
        const matching = symbols.find(s => s.kind === 'signal' || s.kind === 'slot');
        if (matching) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `**${matching.kind.toUpperCase()}** \`${matching.className}::${matching.name}${matching.signature || '()'}\``
                }
            };
        }
    }

    // Symbol hover
    const symbols = findSymbol(word);
    if (symbols.length > 0) {
        const sym = symbols[0];
        const kind = sym.kind;
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${kind.toUpperCase()}** \`${sym.className}::${sym.name}${sym.signature || ''}\`  \n\n${sym.docs || ''}`
            }
        };
    }

    return undefined;
});

connection.onDefinition((params: TextDocumentPositionParams): Definition | undefined => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) { return undefined; }

    const text = doc.getText();
    const lineText = text.split('\n')[params.position.line] || '';
    const word = getWordAt(text, params.position.line, params.position.character);
    if (!word) { return undefined; }

    // SIGNAL(name(...)) or SLOT(name(...))
    const sigSlotMatch = lineText.match(new RegExp(`(SIGNAL|SLOT)\\s*\\(\\s*${word}\\s*\\(`));
    if (sigSlotMatch) {
        const symbols = findSymbol(word);
        const matching = symbols.find(s => (s.kind === 'signal' || s.kind === 'slot'));
        if (matching) {
            return Location.create(matching.uri, matching.range);
        }
    }

    const symbols = findSymbol(word);
    if (symbols.length > 0) {
        return symbols.map(s => Location.create(s.uri, s.range));
    }

    return undefined;
});

connection.onReferences((params: ReferenceParams): Location[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) { return []; }

    const text = doc.getText();
    const word = getWordAt(text, params.position.line, params.position.character);
    if (!word) { return []; }

    const locations: Location[] = [];

    for (const index of workspaceIndexes.values()) {
        // connect() references
        for (const conn of index.connects) {
            if (conn.signalName === word || conn.slotName === word) {
                locations.push(Location.create(conn.uri, conn.range));
            }
        }
        // emit references
        for (const emit of index.emits) {
            if (emit.signalName === word) {
                locations.push(Location.create(emit.uri, emit.range));
            }
        }
        // declaration references
        const syms = index.symbols.get(word);
        if (syms && params.context.includeDeclaration) {
            for (const sym of syms) {
                locations.push(Location.create(sym.uri, sym.range));
            }
        }
    }

    return locations;
});

connection.onPrepareRename((params: TextDocumentPositionParams): Range | undefined => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) { return undefined; }
    return getWordRange(doc.getText(), params.position.line, params.position.character);
});

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | undefined => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) { return undefined; }

    const text = doc.getText();
    const word = getWordAt(text, params.position.line, params.position.character);
    if (!word) { return undefined; }

    const changes: Record<string, Range[]> = {};

    function addChange(uri: string, range: Range): void {
        if (!changes[uri]) { changes[uri] = []; }
        changes[uri].push(range);
    }

    for (const index of workspaceIndexes.values()) {
        // declarations
        const syms = index.symbols.get(word);
        if (syms) {
            for (const sym of syms) {
                addChange(sym.uri, sym.range);
            }
        }
        // connect calls
        for (const conn of index.connects) {
            if (conn.signalName === word && conn.signalRange) {
                addChange(conn.uri, conn.signalRange);
            }
            if (conn.slotName === word && conn.slotRange) {
                addChange(conn.uri, conn.slotRange);
            }
        }
        // emit calls
        for (const emit of index.emits) {
            if (emit.signalName === word) {
                addChange(emit.uri, emit.range);
            }
        }
    }

    const documentChanges: { textDocument: OptionalVersionedTextDocumentIdentifier; edits: { range: Range; newText: string }[] }[] = [];
    for (const [uri, ranges] of Object.entries(changes)) {
        documentChanges.push({
            textDocument: { uri, version: null },
            edits: ranges.map(r => ({ range: r, newText: params.newName }))
        });
    }

    return { documentChanges };
});

connection.onCodeAction((params: CodeActionParams) => {
    const actions: CodeAction[] = [];
    const uri = params.textDocument.uri;
    const index = workspaceIndexes.get(uri);
    if (!index) { return actions; }

    for (const diagnostic of params.context.diagnostics) {
        if (diagnostic.code === 'qt-missing-qobject' && diagnostic.data?.className) {
            const clsName = diagnostic.data.className as string;
            const cls = index.classes.get(clsName);
            if (cls) {
                const edit: WorkspaceEdit = {
                    documentChanges: [{
                        textDocument: { uri, version: null },
                        edits: [{
                            range: { start: { line: cls.range.start.line + 1, character: 0 }, end: { line: cls.range.start.line + 1, character: 0 } },
                            newText: '    Q_OBJECT\n'
                        }]
                    }]
                };
                const action = CodeAction.create(
                    `Add Q_OBJECT to ${clsName}`,
                    edit,
                    CodeActionKind.QuickFix
                );
                action.diagnostics = [diagnostic];
                actions.push(action);
            }
        }

        if (diagnostic.code === 'qt-old-style-connect') {
            const edit: WorkspaceEdit = {
                changes: {
                    [uri]: [{
                        range: diagnostic.range,
                        newText: '// Replace SIGNAL()/SLOT() with function pointers'
                    }]
                }
            };
            const action = CodeAction.create(
                'Modernize connect() to function pointer syntax',
                edit,
                CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];
            actions.push(action);
        }
    }

    return actions;
});

connection.onDidChangeConfiguration((change: DidChangeConfigurationParams) => {
    const settings = change.settings as Record<string, Record<string, unknown>>;
    diagnosticsEnabled = (settings.qt?.cppLspDiagnosticsEnable as boolean) ?? true;
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();
