import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { QtConfigManager } from './qtConfigManager';

export class QtDesignerIntegration {
    private qtConfigManager: QtConfigManager;
    private outputChannel: vscode.OutputChannel;

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
    }

    /**
     * Open a .ui file in Qt Designer.
     * If no filePath provided, uses the active editor's file.
     */
    async openInDesigner(filePath?: string): Promise<void> {
        const targetFile = filePath ?? vscode.window.activeTextEditor?.document.fileName;

        if (!targetFile) {
            void vscode.window.showErrorMessage('No .ui file selected or open.');
            return;
        }

        if (!targetFile.toLowerCase().endsWith('.ui')) {
            const proceed = await vscode.window.showWarningMessage(
                `The file "${path.basename(targetFile)}" is not a .ui file. Open in Qt Designer anyway?`,
                'Yes', 'No'
            );
            if (proceed !== 'Yes') {
                return;
            }
        }

        const designerPath = await this.findDesignerExe();
        if (!designerPath) {
            void vscode.window.showErrorMessage(
                'Qt Designer (designer.exe) not found. Make sure Qt is installed and detected.'
            );
            return;
        }

        if (!fs.existsSync(targetFile)) {
            void vscode.window.showErrorMessage(`File not found: ${targetFile}`);
            return;
        }

        this.outputChannel.appendLine(`Launching Qt Designer: "${designerPath}" "${targetFile}"`);

        // Spawn designer.exe detached so it doesn't block VS Code
        const child = spawn(`"${designerPath}"`, [`"${targetFile}"`], {
            shell: true,
            detached: true,
            stdio: 'ignore'
        });

        child.on('error', (err) => {
            this.outputChannel.appendLine(`Failed to launch Qt Designer: ${err.message}`);
            void vscode.window.showErrorMessage(`Failed to launch Qt Designer: ${err.message}`);
        });

        child.unref();

        void vscode.window.showInformationMessage(`Opened ${path.basename(targetFile)} in Qt Designer.`);
    }

    /**
     * Find designer.exe in the active Qt installation.
     */
    async findDesignerExe(): Promise<string | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();

        if (qtInstallation?.qmakePath) {
            const binDir = path.dirname(qtInstallation.qmakePath);
            const designerPath = path.join(binDir, 'designer.exe');
            if (fs.existsSync(designerPath)) {
                return designerPath;
            }
        }

        // Fallback: search PATH for designer.exe
        try {
            const { execSync } = await import('child_process');
            const designerInPath = execSync('where designer', { encoding: 'utf-8' }).trim().split('\n')[0];
            if (designerInPath && fs.existsSync(designerInPath)) {
                return designerInPath;
            }
        } catch {
            // designer not in PATH
        }

        this.outputChannel.appendLine('Qt Designer (designer.exe) not found in Qt installation or PATH.');
        return undefined;
    }
}
