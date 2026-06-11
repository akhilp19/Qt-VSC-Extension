import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

export interface CppQmlSymbol {
    filePath: string;
    line: number;
    character: number;
    name: string;
    kind: 'property' | 'method' | 'type';
    qmlTypeName: string;
    cppClassName: string;
    signature?: string;
}

export interface QmlTypeInfo {
    filePath: string;
    line: number;
    character: number;
    qmlTypeName: string;
    cppClassName: string;
    isSingleton: boolean;
    isAttached: boolean;
    attachedType?: string;
    hasQObject: boolean;
}

export interface QmlUsage {
    filePath: string;
    line: number;
    character: number;
    symbolName: string;
    contextType: string;
    usageType: 'property-binding' | 'method-call' | 'id-reference';
}

export interface IdDeclaration {
    id: string;
    qmlType: string;
    line: number;
}

export interface QmlDirEntry {
    typeName: string;
    version: string;
    filePath: string;
    isSingleton: boolean;
    moduleUri?: string;
}

/**
 * Indexes C++ headers for QML-relevant declarations (Q_PROPERTY, Q_INVOKABLE, QML_ELEMENT)
 * and QML files for property/method usages to enable cross-language navigation.
 */
export class QmlCppBridgeIndexer {
    private outputChannel: vscode.OutputChannel;

    // Map: QML type name → list of C++ symbols exposed to QML
    private symbolIndex = new Map<string, CppQmlSymbol[]>();

    // Map: QML type name → C++ QML type declaration info
    private qmlTypeIndex = new Map<string, QmlTypeInfo>();

    // Map: QML file path → list of id declarations in that file
    private idIndex = new Map<string, IdDeclaration[]>();

    // Map: symbol name → list of QML usages
    private usageIndex = new Map<string, QmlUsage[]>();

    // Map: id → qmlType (global across workspace)
    private idToTypeMap = new Map<string, string>();

    // Map: QML type name → qmldir entry (for QML modules)
    private qmldirIndex = new Map<string, QmlDirEntry>();

    // Set: directories containing qmldir files (for QML_IMPORT_PATH)
    private qmlModulePaths = new Set<string>();

    private isIndexing = false;
    private debounceTimer?: NodeJS.Timeout;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Scan the entire workspace for C++ QML declarations and QML usages.
     */
    async indexWorkspace(): Promise<void> {
        if (this.isIndexing) {
            return;
        }
        this.isIndexing = true;
        this.outputChannel.appendLine('[QML-C++ Bridge] Starting workspace index...');

        const startTime = Date.now();

        // Clear existing index
        this.symbolIndex.clear();
        this.qmlTypeIndex.clear();
        this.qmldirIndex.clear();
        this.qmlModulePaths.clear();
        this.idIndex.clear();
        this.usageIndex.clear();
        this.idToTypeMap.clear();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.isIndexing = false;
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        const enabled = config.get<boolean>('qmlCppBridgeEnabled') ?? true;
        if (!enabled) {
            this.outputChannel.appendLine('[QML-C++ Bridge] Disabled by setting.');
            this.isIndexing = false;
            return;
        }

        const excludePatterns: string[] = config.get<string[]>('qmlCppIndexExclude') || ['**/build/**', '**/out/**', '**/.git/**', '**/node_modules/**'];

        try {
            for (const folder of workspaceFolders) {
                await this.scanFolder(folder.uri.fsPath, excludePatterns);
            }

            const elapsed = Date.now() - startTime;
            const symbolCount = Array.from(this.symbolIndex.values()).reduce((sum, arr) => sum + arr.length, 0);
            const usageCount = Array.from(this.usageIndex.values()).reduce((sum, arr) => sum + arr.length, 0);
            this.outputChannel.appendLine(
                `[QML-C++ Bridge] Index complete in ${elapsed}ms. ` +
                `${this.symbolIndex.size} QML types, ${symbolCount} symbols, ${usageCount} QML usages.`
            );
        } catch (error) {
            this.outputChannel.appendLine(`[QML-C++ Bridge] Index error: ${error}`);
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Invalidate the cache and trigger a re-index (debounced).
     */
    invalidateCache(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            void this.indexWorkspace();
        }, 2000);
    }

    /**
     * Find a C++ symbol by QML type name and symbol name.
     */
    findSymbol(qmlTypeName: string, symbolName: string): CppQmlSymbol | undefined {
        const symbols = this.symbolIndex.get(qmlTypeName);
        if (!symbols) { return undefined; }
        return symbols.find(s => s.name === symbolName);
    }

    /**
     * Find all symbols exposed for a given QML type.
     */
    findSymbolsForType(qmlTypeName: string): CppQmlSymbol[] {
        return this.symbolIndex.get(qmlTypeName) || [];
    }

    /**
     * Look up the QML type for an id alias.
     */
    resolveIdType(id: string): string | undefined {
        return this.idToTypeMap.get(id);
    }

    /**
     * Find QML usages of a symbol name.
     */
    findQmlUsages(symbolName: string): QmlUsage[] {
        return this.usageIndex.get(symbolName) || [];
    }

    /**
     * Get all id declarations for a QML file.
     */
    getIdDeclarations(filePath: string): IdDeclaration[] {
        return this.idIndex.get(filePath) || [];
    }

    /**
     * Find QML type info by registered QML type name.
     */
    findQmlType(qmlTypeName: string): QmlTypeInfo | undefined {
        return this.qmlTypeIndex.get(qmlTypeName);
    }

    /**
     * Get all registered QML types.
     */
    getAllQmlTypes(): QmlTypeInfo[] {
        return Array.from(this.qmlTypeIndex.values());
    }

    /**
     * Check if a QML type is a singleton.
     */
    isQmlSingleton(qmlTypeName: string): boolean {
        const info = this.qmlTypeIndex.get(qmlTypeName);
        return info?.isSingleton ?? false;
    }

    /**
     * Resolve a QML type from a qmldir module entry.
     */
    resolveQmlImport(typeName: string): QmlDirEntry | undefined {
        return this.qmldirIndex.get(typeName);
    }

    /**
     * Get all QML import paths detected from qmldir files.
     */
    getQmlImportPaths(): string[] {
        return Array.from(this.qmlModulePaths);
    }

    /**
     * Get all qmldir-registered types.
     */
    getQmldirTypes(): QmlDirEntry[] {
        return Array.from(this.qmldirIndex.values());
    }

    // -----------------------------------------------------------------------
    // Private scanning helpers
    // -----------------------------------------------------------------------

    private async scanFolder(folderPath: string, excludePatterns: string[]): Promise<void> {
        const entries = await readdirAsync(folderPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry.name);

            if (entry.isDirectory()) {
                // Check exclusions
                const shouldExclude = excludePatterns.some(pattern => {
                    const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
                    return regex.test(fullPath);
                });
                if (!shouldExclude) {
                    await this.scanFolder(fullPath, excludePatterns);
                }
                continue;
            }

            if (!entry.isFile()) { continue; }

            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.h' || ext === '.hpp' || ext === '.cpp') {
                await this.scanCppFile(fullPath);
            } else if (ext === '.qml') {
                await this.scanQmlFile(fullPath);
            } else if (entry.name === 'qmldir') {
                await this.scanQmldirFile(fullPath);
            }
        }
    }

    private async scanCppFile(filePath: string): Promise<void> {
        try {
            const content = await readFileAsync(filePath, 'utf-8');
            const lines = content.split('\n');

            let inClass = false;
            let braceDepth = 0;
            let currentClassName = '';
            let currentQmlTypeName = '';
            let hasQObject = false;
            let classStartLine = -1;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Detect class declaration
                const classMatch = trimmed.match(/class\s+(\w+)\s*:\s*(?:public|protected|private)\s+(\w+(?:\s*<[^>]+>)?)/);
                if (classMatch && !inClass) {
                    inClass = true;
                    braceDepth = 0;
                    currentClassName = classMatch[1];
                    currentQmlTypeName = currentClassName;
                    hasQObject = false;
                    classStartLine = i;
                    continue;
                }

                if (!inClass) { continue; }

                // Track brace depth to know when class ends
                for (const ch of line) {
                    if (ch === '{') { braceDepth++; }
                    else if (ch === '}') { braceDepth--; }
                }

                // Q_OBJECT macro
                if (/\bQ_OBJECT\b/.test(trimmed)) {
                    hasQObject = true;
                }

                // QML_ELEMENT / QML_NAMED_ELEMENT / QML_SINGLETON
                const namedElementMatch = trimmed.match(/QML_NAMED_ELEMENT\s*\(\s*"([^"]+)"\s*\)/);
                if (namedElementMatch) {
                    currentQmlTypeName = namedElementMatch[1];
                } else if (/\bQML_ELEMENT\b/.test(trimmed)) {
                    currentQmlTypeName = currentClassName;
                }

                const isSingleton = /\bQML_SINGLETON\b/.test(trimmed);
                if (isSingleton) {
                    // Mark as singleton when we register the type
                }

                // QML_ATTACHED
                const attachedMatch = trimmed.match(/QML_ATTACHED\s*\(\s*(\w+)\s*\)/);
                if (attachedMatch) {
                    // Will be registered when class ends
                }

                // Q_PROPERTY
                const propMatch = trimmed.match(/Q_PROPERTY\s*\(\s*([^)]+)\)/);
                if (propMatch && hasQObject) {
                    const propBody = propMatch[1];
                    // Parse: type name READ ... or type name WRITE ...
                    const propTokens = propBody.trim().split(/\s+/);
                    if (propTokens.length >= 2) {
                        const propName = propTokens[1];
                        const existing = this.symbolIndex.get(currentQmlTypeName) || [];
                        existing.push({
                            filePath,
                            line: i,
                            character: line.indexOf(propName),
                            name: propName,
                            kind: 'property',
                            qmlTypeName: currentQmlTypeName,
                            cppClassName: currentClassName,
                            signature: propBody.trim()
                        });
                        this.symbolIndex.set(currentQmlTypeName, existing);
                    }
                }

                // Q_INVOKABLE
                const invokableMatch = trimmed.match(/Q_INVOKABLE\s+(?:[^;{]+\s+)?(\w+)\s*\(/);
                if (invokableMatch && hasQObject) {
                    const methodName = invokableMatch[1];
                    const existing = this.symbolIndex.get(currentQmlTypeName) || [];
                    existing.push({
                        filePath,
                        line: i,
                        character: line.indexOf(methodName),
                        name: methodName,
                        kind: 'method',
                        qmlTypeName: currentQmlTypeName,
                        cppClassName: currentClassName,
                        signature: trimmed
                    });
                    this.symbolIndex.set(currentQmlTypeName, existing);
                }

                // Class ended — register the QML type if it has QML_ELEMENT or QML_NAMED_ELEMENT
                if (braceDepth <= 0 && i > classStartLine) {
                    if (hasQObject && currentQmlTypeName && currentQmlTypeName !== currentClassName) {
                        // Also register if QML_ELEMENT was used (currentQmlTypeName == currentClassName)
                    }
                    if (hasQObject && currentQmlTypeName) {
                        const classBody = content.substring(classStartLine, i + 1).replace(/\n/g, ' ');
                        const isSingleton = /\bQML_SINGLETON\b/.test(classBody);
                        const attachedMatch = classBody.match(/QML_ATTACHED\s*\(\s*(\w+)\s*\)/);
                        this.qmlTypeIndex.set(currentQmlTypeName, {
                            filePath,
                            line: classStartLine,
                            character: lines[classStartLine].indexOf('class'),
                            qmlTypeName: currentQmlTypeName,
                            cppClassName: currentClassName,
                            isSingleton,
                            isAttached: !!attachedMatch,
                            attachedType: attachedMatch ? attachedMatch[1] : undefined,
                            hasQObject
                        });
                    }
                    inClass = false;
                    currentClassName = '';
                    currentQmlTypeName = '';
                    hasQObject = false;
                }
            }
        } catch (error) {
            // Ignore unreadable files
        }
    }

    private async scanQmlFile(filePath: string): Promise<void> {
        try {
            const content = await readFileAsync(filePath, 'utf-8');
            const lines = content.split('\n');

            // Determine root type from first non-empty, non-import, non-pragma line
            let rootType = '';
            let braceDepth = 0;
            let currentType = '';
            const typeStack: string[] = [];
            const fileIds: IdDeclaration[] = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('import') || trimmed.startsWith('pragma')) {
                    continue;
                }

                // Track braces for nested type context
                const openBraces = (line.match(/\{/g) || []).length;
                const closeBraces = (line.match(/\}/g) || []).length;

                // Detect type instantiation: TypeName { or TypeName idName {
                // Only at braceDepth 0 (top level or inside another type)
                const typeMatch = trimmed.match(/^([A-Z][A-Za-z0-9_.]*)\s*(?:\{|\w+\s*\{)/);
                if (typeMatch && braceDepth >= 0) {
                    const typeName = typeMatch[1];
                    if (!rootType) {
                        rootType = typeName;
                    }
                    typeStack.push(typeName);
                    currentType = typeName;
                }

                braceDepth += openBraces - closeBraces;

                // Pop type stack when we exit a block
                while (braceDepth < typeStack.length - 1 && typeStack.length > 0) {
                    typeStack.pop();
                    currentType = typeStack[typeStack.length - 1] || rootType;
                }

                // id: declaration
                const idMatch = trimmed.match(/\bid\s*:\s*(\w+)/);
                if (idMatch) {
                    const id = idMatch[1];
                    fileIds.push({ id, qmlType: currentType, line: i });
                    this.idToTypeMap.set(id, currentType);
                }

                // Property binding: propertyName: value (not a block, not a signal handler)
                // Exclude lines starting with 'on' (signal handlers) and 'property' (property declarations)
                if (!trimmed.startsWith('on') && !trimmed.startsWith('property') && !trimmed.startsWith('function') && !trimmed.startsWith('signal')) {
                    const bindingMatch = trimmed.match(/^([a-z][A-Za-z0-9_]*)\s*:\s*(?!\{)/);
                    if (bindingMatch && currentType) {
                        const propName = bindingMatch[1];
                        if (propName !== 'id') {
                            this.addUsage(propName, filePath, i, line.indexOf(propName), currentType, 'property-binding');
                        }
                    }
                }

                // Method call: objectName.methodName( or just methodName(
                const methodCallMatch = trimmed.match(/\b(\w+)\.(\w+)\s*\(/);
                if (methodCallMatch) {
                    const methodName = methodCallMatch[2];
                    this.addUsage(methodName, filePath, i, line.indexOf(methodName), currentType, 'method-call');
                }

                // Direct method call at root: methodName(
                const directMethodMatch = trimmed.match(/^([a-z][A-Za-z0-9_]*)\s*\(/);
                if (directMethodMatch && braceDepth === 1 && currentType) {
                    const methodName = directMethodMatch[1];
                    if (!['if', 'for', 'while', 'switch', 'console'].includes(methodName)) {
                        this.addUsage(methodName, filePath, i, line.indexOf(methodName), currentType, 'method-call');
                    }
                }
            }

            this.idIndex.set(filePath, fileIds);
        } catch (error) {
            // Ignore unreadable files
        }
    }

    private async scanQmldirFile(filePath: string): Promise<void> {
        try {
            const content = await readFileAsync(filePath, 'utf-8');
            const lines = content.split('\n');
            const dirPath = path.dirname(filePath);
            let moduleUri = '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) { continue; }

                // Parse module URI
                const moduleMatch = trimmed.match(/^module\s+(\S+)/);
                if (moduleMatch) {
                    moduleUri = moduleMatch[1];
                    this.qmlModulePaths.add(dirPath);
                    continue;
                }

                // Parse type entry: TypeName 1.0 TypeName.qml
                const typeMatch = trimmed.match(/^(singleton\s+)?(\w+)\s+(\d+\.\d+)\s+(\S+\.qml)$/);
                if (typeMatch) {
                    const isSingleton = !!typeMatch[1];
                    const typeName = typeMatch[2];
                    const version = typeMatch[3];
                    const qmlFile = typeMatch[4];
                    const fullQmlPath = path.join(dirPath, qmlFile);

                    this.qmldirIndex.set(typeName, {
                        typeName,
                        version,
                        filePath: fullQmlPath,
                        isSingleton,
                        moduleUri
                    });
                }
            }
        } catch (error) {
            // Ignore unreadable qmldir files
        }
    }

    private addUsage(symbolName: string, filePath: string, line: number, character: number, contextType: string, usageType: QmlUsage['usageType']): void {
        const existing = this.usageIndex.get(symbolName) || [];
        existing.push({ filePath, line, character, symbolName, contextType, usageType });
        this.usageIndex.set(symbolName, existing);
    }
}
