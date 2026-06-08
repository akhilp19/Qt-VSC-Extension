import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { exe, pathExeLookupCmd } from './platformUtils';

export class QtCodeGenerator implements vscode.Disposable {
    private qtConfigManager: QtConfigManager;
    private outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];
    private debounceTimers = new Map<string, NodeJS.Timeout>();

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
        this.setupFileWatchers();
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
    }

    // ========================================================================
    // File Watchers
    // ========================================================================

    private setupFileWatchers(): void {
        const config = vscode.workspace.getConfiguration('qt');

        // Watch headers for MOC (only if autoMoc enabled)
        const autoMoc = config.get<boolean>('autoMoc') ?? false;
        if (autoMoc) {
            const headerWatcher = vscode.workspace.createFileSystemWatcher('**/*.{h,hpp}');
            headerWatcher.onDidChange((uri) => this.debouncedGenerate('moc', uri));
            headerWatcher.onDidCreate((uri) => this.debouncedGenerate('moc', uri));
            this.disposables.push(headerWatcher);
        }

        // Watch .ui files for UIC (only if autoUic enabled)
        const autoUic = config.get<boolean>('autoUic') ?? false;
        if (autoUic) {
            const uiWatcher = vscode.workspace.createFileSystemWatcher('**/*.ui');
            uiWatcher.onDidChange((uri) => this.debouncedGenerate('uic', uri));
            uiWatcher.onDidCreate((uri) => this.debouncedGenerate('uic', uri));
            this.disposables.push(uiWatcher);
        }

        // Watch .qrc files for RCC (only if autoRcc enabled)
        const autoRcc = config.get<boolean>('autoRcc') ?? false;
        if (autoRcc) {
            const qrcWatcher = vscode.workspace.createFileSystemWatcher('**/*.qrc');
            qrcWatcher.onDidChange((uri) => this.debouncedGenerate('rcc', uri));
            qrcWatcher.onDidCreate((uri) => this.debouncedGenerate('rcc', uri));
            this.disposables.push(qrcWatcher);
        }
    }

    private debouncedGenerate(tool: 'moc' | 'uic' | 'rcc', uri: vscode.Uri): void {
        const key = `${tool}:${uri.fsPath}`;
        const existing = this.debounceTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(() => {
            this.debounceTimers.delete(key);
            void this.autoGenerate(tool, uri);
        }, 500);
        this.debounceTimers.set(key, timer);
    }

    private async autoGenerate(tool: 'moc' | 'uic' | 'rcc', uri: vscode.Uri): Promise<void> {
        if (tool === 'moc') {
            // Only auto-generate MOC if header contains Q_OBJECT
            if (!this.hasQObject(uri.fsPath)) {
                return;
            }
            await this.generateMoc(uri.fsPath, true);
        } else if (tool === 'uic') {
            await this.generateUic(uri.fsPath, true);
        } else if (tool === 'rcc') {
            await this.generateRcc(uri.fsPath, true);
        }
    }

    // ========================================================================
    // Manual Commands
    // ========================================================================

    async runMoc(filePath?: string): Promise<void> {
        const targetPath = filePath ?? vscode.window.activeTextEditor?.document.fileName;
        if (!targetPath) {
            void vscode.window.showWarningMessage('No header file selected');
            return;
        }
        const ext = path.extname(targetPath).toLowerCase();
        if (ext !== '.h' && ext !== '.hpp') {
            void vscode.window.showWarningMessage('Selected file is not a C++ header file');
            return;
        }
        await this.generateMoc(targetPath, false);
    }

    async runUic(filePath?: string): Promise<void> {
        const targetPath = filePath ?? vscode.window.activeTextEditor?.document.fileName;
        if (!targetPath || !targetPath.toLowerCase().endsWith('.ui')) {
            void vscode.window.showWarningMessage('No .ui file selected');
            return;
        }
        await this.generateUic(targetPath, false);
    }

    async runRcc(filePath?: string): Promise<void> {
        const targetPath = filePath ?? vscode.window.activeTextEditor?.document.fileName;
        if (!targetPath || !targetPath.toLowerCase().endsWith('.qrc')) {
            void vscode.window.showWarningMessage('No .qrc file selected');
            return;
        }
        await this.generateRcc(targetPath, false);
    }

    // ========================================================================
    // Core Generation
    // ========================================================================

    private async generateMoc(inputPath: string, auto: boolean): Promise<void> {
        const toolPath = await this.findQtTool('moc');
        if (!toolPath) {
            if (!auto) {
                void vscode.window.showInformationMessage(
                    'moc not found. Make sure Qt is installed and detected.',
                    'OK'
                );
            }
            return;
        }

        const outputPath = this.resolveOutputPath(inputPath, 'moc_');
        const baseName = path.basename(inputPath);

        this.showStatus(`Running moc on ${baseName}...`);
        this.outputChannel.appendLine(`[MOC] ${toolPath} "${inputPath}" -o "${outputPath}"`);

        try {
            this.ensureOutputDir(outputPath);
            execSync(`"${toolPath}" "${inputPath}" -o "${outputPath}"`, { encoding: 'utf-8' });
            this.outputChannel.appendLine(`[MOC] Generated: ${outputPath}`);
            this.showStatus(`moc: ${baseName} → ${path.basename(outputPath)}`);
            if (!auto) {
                void vscode.window.showInformationMessage(
                    `Generated ${path.basename(outputPath)}`,
                    'Open File'
                ).then(choice => {
                    if (choice === 'Open File') {
                        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
                    }
                });
            }
        } catch (error) {
            this.outputChannel.appendLine(`[MOC] Error: ${error}`);
            if (!auto) {
                void vscode.window.showErrorMessage(`moc failed: ${String(error)}`);
            }
        }
    }

    private async generateUic(inputPath: string, auto: boolean): Promise<void> {
        const toolPath = await this.findQtTool('uic');
        if (!toolPath) {
            if (!auto) {
                void vscode.window.showInformationMessage(
                    'uic not found. Make sure Qt is installed and detected.',
                    'OK'
                );
            }
            return;
        }

        const outputPath = this.resolveOutputPath(inputPath, 'ui_', '.h');
        const baseName = path.basename(inputPath);

        this.showStatus(`Running uic on ${baseName}...`);
        this.outputChannel.appendLine(`[UIC] ${toolPath} "${inputPath}" -o "${outputPath}"`);

        try {
            this.ensureOutputDir(outputPath);
            execSync(`"${toolPath}" "${inputPath}" -o "${outputPath}"`, { encoding: 'utf-8' });
            this.outputChannel.appendLine(`[UIC] Generated: ${outputPath}`);
            this.showStatus(`uic: ${baseName} → ${path.basename(outputPath)}`);
            if (!auto) {
                void vscode.window.showInformationMessage(
                    `Generated ${path.basename(outputPath)}`,
                    'Open File'
                ).then(choice => {
                    if (choice === 'Open File') {
                        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
                    }
                });
            }
        } catch (error) {
            this.outputChannel.appendLine(`[UIC] Error: ${error}`);
            if (!auto) {
                void vscode.window.showErrorMessage(`uic failed: ${String(error)}`);
            }
        }
    }

    private async generateRcc(inputPath: string, auto: boolean): Promise<void> {
        const toolPath = await this.findQtTool('rcc');
        if (!toolPath) {
            if (!auto) {
                void vscode.window.showInformationMessage(
                    'rcc not found. Make sure Qt is installed and detected.',
                    'OK'
                );
            }
            return;
        }

        const outputPath = this.resolveOutputPath(inputPath, 'qrc_');
        const baseName = path.basename(inputPath);

        this.showStatus(`Running rcc on ${baseName}...`);
        this.outputChannel.appendLine(`[RCC] ${toolPath} "${inputPath}" -o "${outputPath}"`);

        try {
            this.ensureOutputDir(outputPath);
            execSync(`"${toolPath}" "${inputPath}" -o "${outputPath}"`, { encoding: 'utf-8' });
            this.outputChannel.appendLine(`[RCC] Generated: ${outputPath}`);
            this.showStatus(`rcc: ${baseName} → ${path.basename(outputPath)}`);
            if (!auto) {
                void vscode.window.showInformationMessage(
                    `Generated ${path.basename(outputPath)}`,
                    'Open File'
                ).then(choice => {
                    if (choice === 'Open File') {
                        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
                    }
                });
            }
        } catch (error) {
            this.outputChannel.appendLine(`[RCC] Error: ${error}`);
            if (!auto) {
                void vscode.window.showErrorMessage(`rcc failed: ${String(error)}`);
            }
        }
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Find a Qt tool (moc, uic, rcc) in the Qt installation or PATH.
     */
    private async findQtTool(toolName: string): Promise<string | undefined> {
        // 1. Check Qt installation bin directory
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (qtInstallation?.qmakePath) {
            const binDir = path.dirname(qtInstallation.qmakePath);
            const toolPath = path.join(binDir, exe(toolName));
            if (fs.existsSync(toolPath)) {
                return toolPath;
            }
        }

        // 2. Fallback: search PATH
        try {
            const lookupCmd = pathExeLookupCmd(toolName);
            const result = execSync(lookupCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const firstLine = result.split('\n')[0].trim();
            if (firstLine && fs.existsSync(firstLine)) {
                return firstLine;
            }
        } catch {
            // not found
        }

        this.outputChannel.appendLine(`[CodeGen] ${exe(toolName)} not found in Qt installation or PATH.`);
        return undefined;
    }

    /**
     * Check if a header file contains the Q_OBJECT macro.
     */
    private hasQObject(filePath: string): boolean {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            // Match Q_OBJECT macro (whole word, not inside comments)
            // Simple check: look for Q_OBJECT not preceded by // on same line
            const lines = content.split('\n');
            for (const line of lines) {
                const commentIdx = line.indexOf('//');
                const qobjIdx = line.indexOf('Q_OBJECT');
                if (qobjIdx !== -1 && (commentIdx === -1 || qobjIdx < commentIdx)) {
                    return true;
                }
            }
            return false;
        } catch {
            return false;
        }
    }

    /**
     * Resolve output path for generated code.
     */
    private resolveOutputPath(inputPath: string, prefix: string, forceExt?: string): string {
        const config = vscode.workspace.getConfiguration('qt');
        const generatedDir = config.get<string>('generatedCodeDirectory') || '';

        const inputDir = path.dirname(inputPath);
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const ext = forceExt ?? '.cpp';
        const fileName = `${prefix}${baseName}${ext}`;

        if (generatedDir) {
            // Resolve relative to workspace or as absolute path
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            let resolvedDir = generatedDir;
            if (workspaceFolder) {
                resolvedDir = generatedDir.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
            }
            return path.resolve(resolvedDir, fileName);
        }

        return path.join(inputDir, fileName);
    }

    private ensureOutputDir(outputPath: string): void {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private showStatus(message: string): void {
        void vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`, 3000);
    }
}
