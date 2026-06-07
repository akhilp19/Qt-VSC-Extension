import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { exe, quotePath } from './platformUtils';

export class QrcSupport {
    private qtConfigManager: QtConfigManager;
    private outputChannel: vscode.OutputChannel;

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
    }

    /**
     * Validate that all files referenced in a .qrc exist on disk.
     */
    async validateQrc(filePath?: string): Promise<void> {
        const targetFile = filePath ?? vscode.window.activeTextEditor?.document.fileName;

        if (!targetFile) {
            void vscode.window.showErrorMessage('No .qrc file selected or open.');
            return;
        }

        if (!targetFile.toLowerCase().endsWith('.qrc')) {
            void vscode.window.showErrorMessage('The selected file is not a .qrc file.');
            return;
        }

        if (!fs.existsSync(targetFile)) {
            void vscode.window.showErrorMessage(`File not found: ${targetFile}`);
            return;
        }

        const qrcDir = path.dirname(targetFile);
        const content = fs.readFileSync(targetFile, 'utf-8');
        const fileEntries = this.parseQrcFiles(content);

        if (fileEntries.length === 0) {
            void vscode.window.showWarningMessage('No <file> entries found in this .qrc file.');
            return;
        }

        const missing: string[] = [];
        const found: string[] = [];

        for (const entry of fileEntries) {
            const resolved = path.resolve(qrcDir, entry.replace(/\\/g, path.sep));
            if (fs.existsSync(resolved)) {
                found.push(entry);
            } else {
                missing.push(entry);
            }
        }

        this.outputChannel.appendLine(`[QRC Validate] ${path.basename(targetFile)}: ${found.length} found, ${missing.length} missing`);
        for (const m of missing) {
            this.outputChannel.appendLine(`  MISSING: ${m}`);
        }

        if (missing.length > 0) {
            void vscode.window.showWarningMessage(
                `${missing.length} resource(s) missing in ${path.basename(targetFile)}. Check Output → Qt C++ Tools for details.`
            );
        } else {
            void vscode.window.showInformationMessage(
                `All ${found.length} resource(s) in ${path.basename(targetFile)} are valid.`
            );
        }
    }

    /**
     * Run rcc on the given .qrc file to produce a compiled .cpp file.
     */
    async runRcc(filePath?: string): Promise<void> {
        const targetFile = filePath ?? vscode.window.activeTextEditor?.document.fileName;

        if (!targetFile) {
            void vscode.window.showErrorMessage('No .qrc file selected or open.');
            return;
        }

        if (!targetFile.toLowerCase().endsWith('.qrc')) {
            void vscode.window.showErrorMessage('The selected file is not a .qrc file.');
            return;
        }

        const rccPath = await this.findRccExe();
        if (!rccPath) {
            void vscode.window.showErrorMessage('rcc.exe not found. Make sure Qt is installed and detected.');
            return;
        }

        const qrcDir = path.dirname(targetFile);
        const baseName = path.basename(targetFile, '.qrc');
        const outputFile = path.join(qrcDir, `${baseName}_rc.cpp`);

        this.outputChannel.appendLine(`Running rcc: "${rccPath}" "${targetFile}" -o "${outputFile}"`);

        const child = spawn(`"${rccPath}"`, [`"${targetFile}"`, '-o', `"${outputFile}"`], {
            shell: true,
            cwd: qrcDir
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => { stdout += data.toString(); });
        child.stderr?.on('data', (data) => { stderr += data.toString(); });

        child.on('close', (code) => {
            if (code === 0) {
                this.outputChannel.appendLine(`rcc succeeded: ${outputFile}`);
                void vscode.window.showInformationMessage(`Compiled ${path.basename(targetFile)} → ${path.basename(outputFile)}`);
            } else {
                this.outputChannel.appendLine(`rcc failed with code ${code ?? 'unknown'}: ${stderr || stdout}`);
                void vscode.window.showErrorMessage(`rcc failed. Check Output → Qt C++ Tools for details.`);
            }
        });

        child.on('error', (err) => {
            this.outputChannel.appendLine(`rcc spawn error: ${err.message}`);
            void vscode.window.showErrorMessage(`Failed to run rcc: ${err.message}`);
        });
    }

    /**
     * Parse <file> entries from a .qrc XML string.
     */
    private parseQrcFiles(content: string): string[] {
        const files: string[] = [];
        // Match <file>path/to/file.ext</file>
        const regex = /<file>([^<]+)<\/file>/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            files.push(match[1].trim());
        }
        return files;
    }

    /**
     * Find rcc.exe in the active Qt installation.
     */
    async findRccExe(): Promise<string | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();

        if (qtInstallation?.qmakePath) {
            const binDir = path.dirname(qtInstallation.qmakePath);
            const rccPath = path.join(binDir, exe('rcc'));
            if (fs.existsSync(rccPath)) {
                return rccPath;
            }
        }

        // Fallback: search PATH for rcc
        try {
            const { execSync } = await import('child_process');
            const lookupCmd = process.platform === 'win32' ? 'where rcc' : 'which rcc';
            const rccInPath = execSync(lookupCmd, { encoding: 'utf-8' }).trim().split('\n')[0];
            if (rccInPath && fs.existsSync(rccInPath)) {
                return rccInPath;
            }
        } catch {
            // rcc not in PATH
        }

        this.outputChannel.appendLine(`${exe('rcc')} not found in Qt installation or PATH.`);
        return undefined;
    }
}
