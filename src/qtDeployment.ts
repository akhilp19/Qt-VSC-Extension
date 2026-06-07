import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';
import { isWindows, isMacOS, exe, deployToolName, quotePath } from './platformUtils';

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
     * Deploy the current Qt application using platform-specific deploy tool.
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

        // Find deploy tool
        const deployToolPath = await this.findDeployTool();
        if (!deployToolPath) {
            void vscode.window.showErrorMessage(
                `${deployToolName()} not found. Make sure Qt is installed and detected.`
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

        // Platform-specific args
        const additionalArgs = config.get<string>('additionalWinDeployQtArguments') || '';
        const deployTool = deployToolName();
        let args: string[] = [];
        
        if (isMacOS()) {
            // macdeployqt: deploy app bundle
            args = [quotePath(exePath)];
        } else if (isWindows()) {
            args = [quotePath(exePath), '--dir', quotePath(deployDir)];
        } else {
            // linuxdeployqt: deploy to AppDir or target
            args = [quotePath(exePath), '-appimage'];
        }
        
        if (additionalArgs) {
            args.push(additionalArgs);
        }
        
        const command = `${quotePath(deployToolPath)} ${args.join(' ')}`;

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
                            `${deployTool} failed. Check Output → Qt C++ Tools for details.`
                        );
                        reject(new Error(`${deployTool} exited with code ${code}`));
                    }
                });

                child.on('error', (err) => {
                    this.outputChannel.appendLine(`Deployment error: ${err.message}`);
                    void vscode.window.showErrorMessage(`Failed to run ${deployTool}: ${err.message}`);
                    reject(err);
                });
            });
        });
    }

    /**
     * Find platform-specific deploy tool in the active Qt installation.
     */
    async findDeployTool(): Promise<string | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        const toolName = deployToolName();

        if (qtInstallation?.qmakePath) {
            const binDir = path.dirname(qtInstallation.qmakePath);
            const toolPath = path.join(binDir, exe(toolName));
            if (fs.existsSync(toolPath)) {
                return toolPath;
            }
        }

        // Fallback: search PATH
        try {
            const { execSync } = await import('child_process');
            const lookupCmd = process.platform === 'win32' ? `where ${toolName}` : `which ${toolName}`;
            const result = execSync(lookupCmd, { encoding: 'utf-8' }).trim().split('\n')[0];
            if (result && fs.existsSync(result)) {
                return result;
            }
        } catch {
            // not in PATH
        }

        this.outputChannel.appendLine(`${exe(toolName)} not found in Qt installation or PATH.`);
        return undefined;
    }
}
