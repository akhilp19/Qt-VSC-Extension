import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';
import { isWindows, exe } from './platformUtils';

export type PythonQtBinding = 'PySide6' | 'PyQt6' | 'PySide2' | 'PyQt5' | 'unknown';

export class QtPythonSupport {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Detect Python files in workspace that use Qt bindings.
     */
    detectPythonQtProjects(workspacePath: string): string[] {
        const results: string[] = [];
        const bindingPattern = /^(?:from\s+(PySide6|PyQt6|PySide2|PyQt5)\s+import|import\s+(PySide6|PyQt6|PySide2|PyQt5))/;

        try {
            this.scanPythonFiles(workspacePath, results, bindingPattern);
        } catch (error) {
            this.outputChannel.appendLine(`Python Qt scan error: ${error}`);
        }

        return results;
    }

    /**
     * Detect which Qt binding a Python file uses.
     */
    detectQtBinding(pythonFile: string): PythonQtBinding {
        try {
            const content = fs.readFileSync(pythonFile, 'utf-8');
            const lines = content.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                if (/^from\s+PySide6\s+import|^import\s+PySide6/.test(trimmed)) {
                    return 'PySide6';
                }
                if (/^from\s+PyQt6\s+import|^import\s+PyQt6/.test(trimmed)) {
                    return 'PyQt6';
                }
                if (/^from\s+PySide2\s+import|^import\s+PySide2/.test(trimmed)) {
                    return 'PySide2';
                }
                if (/^from\s+PyQt5\s+import|^import\s+PyQt5/.test(trimmed)) {
                    return 'PyQt5';
                }
            }
        } catch {
            // ignore
        }

        // Fallback: check requirements.txt in same directory
        const dir = path.dirname(pythonFile);
        const reqPath = path.join(dir, 'requirements.txt');
        if (fs.existsSync(reqPath)) {
            const reqContent = fs.readFileSync(reqPath, 'utf-8');
            if (reqContent.includes('PySide6')) { return 'PySide6'; }
            if (reqContent.includes('PyQt6')) { return 'PyQt6'; }
            if (reqContent.includes('PySide2')) { return 'PySide2'; }
            if (reqContent.includes('PyQt5')) { return 'PyQt5'; }
        }

        return 'unknown';
    }

    /**
     * Compile a .ui file to Python using pyside6-uic / pyuic5.
     */
    async compileUiToPython(uiFilePath?: string): Promise<void> {
        const targetPath = uiFilePath || vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!targetPath || !targetPath.endsWith('.ui')) {
            void vscode.window.showWarningMessage('No .ui file selected');
            return;
        }

        const binding = this.getPreferredBinding();
        const toolName = this.getUicToolName(binding);
        const toolPath = this.findPythonQtTool(toolName);

        if (!toolPath) {
            void vscode.window.showInformationMessage(
                `${toolName} not found. Install ${binding} or activate your virtual environment.`,
                'OK'
            );
            return;
        }

        const outputPath = targetPath.replace(/\.ui$/i, '_ui.py');

        try {
            this.outputChannel.appendLine(`Compiling UI: ${toolPath} ${targetPath} -o ${outputPath}`);
            execSync(`"${toolPath}" "${targetPath}" -o "${outputPath}"`, { encoding: 'utf-8' });

            void vscode.window.showInformationMessage(
                `Compiled to ${path.basename(outputPath)}`,
                'Open File'
            ).then(choice => {
                if (choice === 'Open File') {
                    void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
                }
            });

            this.outputChannel.appendLine(`UI compiled: ${outputPath}`);
        } catch (error) {
            this.outputChannel.appendLine(`uic failed: ${error}`);
            void vscode.window.showErrorMessage(`Failed to compile .ui: ${String(error)}`);
        }
    }

    /**
     * Compile a .qrc file to Python using pyside6-rcc / pyrcc5.
     */
    async compileRccToPython(qrcFilePath?: string): Promise<void> {
        const targetPath = qrcFilePath || vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!targetPath || !targetPath.endsWith('.qrc')) {
            void vscode.window.showWarningMessage('No .qrc file selected');
            return;
        }

        const binding = this.getPreferredBinding();
        const toolName = this.getRccToolName(binding);
        const toolPath = this.findPythonQtTool(toolName);

        if (!toolPath) {
            void vscode.window.showInformationMessage(
                `${toolName} not found. Install ${binding} or activate your virtual environment.`,
                'OK'
            );
            return;
        }

        const outputPath = targetPath.replace(/\.qrc$/i, '_rc.py');

        try {
            this.outputChannel.appendLine(`Compiling RCC: ${toolPath} ${targetPath} -o ${outputPath}`);
            execSync(`"${toolPath}" "${targetPath}" -o "${outputPath}"`, { encoding: 'utf-8' });

            void vscode.window.showInformationMessage(
                `Compiled to ${path.basename(outputPath)}`,
                'Open File'
            ).then(choice => {
                if (choice === 'Open File') {
                    void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
                }
            });

            this.outputChannel.appendLine(`RCC compiled: ${outputPath}`);
        } catch (error) {
            this.outputChannel.appendLine(`rcc failed: ${error}`);
            void vscode.window.showErrorMessage(`Failed to compile .qrc: ${String(error)}`);
        }
    }

    /**
     * Open Qt Designer for Python projects.
     */
    async openDesignerForPython(): Promise<void> {
        const binding = this.getPreferredBinding();
        const designerNames = this.getDesignerToolNames(binding);

        let designerPath: string | undefined;
        for (const name of designerNames) {
            designerPath = this.findPythonQtTool(name);
            if (designerPath) { break; }
        }

        // Fallback to regular designer
        if (!designerPath) {
            designerPath = this.findPythonQtTool('designer');
        }

        if (!designerPath) {
            void vscode.window.showInformationMessage(
                'Qt Designer not found. Install PySide6/PyQt6 or Qt to get designer.',
                'OK'
            );
            return;
        }

        try {
            const child = spawn(designerPath, [], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            void vscode.window.showInformationMessage('Qt Designer launched');
            this.outputChannel.appendLine(`Launched Qt Designer: ${designerPath}`);
        } catch (error) {
            void vscode.window.showErrorMessage(`Failed to launch Qt Designer: ${String(error)}`);
        }
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private scanPythonFiles(folderPath: string, results: string[], pattern: RegExp): void {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry.name);

            if (entry.isDirectory()) {
                if (['build', 'out', '.git', 'node_modules', '__pycache__', '.venv', 'venv'].includes(entry.name)) {
                    continue;
                }
                this.scanPythonFiles(fullPath, results, pattern);
                continue;
            }

            if (entry.isFile() && entry.name.endsWith('.py')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const lines = content.split('\n');
                    for (const line of lines.slice(0, 30)) { // Check first 30 lines
                        if (pattern.test(line.trim())) {
                            results.push(fullPath);
                            break;
                        }
                    }
                } catch {
                    // ignore
                }
            }
        }
    }

    private getPreferredBinding(): PythonQtBinding {
        const config = vscode.workspace.getConfiguration('qt');
        const override = config.get<string>('pythonQtBinding') || 'auto';
        if (override !== 'auto') {
            return override as PythonQtBinding;
        }

        // Try to detect from workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const pythonFiles = this.detectPythonQtProjects(workspaceFolder.uri.fsPath);
            if (pythonFiles.length > 0) {
                return this.detectQtBinding(pythonFiles[0]);
            }
        }

        return 'PySide6';
    }

    private getUicToolName(binding: PythonQtBinding): string {
        switch (binding) {
            case 'PySide6': return 'pyside6-uic';
            case 'PyQt6': return 'pyuic6';
            case 'PySide2': return 'pyside2-uic';
            case 'PyQt5': return 'pyuic5';
            default: return 'pyside6-uic';
        }
    }

    private getRccToolName(binding: PythonQtBinding): string {
        switch (binding) {
            case 'PySide6': return 'pyside6-rcc';
            case 'PyQt6': return 'pyrcc6';
            case 'PySide2': return 'pyside2-rcc';
            case 'PyQt5': return 'pyrcc5';
            default: return 'pyside6-rcc';
        }
    }

    private getDesignerToolNames(binding: PythonQtBinding): string[] {
        switch (binding) {
            case 'PySide6': return ['pyside6-designer', 'designer'];
            case 'PyQt6': return ['pyqt6-designer', 'designer'];
            case 'PySide2': return ['pyside2-designer', 'designer'];
            case 'PyQt5': return ['pyqt5-designer', 'designer'];
            default: return ['pyside6-designer', 'designer'];
        }
    }

    private findPythonQtTool(toolName: string): string | undefined {
        // 1. Try in Qt installation bin directory
        try {
            const qtDir = process.env.QTDIR;
            if (qtDir) {
                const toolPath = path.join(qtDir, 'bin', exe(toolName));
                if (fs.existsSync(toolPath)) {
                    return toolPath;
                }
            }
        } catch {
            // ignore
        }

        // 2. Try python -m to find the module's script directory
        try {
            const pythonCmd = isWindows() ? 'python' : 'python3';
            const scriptPath = execSync(`${pythonCmd} -c "import sys, os; print(os.path.join(sys.prefix, 'Scripts' if os.name == 'nt' else 'bin'))"`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            const toolPath = path.join(scriptPath, exe(toolName));
            if (fs.existsSync(toolPath)) {
                return toolPath;
            }
        } catch {
            // ignore
        }

        // 3. Try which/where
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
}
