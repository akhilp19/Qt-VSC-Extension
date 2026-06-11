import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';

/**
 * Integrates clazy and clang-tidy static analysis for Qt C++ code.
 * Parses diagnostics and feeds them into the VS Code Problems panel.
 */
export class QtClazyIntegration implements vscode.Disposable {
    private outputChannel: vscode.OutputChannel;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private disposables: vscode.Disposable[] = [];

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('qt-clazy');

        // Run on save if enabled
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(async (document) => {
                if (document.languageId !== 'cpp' && document.languageId !== 'c') {
                    return;
                }
                const config = vscode.workspace.getConfiguration('qt');
                if (config.get<boolean>('clazyOnSave')) {
                    await this.runOnFile(document.uri.fsPath);
                }
            })
        );
    }

    /**
     * Detect available clazy or clang-tidy executable.
     */
    async detectLinter(): Promise<{ command: string; name: string } | undefined> {
        // Prefer clazy-standalone for Qt-specific checks
        const clazyCandidates = ['clazy-standalone', 'clazy', 'run-clazy-tidy'];
        for (const name of clazyCandidates) {
            const found = this.findInPath(name);
            if (found) {
                return { command: found, name: 'clazy' };
            }
        }

        // Fallback to clang-tidy
        const tidy = this.findInPath('clang-tidy');
        if (tidy) {
            return { command: tidy, name: 'clang-tidy' };
        }

        return undefined;
    }

    /**
     * Run the linter on a single file and update diagnostics.
     */
    async runOnFile(filePath: string): Promise<void> {
        const linter = await this.detectLinter();
        if (!linter) {
            this.outputChannel.appendLine('[clazy] No linter found (clazy or clang-tidy)');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        if (!config.get<boolean>('clazyEnable')) {
            return;
        }

        const checks = config.get<string>('clazyChecks') || '';
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));

        this.outputChannel.appendLine(`[clazy] Running ${linter.name} on ${path.basename(filePath)}...`);

        try {
            const args: string[] = [];
            if (linter.name === 'clazy' && checks) {
                args.push('--checks', checks);
            } else if (linter.name === 'clang-tidy' && checks) {
                args.push(`--checks=${checks}`);
            }
            args.push(filePath, '--');

            // Try to infer compile flags from compile_commands.json
            const compileDb = this.findCompileCommands(path.dirname(filePath));
            if (compileDb) {
                args.push('-p', compileDb);
            }

            // Check for .clang-tidy config file
            const clangTidyConfig = this.findClangTidyConfig(workspaceFolder?.uri.fsPath || process.cwd());
            if (clangTidyConfig && linter.name === 'clang-tidy') {
                args.push(`--config-file=${clangTidyConfig}`);
            }

            const child = spawn(linter.command, args, {
                cwd: workspaceFolder?.uri.fsPath || process.cwd()
            });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString('utf-8');
            });

            child.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString('utf-8');
            });

            child.on('close', () => {
                const diagnostics = this.parseDiagnostics(stdout + stderr, filePath);
                this.diagnosticCollection.set(vscode.Uri.file(filePath), diagnostics);
                this.outputChannel.appendLine(`[clazy] ${diagnostics.length} diagnostic(s) for ${path.basename(filePath)}`);
            });
        } catch (error) {
            this.outputChannel.appendLine(`[clazy] Error: ${String(error)}`);
        }
    }

    /**
     * Run the linter on all C++ files in the workspace.
     */
    async runOnWorkspace(): Promise<void> {
        const linter = await this.detectLinter();
        if (!linter) {
            void vscode.window.showInformationMessage(
                'clazy or clang-tidy not found. Install clazy for Qt-specific static analysis.',
                'Dismiss'
            );
            return;
        }

        const files = await vscode.workspace.findFiles('**/*.{cpp,h,hpp,c}', '{**/build/**,**/out/**,**/node_modules/**}');
        if (files.length === 0) {
            void vscode.window.showInformationMessage('No C++ files found to analyze.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Running ${linter.name} on ${files.length} file(s)...`,
            cancellable: false
        }, async () => {
            this.diagnosticCollection.clear();
            for (const uri of files) {
                await this.runOnFile(uri.fsPath);
            }
        });

        void vscode.window.showInformationMessage(`${linter.name} analysis complete.`);
    }

    private findInPath(name: string): string | undefined {
        try {
            const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
            const result = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            const first = result.split('\n')[0].trim();
            if (first && fs.existsSync(first)) { return first; }
        } catch {
            // not found
        }
        return undefined;
    }

    private findCompileCommands(startDir: string): string | undefined {
        let dir = startDir;
        for (let i = 0; i < 10; i++) {
            const p = path.join(dir, 'compile_commands.json');
            if (fs.existsSync(p)) { return dir; }
            const parent = path.dirname(dir);
            if (parent === dir) { break; }
            dir = parent;
        }
        return undefined;
    }

    private findClangTidyConfig(startDir: string): string | undefined {
        const candidates = ['.clang-tidy', '_clang-tidy'];
        let dir = startDir;
        for (let i = 0; i < 10; i++) {
            for (const name of candidates) {
                const p = path.join(dir, name);
                if (fs.existsSync(p)) { return p; }
            }
            const parent = path.dirname(dir);
            if (parent === dir) { break; }
            dir = parent;
        }
        return undefined;
    }

    private parseDiagnostics(output: string, _filePath: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) { continue; }

            // Match: /path/file.cpp:10:5: warning: message [check-name]
            const match = trimmed.match(/^(.+?):(\d+):(\d+):\s*(warning|error|note|information):\s*(.+?)(?:\s+\[(\w+-\w+)\])?$/);
            if (!match) { continue; }

            const file = match[1];
            const lineNum = parseInt(match[2], 10) - 1;
            const colNum = parseInt(match[3], 10) - 1;
            const severityStr = match[4];
            const message = match[5];
            const code = match[6];

            let severity = vscode.DiagnosticSeverity.Information;
            if (severityStr === 'error') {
                severity = vscode.DiagnosticSeverity.Error;
            } else if (severityStr === 'warning') {
                severity = vscode.DiagnosticSeverity.Warning;
            }

            const range = new vscode.Range(lineNum, colNum, lineNum, colNum + 1);
            const diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostic.source = code || 'clazy';
            diagnostic.code = code;
            diagnostics.push(diagnostic);
        }

        return diagnostics;
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

/**
 * Code Action Provider for clazy diagnostic quick-fixes.
 */
export class QtClazyCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== 'clazy' && !String(diagnostic.code || '').startsWith('clazy-')) {
                continue;
            }
            const code = String(diagnostic.code || '');

            if (code === 'clazy-old-style-connect') {
                const action = new vscode.CodeAction('Modernize connect() to function pointer', vscode.CodeActionKind.QuickFix);
                action.diagnostics = [diagnostic];
                action.isPreferred = true;
                // Simplified: just document the fix; full implementation would parse and rewrite
                action.command = {
                    command: 'qt.showInfoMessage',
                    title: 'Modernize connect',
                    arguments: ['Replace SIGNAL()/SLOT() macros with function pointers for type-safe connections.']
                };
                actions.push(action);
            }

            if (code === 'clazy-missing-tr') {
                const action = new vscode.CodeAction('Wrap in tr()', vscode.CodeActionKind.QuickFix);
                action.diagnostics = [diagnostic];
                action.isPreferred = true;
                const edit = new vscode.WorkspaceEdit();
                const line = document.lineAt(diagnostic.range.start.line);
                const quoteMatch = line.text.match(/("[^"]*")/);
                if (quoteMatch) {
                    const start = line.text.indexOf(quoteMatch[1]);
                    const end = start + quoteMatch[1].length;
                    edit.replace(document.uri, new vscode.Range(diagnostic.range.start.line, start, diagnostic.range.start.line, end), `tr(${quoteMatch[1]})`);
                    action.edit = edit;
                }
                actions.push(action);
            }

            if (code === 'clazy-inefficient-qlist') {
                const action = new vscode.CodeAction('Use QVector instead of QList', vscode.CodeActionKind.QuickFix);
                action.diagnostics = [diagnostic];
                action.isPreferred = false;
                action.command = {
                    command: 'qt.showInfoMessage',
                    title: 'Use QVector',
                    arguments: ['For large or non-trivially-copyable types, QVector provides better performance than QList.']
                };
                actions.push(action);
            }
        }

        return actions;
    }
}
