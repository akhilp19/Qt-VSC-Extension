import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';

export class QtDeployment {
    private qtConfigManager: QtConfigManager;
    private qtProjectDetector: QtProjectDetector;
    private outputChannel: vscode.OutputChannel;

    constructor(
        qtConfigManager: QtConfigManager,
        qtProjectDetector: QtProjectDetector,
        outputChannel: vscode.OutputChannel
    ) {
        this.qtConfigManager = qtConfigManager;
        this.qtProjectDetector = qtProjectDetector;
        this.outputChannel = outputChannel;
    }

    /**
     * Deploy the current Qt application using windeployqt.
     */
    async deployApplication(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // Find Qt projects
        const projects = await this.qtProjectDetector.detectProjects(workspaceFolder.uri.fsPath);
        if (projects.length === 0) {
            void vscode.window.showErrorMessage('No Qt project found in workspace.');
            return;
        }

        // Select project if multiple
        let projectFile: string;
        if (projects.length === 1) {
            projectFile = projects[0];
        } else {
            const selected = await vscode.window.showQuickPick(
                projects.map(p => ({ label: path.basename(p), description: p, value: p })),
                { placeHolder: 'Select project to deploy' }
            );
            if (!selected) {
                return;
            }
            projectFile = selected.value;
        }

        // Find built executable
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const exePath = await this.qtProjectDetector.findExecutable(projectFile, buildDir);

        if (!exePath || !fs.existsSync(exePath)) {
            void vscode.window.showErrorMessage(
                'Executable not found. Please build the project first before deploying.'
            );
            return;
        }

        // Find windeployqt
        const windeployqtPath = await this.findWinDeployQt();
        if (!windeployqtPath) {
            void vscode.window.showErrorMessage(
                'windeployqt.exe not found. Make sure Qt is installed and detected.'
            );
            return;
        }

        // Get deploy directory
        const config = vscode.workspace.getConfiguration('qt');
        let deployDir = config.get<string>('deployDirectory') || '${workspaceFolder}/deploy';
        const workspaceFolderPath = workspaceFolder.uri.fsPath;
        deployDir = deployDir.replace('${workspaceFolder}', workspaceFolderPath);

        // Ensure deploy directory exists
        if (!fs.existsSync(deployDir)) {
            fs.mkdirSync(deployDir, { recursive: true });
        }

        // Additional args
        const additionalArgs = config.get<string>('additionalWinDeployQtArguments') || '';

        // Run windeployqt
        const args = [`"${exePath}"`, '--dir', `"${deployDir}"`, additionalArgs].filter(a => a.length > 0);
        const command = `"${windeployqtPath}" ${args.join(' ')}`;

        this.outputChannel.appendLine(`Deploying application...`);
        this.outputChannel.appendLine(`  Executable: ${exePath}`);
        this.outputChannel.appendLine(`  Deploy dir: ${deployDir}`);
        this.outputChannel.appendLine(`  Command: ${command}`);

        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: `Deploying ${path.basename(exePath)}...`,
            cancellable: false
        };

        await vscode.window.withProgress(progressOptions, async () => {
            return new Promise<void>((resolve, reject) => {
                const child = spawn(command, {
                    shell: true,
                    cwd: workspaceFolderPath
                });

                let stdout = '';
                let stderr = '';

                child.stdout?.on('data', (data) => {
                    const text = data.toString();
                    stdout += text;
                    this.outputChannel.append(text);
                });

                child.stderr?.on('data', (data) => {
                    const text = data.toString();
                    stderr += text;
                    this.outputChannel.append(text);
                });

                child.on('close', (code) => {
                    if (code === 0) {
                        this.outputChannel.appendLine('Deployment completed successfully.');
                        void vscode.window.showInformationMessage(
                            `Deployed to: ${deployDir}`,
                            'Open Folder'
                        ).then(choice => {
                            if (choice === 'Open Folder') {
                                void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(deployDir));
                            }
                        });
                        resolve();
                    } else {
                        this.outputChannel.appendLine(`Deployment failed with code ${code ?? 'unknown'}.`);
                        void vscode.window.showErrorMessage(
                            `windeployqt failed. Check Output → Qt C++ Tools for details.`
                        );
                        reject(new Error(`windeployqt exited with code ${code}`));
                    }
                });

                child.on('error', (err) => {
                    this.outputChannel.appendLine(`Deployment error: ${err.message}`);
                    void vscode.window.showErrorMessage(`Failed to run windeployqt: ${err.message}`);
                    reject(err);
                });
            });
        });
    }

    /**
     * Find windeployqt.exe in the active Qt installation.
     */
    async findWinDeployQt(): Promise<string | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();

        if (qtInstallation?.qmakePath) {
            const binDir = path.dirname(qtInstallation.qmakePath);
            const windeployqtPath = path.join(binDir, 'windeployqt.exe');
            if (fs.existsSync(windeployqtPath)) {
                return windeployqtPath;
            }
        }

        // Fallback: search PATH
        try {
            const { execSync } = await import('child_process');
            const result = execSync('where windeployqt', { encoding: 'utf-8' }).trim().split('\n')[0];
            if (result && fs.existsSync(result)) {
                return result;
            }
        } catch {
            // not in PATH
        }

        this.outputChannel.appendLine('windeployqt.exe not found in Qt installation or PATH.');
        return undefined;
    }
}
