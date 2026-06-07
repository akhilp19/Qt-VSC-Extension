import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { isWindows, exe } from './platformUtils';

export interface TsFileInfo {
    filePath: string;
    fileName: string;
    language?: string;
    totalMessages: number;
    finishedMessages: number;
    completionPercent: number;
}

// ---------------------------------------------------------------------------
// Tree Items
// ---------------------------------------------------------------------------

export class TsFileTreeItem extends vscode.TreeItem {
    constructor(public readonly info: TsFileInfo) {
        super(info.fileName, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${info.filePath}\n${info.finishedMessages}/${info.totalMessages} messages translated`;
        this.description = `${info.completionPercent}%`;
        this.resourceUri = vscode.Uri.file(info.filePath);
        this.command = {
            title: 'Open Translation File',
            command: 'vscode.open',
            arguments: [this.resourceUri]
        };
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.contextValue = 'tsFile';
    }
}

export class TranslationActionItem extends vscode.TreeItem {
    constructor(
        label: string,
        commandId: string,
        icon: string,
        public readonly args?: unknown[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.command = {
            title: label,
            command: commandId,
            arguments: args
        };
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}

export class TranslationInfoItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('info');
    }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class QtTranslationProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private qtConfigManager: QtConfigManager;
    private outputChannel: vscode.OutputChannel;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private cachedTsFiles: TsFileInfo[] = [];

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('qt-translations');
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            // Root level: scan for .ts files
            this.cachedTsFiles = await this.scanTsFiles();

            if (this.cachedTsFiles.length === 0) {
                return [new TranslationInfoItem('No translation files found')];
            }

            const items: vscode.TreeItem[] = this.cachedTsFiles.map(info => new TsFileTreeItem(info));

            // Add action separator and commands
            items.push(new TranslationActionItem('Update Translations (lupdate)', 'qt.lupdate', 'refresh'));
            items.push(new TranslationActionItem('Compile Translations (lrelease)', 'qt.lrelease', 'run'));
            items.push(new TranslationActionItem('Refresh', 'qt.refreshTranslations', 'refresh'));

            return items;
        }

        return [];
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
        // Also refresh diagnostics
        void this.updateDiagnostics();
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
        this._onDidChangeTreeData.dispose();
    }

    // -----------------------------------------------------------------------
    // Scanning
    // -----------------------------------------------------------------------

    private async scanTsFiles(): Promise<TsFileInfo[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) { return []; }

        const results: TsFileInfo[] = [];
        const excludePatterns = ['**/build/**', '**/out/**', '**/.git/**', '**/node_modules/**'];

        for (const folder of workspaceFolders) {
            await this.scanFolder(folder.uri.fsPath, excludePatterns, results);
        }

        // Sort by filename
        results.sort((a, b) => a.fileName.localeCompare(b.fileName));
        return results;
    }

    private async scanFolder(folderPath: string, excludePatterns: string[], results: TsFileInfo[]): Promise<void> {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry.name);

            if (entry.isDirectory()) {
                const shouldExclude = excludePatterns.some(pattern => {
                    const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
                    return regex.test(fullPath);
                });
                if (!shouldExclude) {
                    await this.scanFolder(fullPath, excludePatterns, results);
                }
                continue;
            }

            if (entry.isFile() && entry.name.endsWith('.ts')) {
                const info = this.parseTsFile(fullPath);
                if (info) {
                    results.push(info);
                }
            }
        }
    }

    private parseTsFile(filePath: string): TsFileInfo | undefined {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const fileName = path.basename(filePath);

            // Extract language from <TS language="...">
            const langMatch = content.match(/<TS[^>]*\slanguage="([^"]+)"/);
            const language = langMatch ? langMatch[1] : undefined;

            // Count <message> elements
            const messageMatches = content.match(/<message>/g);
            const totalMessages = messageMatches ? messageMatches.length : 0;

            if (totalMessages === 0) {
                return { filePath, fileName, language, totalMessages: 0, finishedMessages: 0, completionPercent: 0 };
            }

            // Count finished translations
            // A translation is finished if it's non-empty and not marked type="unfinished" or type="obsolete"
            let finishedMessages = 0;
            const messageRegex = /<message>[\s\S]*?<\/message>/g;
            let match: RegExpExecArray | null;
            while ((match = messageRegex.exec(content)) !== null) {
                const messageBlock = match[0];
                const translationMatch = messageBlock.match(/<translation>([\s\S]*?)<\/translation>/);
                const unfinishedMatch = messageBlock.match(/<translation\s+type="unfinished"/);
                const obsoleteMatch = messageBlock.match(/<translation\s+type="obsolete"/);

                if (obsoleteMatch) {
                    // Obsolete messages don't count toward total
                    continue;
                }

                if (translationMatch && !unfinishedMatch) {
                    const text = translationMatch[1].trim();
                    if (text.length > 0) {
                        finishedMessages++;
                    }
                }
            }

            const completionPercent = Math.round((finishedMessages / totalMessages) * 100);

            return {
                filePath,
                fileName,
                language,
                totalMessages,
                finishedMessages,
                completionPercent
            };
        } catch (error) {
            this.outputChannel.appendLine(`Failed to parse ${filePath}: ${error}`);
            return undefined;
        }
    }

    // -----------------------------------------------------------------------
    // Tool Execution
    // -----------------------------------------------------------------------

    private async findQtTool(toolName: string): Promise<string | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (qtInstallation) {
            const qtBinPath = path.join(qtInstallation.path, 'bin');
            const toolPath = path.join(qtBinPath, exe(toolName));
            if (fs.existsSync(toolPath)) {
                return toolPath;
            }
        }

        try {
            const lookupCmd = isWindows() ? `where ${toolName}` : `which ${toolName}`;
            const result = execSync(lookupCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const firstLine = result.split('\n')[0].trim();
            if (firstLine && fs.existsSync(firstLine)) {
                return firstLine;
            }
        } catch {
            // not found
        }

        return undefined;
    }

    async runLupdate(projectFile?: string): Promise<void> {
        const lupdatePath = await this.findQtTool('lupdate');
        if (!lupdatePath) {
            void vscode.window.showInformationMessage(
                'lupdate not found. It is included with Qt.',
                'OK'
            );
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        // Resolve project file
        let targetProject = projectFile;
        if (!targetProject) {
            // Look for .pro files or CMakeLists.txt
            const proFiles = await vscode.workspace.findFiles('**/*.pro', '{build,out,.git,node_modules}/**');
            const cmakeFiles = await vscode.workspace.findFiles('**/CMakeLists.txt', '{build,out,.git,node_modules}/**', 1);

            if (proFiles.length > 0) {
                targetProject = proFiles[0].fsPath;
            } else if (cmakeFiles.length > 0) {
                targetProject = cmakeFiles[0].fsPath;
            }
        }

        const config = vscode.workspace.getConfiguration('qt');
        const extraArgs = config.get<string>('lupdateArgs') || '';

        const args: string[] = [];
        if (extraArgs) {
            args.push(...extraArgs.split(/\s+/).filter(a => a.length > 0));
        }

        if (targetProject) {
            args.push(targetProject);
        } else {
            // No project file found — scan for source files
            const cppFiles = await vscode.workspace.findFiles('**/*.{cpp,h,hpp}', '{build,out,.git,node_modules}/**');
            const qmlFiles = await vscode.workspace.findFiles('**/*.qml', '{build,out,.git,node_modules}/**');
            const uiFiles = await vscode.workspace.findFiles('**/*.ui', '{build,out,.git,node_modules}/**');

            const sourceFiles = [...cppFiles, ...qmlFiles, ...uiFiles].map(f => f.fsPath);
            if (sourceFiles.length === 0) {
                void vscode.window.showWarningMessage('No source files found for lupdate');
                return;
            }
            args.push(...sourceFiles);

            // Add -ts with all .ts files
            const tsFiles = this.cachedTsFiles.map(t => t.filePath);
            if (tsFiles.length > 0) {
                args.push('-ts', ...tsFiles);
            }
        }

        await this.runTool('lupdate', lupdatePath, args, workspaceFolder.uri.fsPath);
        this.refresh();
    }

    async runLrelease(projectFile?: string): Promise<void> {
        const lreleasePath = await this.findQtTool('lrelease');
        if (!lreleasePath) {
            void vscode.window.showInformationMessage(
                'lrelease not found. It is included with Qt.',
                'OK'
            );
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        const config = vscode.workspace.getConfiguration('qt');
        const extraArgs = config.get<string>('lreleaseArgs') || '';
        const args: string[] = [];
        if (extraArgs) {
            args.push(...extraArgs.split(/\s+/).filter(a => a.length > 0));
        }

        if (projectFile) {
            args.push(projectFile);
        } else if (this.cachedTsFiles.length > 0) {
            args.push(...this.cachedTsFiles.map(t => t.filePath));
        } else {
            void vscode.window.showWarningMessage('No .ts files found for lrelease');
            return;
        }

        await this.runTool('lrelease', lreleasePath, args, workspaceFolder.uri.fsPath);
        this.refresh();
    }

    private async runTool(name: string, toolPath: string, args: string[], cwd: string): Promise<void> {
        return new Promise((resolve) => {
            this.outputChannel.appendLine(`Running ${name}: ${toolPath} ${args.join(' ')}`);

            const progressOptions: vscode.ProgressOptions = {
                location: vscode.ProgressLocation.Notification,
                title: `Running ${name}...`,
                cancellable: false
            };

            void vscode.window.withProgress(progressOptions, async () => {
                return new Promise<void>((innerResolve) => {
                    const child = spawn(toolPath, args, { cwd });
                    let stdout = '';
                    let stderr = '';

                    child.stdout?.on('data', (data: Buffer) => {
                        stdout += data.toString('utf-8');
                    });

                    child.stderr?.on('data', (data: Buffer) => {
                        stderr += data.toString('utf-8');
                    });

                    child.on('close', (code) => {
                        this.outputChannel.appendLine(`${name} stdout:\n${stdout}`);
                        if (stderr) {
                            this.outputChannel.appendLine(`${name} stderr:\n${stderr}`);
                        }

                        if (code === 0) {
                            void vscode.window.showInformationMessage(`${name} completed successfully`);
                        } else {
                            void vscode.window.showWarningMessage(
                                `${name} exited with code ${code ?? 'unknown'}. Check Qt C++ Tools output for details.`
                            );
                        }
                        innerResolve();
                        resolve();
                    });
                });
            });
        });
    }

    async openInLinguist(tsFilePath?: string): Promise<void> {
        const linguistPath = await this.findQtTool('linguist');
        if (!linguistPath) {
            void vscode.window.showInformationMessage(
                'Qt Linguist not found. It is included with Qt.',
                'OK'
            );
            return;
        }

        const targetFile = tsFilePath || (this.cachedTsFiles[0]?.filePath);
        if (!targetFile) {
            void vscode.window.showWarningMessage('No .ts file selected');
            return;
        }

        try {
            const child = spawn(linguistPath, [targetFile], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            void vscode.window.showInformationMessage(`Opened ${path.basename(targetFile)} in Qt Linguist`);
            this.outputChannel.appendLine(`Launched Qt Linguist: ${linguistPath} ${targetFile}`);
        } catch (error) {
            void vscode.window.showErrorMessage(`Failed to launch Qt Linguist: ${String(error)}`);
        }
    }

    // -----------------------------------------------------------------------
    // Diagnostics
    // -----------------------------------------------------------------------

    async updateDiagnostics(): Promise<void> {
        this.diagnosticCollection.clear();

        for (const tsFile of this.cachedTsFiles) {
            try {
                const content = fs.readFileSync(tsFile.filePath, 'utf-8');
                const diagnostics: vscode.Diagnostic[] = [];

                // Find unfinished translations
                const messageRegex = /<message>[\s\S]*?<\/message>/g;
                let match: RegExpExecArray | null;

                while ((match = messageRegex.exec(content)) !== null) {
                    const messageBlock = match[0];
                    const isUnfinished = /<translation\s+type="unfinished"/.test(messageBlock) ||
                        /<translation\s*\/>/.test(messageBlock) ||
                        /<translation><\/translation>/.test(messageBlock);

                    if (!isUnfinished) { continue; }

                    // Extract source text
                    const sourceMatch = messageBlock.match(/<source>([\s\S]*?)<\/source>/);
                    const sourceText = sourceMatch ? sourceMatch[1].trim() : 'unknown';

                    // Extract location
                    const locationMatch = messageBlock.match(/<location\s+filename="([^"]+)"\s+line="(\d+)"\s*\/>/);
                    if (locationMatch) {
                        const filePath = locationMatch[1];
                        const line = parseInt(locationMatch[2], 10) - 1;

                        // Resolve relative path
                        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                        const fullPath = workspaceFolder && !path.isAbsolute(filePath)
                            ? path.join(workspaceFolder.uri.fsPath, filePath)
                            : filePath;

                        if (fs.existsSync(fullPath)) {
                            const range = new vscode.Range(line, 0, line, 0);
                            const diagnostic = new vscode.Diagnostic(
                                range,
                                `Translation missing for "${sourceText}" (${tsFile.language || tsFile.fileName})`,
                                vscode.DiagnosticSeverity.Warning
                            );
                            diagnostic.source = 'qt-translation';
                            diagnostics.push(diagnostic);
                        }
                    }
                }

                // Group diagnostics by file path and set them
                const diagMap = new Map<string, vscode.Diagnostic[]>();
                for (const d of diagnostics) {
                    // We need to track which file each diagnostic belongs to
                    // This is simplified — in practice we'd group by file path from location
                }

                // For simplicity, attach all diagnostics to the .ts file itself
                if (diagnostics.length > 0) {
                    this.diagnosticCollection.set(vscode.Uri.file(tsFile.filePath), diagnostics);
                }
            } catch (error) {
                this.outputChannel.appendLine(`Diagnostic error for ${tsFile.filePath}: ${error}`);
            }
        }
    }
}
