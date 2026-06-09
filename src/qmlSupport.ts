import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { exe, isWindows } from './platformUtils';

export class QmlSupport {
    private qtConfigManager: QtConfigManager;
    private outputChannel: vscode.OutputChannel;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private activePreviewProcess?: import('child_process').ChildProcess;
    private activePreviewFile?: string;

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('qml');
    }

    /**
     * Find a QML tool (qmlformat, qmllint, qmlscene) in the Qt installation or PATH.
     */
    private async findQmlTool(toolName: string): Promise<string | undefined> {
        // 1. Look in the active Qt installation's bin directory
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (qtInstallation) {
            const qtBinPath = path.join(qtInstallation.path, 'bin');
            const toolPath = path.join(qtBinPath, exe(toolName));
            if (fs.existsSync(toolPath)) {
                return toolPath;
            }
        }

        // 2. Look in PATH
        try {
            const lookupCmd = isWindows() ? `where ${toolName}` : `which ${toolName}`;
            const result = execSync(lookupCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const firstLine = result.split('\n')[0].trim();
            if (firstLine && fs.existsSync(firstLine)) {
                return firstLine;
            }
        } catch {
            // Tool not in PATH
        }

        return undefined;
    }

    /**
     * Format the current QML file using qmlformat.
     */
    async formatQml(filePath?: string): Promise<void> {
        const targetPath = filePath || vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!targetPath || !targetPath.endsWith('.qml')) {
            void vscode.window.showWarningMessage('No QML file selected');
            return;
        }

        const qmlformatPath = await this.findQmlTool('qmlformat');
        if (!qmlformatPath) {
            void vscode.window.showInformationMessage(
                'qmlformat not found. It is included with Qt 5.15+ and Qt 6.',
                'OK'
            );
            return;
        }

        try {
            this.outputChannel.appendLine(`Formatting QML: ${targetPath}`);
            execSync(`"${qmlformatPath}" -i "${targetPath}"`, { encoding: 'utf-8' });
            this.outputChannel.appendLine('QML formatting complete');

            // Reload the document if it's open
            const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === targetPath);
            if (doc) {
                const edit = new vscode.WorkspaceEdit();
                const content = fs.readFileSync(targetPath, 'utf-8');
                const fullRange = new vscode.Range(
                    doc.positionAt(0),
                    doc.positionAt(doc.getText().length)
                );
                edit.replace(doc.uri, fullRange, content);
                await vscode.workspace.applyEdit(edit);
            }

            void vscode.window.showInformationMessage('QML file formatted');
        } catch (error) {
            this.outputChannel.appendLine(`qmlformat failed: ${error}`);
            void vscode.window.showErrorMessage(`qmlformat failed: ${String(error)}`);
        }
    }

    /**
     * Lint the current QML file using qmllint and populate diagnostics.
     */
    async lintQml(filePath?: string): Promise<void> {
        const targetPath = filePath || vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!targetPath || !targetPath.endsWith('.qml')) {
            return;
        }

        const qmllintPath = await this.findQmlTool('qmllint');
        if (!qmllintPath) {
            this.outputChannel.appendLine('qmllint not found, skipping QML lint');
            return;
        }

        try {
            this.outputChannel.appendLine(`Linting QML: ${targetPath}`);
            const output = execSync(`"${qmllintPath}" "${targetPath}"`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // qmllint may exit 0 even with warnings; we parse the output
            const diagnostics = this.parseQmllintOutput(targetPath, output);
            const uri = vscode.Uri.file(targetPath);
            this.diagnosticCollection.set(uri, diagnostics);

            const errorCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
            const warnCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;
            if (errorCount > 0 || warnCount > 0) {
                this.outputChannel.appendLine(`qmllint: ${errorCount} error(s), ${warnCount} warning(s)`);
            } else {
                this.outputChannel.appendLine('qmllint: no issues found');
                this.diagnosticCollection.set(uri, []);
            }
        } catch (error) {
            // qmllint exits non-zero on errors; stderr may contain output
            const err = error as { stdout?: string; stderr?: string };
            const output = err.stdout || err.stderr || String(error);
            const diagnostics = this.parseQmllintOutput(targetPath, output);
            const uri = vscode.Uri.file(targetPath);
            this.diagnosticCollection.set(uri, diagnostics);

            const errorCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
            const warnCount = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;
            this.outputChannel.appendLine(`qmllint: ${errorCount} error(s), ${warnCount} warning(s)`);
        }
    }

    /**
     * Parse qmllint output into VS Code diagnostics.
     * Handles formats like:
     *   /path/file.qml:10:5: Warning: message
     *   /path/file.qml:10: Error: message
     *   /path/file.qml:10:5: Fatal: message
     */
    private parseQmllintOutput(filePath: string, output: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) { continue; }

            // Match: file:line:column: severity: message
            let match = trimmed.match(/^(.+?):(\d+):(\d+):\s*(\w+):\s*(.+)$/);
            if (!match) {
                // Match: file:line: severity: message (no column)
                match = trimmed.match(/^(.+?):(\d+):\s*(\w+):\s*(.+)$/);
                if (match) {
                    // Shift groups: file=1, line=2, severity=3, message=4
                    match = [match[0], match[1], match[2], '1', match[3], match[4]];
                }
            }

            if (!match) { continue; }

            const lineNum = parseInt(match[2], 10) - 1; // 0-based
            const colNum = parseInt(match[3], 10) - 1;  // 0-based
            const severityStr = match[4].toLowerCase();
            const message = match[5];

            let severity = vscode.DiagnosticSeverity.Information;
            if (severityStr === 'error' || severityStr === 'fatal') {
                severity = vscode.DiagnosticSeverity.Error;
            } else if (severityStr === 'warning') {
                severity = vscode.DiagnosticSeverity.Warning;
            }

            const range = new vscode.Range(lineNum, colNum, lineNum, colNum + 1);
            const diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostic.source = 'qmllint';
            diagnostics.push(diagnostic);
        }

        return diagnostics;
    }

    /**
     * Preview the current QML file using qmlscene.
     * If hot reload is enabled, tracks the process for restart on save.
     */
    async previewQml(filePath?: string): Promise<void> {
        const targetPath = filePath || vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!targetPath || !targetPath.endsWith('.qml')) {
            void vscode.window.showWarningMessage('No QML file selected');
            return;
        }

        const qmlscenePath = await this.findQmlTool('qmlscene');
        if (!qmlscenePath) {
            void vscode.window.showInformationMessage(
                'qmlscene not found. It is included with Qt.',
                'OK'
            );
            return;
        }

        // Stop any existing preview for this file
        this.stopPreview();

        // Build arguments
        const config = vscode.workspace.getConfiguration('qt');
        const extraArgs = config.get<string>('qmlPreviewArgs') || '';
        const extraImportPath = config.get<string>('qmlPreviewImportPath') || '';

        const args: string[] = [];
        if (extraImportPath) {
            args.push('-I', extraImportPath);
        }
        if (extraArgs) {
            args.push(...extraArgs.split(/\s+/).filter(a => a.length > 0));
        }
        args.push(targetPath);

        // Set up environment with QML2_IMPORT_PATH if Qt installation is known
        const env = { ...process.env };
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (qtInstallation) {
            const qmlDir = path.join(qtInstallation.path, 'qml');
            if (fs.existsSync(qmlDir)) {
                const existingImportPath = env.QML2_IMPORT_PATH || '';
                env.QML2_IMPORT_PATH = existingImportPath
                    ? `${existingImportPath}${path.delimiter}${qmlDir}`
                    : qmlDir;
            }
        }

        this.outputChannel.appendLine(`Launching QML preview: ${qmlscenePath} ${args.join(' ')}`);

        try {
            const child = spawn(qmlscenePath, args, {
                detached: false,
                stdio: 'ignore',
                env
            });
            this.activePreviewProcess = child;
            this.activePreviewFile = targetPath;
            void vscode.window.showInformationMessage(
                `QML preview launched: ${path.basename(targetPath)}`,
                'Stop Preview'
            ).then(choice => {
                if (choice === 'Stop Preview') {
                    this.stopPreview();
                }
            });
        } catch (error) {
            this.outputChannel.appendLine(`qmlscene failed: ${error}`);
            void vscode.window.showErrorMessage(`Failed to launch QML preview: ${String(error)}`);
        }
    }

    /**
     * Stop the active QML preview process.
     */
    stopPreview(): void {
        if (this.activePreviewProcess) {
            try {
                this.activePreviewProcess.kill();
            } catch {
                // process may already be dead
            }
            this.activePreviewProcess = undefined;
            this.activePreviewFile = undefined;
            this.outputChannel.appendLine('QML preview stopped');
        }
    }

    /**
     * Restart the preview for the given file if hot reload is enabled.
     */
    async hotReloadIfEnabled(filePath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        const hotReload = config.get<boolean>('qmlPreviewHotReload') ?? false;
        if (!hotReload) {
            return;
        }

        // Only reload if this is the active preview file or if no specific file is tracked
        if (this.activePreviewFile && this.activePreviewFile !== filePath) {
            return;
        }

        if (!filePath.endsWith('.qml')) {
            return;
        }

        this.outputChannel.appendLine(`[QML Hot Reload] Restarting preview for ${path.basename(filePath)}`);
        this.stopPreview();
        await this.previewQml(filePath);
    }

    /**
     * Get the currently previewed file path, if any.
     */
    getActivePreviewFile(): string | undefined {
        return this.activePreviewFile;
    }

    /**
     * Dispose of the diagnostic collection and stop any running preview.
     */
    dispose(): void {
        this.stopPreview();
        this.diagnosticCollection.dispose();
    }
}
