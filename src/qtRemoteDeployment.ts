import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';

export class QtRemoteDeployment {
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

    dispose(): void {
        // No persistent processes
    }

    // ─────────────────────────────────────────────────────────────
    // Remote Tool Detection
    // ─────────────────────────────────────────────────────────────

    detectRemoteTools(): { ssh?: string; scp?: string; rsync?: string; gdb?: string; lldb?: string } {
        const find = (name: string): string | undefined => {
            try {
                const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
                const result = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
                const first = result.split('\n')[0].trim();
                return first && fs.existsSync(first) ? first : undefined;
            } catch {
                return undefined;
            }
        };
        return {
            ssh: find('ssh'),
            scp: find('scp'),
            rsync: find('rsync'),
            gdb: find('gdb'),
            lldb: find('lldb')
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Configure Remote Target
    // ─────────────────────────────────────────────────────────────

    async configureRemoteTarget(): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');

        const host = await vscode.window.showInputBox({
            prompt: 'Remote device hostname or IP address',
            value: config.get<string>('remoteHost') || ''
        });
        if (host === undefined) { return; }

        const user = await vscode.window.showInputBox({
            prompt: 'Remote user name',
            value: config.get<string>('remoteUser') || ''
        });
        if (user === undefined) { return; }

        const remotePath = await vscode.window.showInputBox({
            prompt: 'Remote deployment directory',
            value: config.get<string>('remotePath') || '/home/' + user + '/qt-app'
        });
        if (remotePath === undefined) { return; }

        const mode = await vscode.window.showQuickPick(
            [{ label: 'scp', description: 'Secure copy (simple)' }, { label: 'rsync', description: 'Rsync (faster, supports deltas)' }],
            { placeHolder: 'Select remote deploy mode', canPickMany: false }
        );
        if (!mode) { return; }

        await config.update('remoteHost', host, vscode.ConfigurationTarget.Workspace);
        await config.update('remoteUser', user, vscode.ConfigurationTarget.Workspace);
        await config.update('remotePath', remotePath, vscode.ConfigurationTarget.Workspace);
        await config.update('remoteDeployMode', mode.label, vscode.ConfigurationTarget.Workspace);

        void vscode.window.showInformationMessage(`Remote target configured: ${user}@${host}:${remotePath}`);
        this.outputChannel.appendLine(`[Remote] Target: ${user}@${host}:${remotePath} (${mode.label})`);
    }

    // ─────────────────────────────────────────────────────────────
    // Remote Deploy
    // ─────────────────────────────────────────────────────────────

    async deployRemotely(projectFile?: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        const host = config.get<string>('remoteHost');
        const user = config.get<string>('remoteUser');
        const remotePath = config.get<string>('remotePath');
        const mode = config.get<string>('remoteDeployMode') || 'scp';

        if (!host || !user || !remotePath) {
            const choice = await vscode.window.showWarningMessage(
                'Remote target not configured.',
                'Configure Remote Target'
            );
            if (choice === 'Configure Remote Target') {
                await this.configureRemoteTarget();
            }
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        let targetProject = projectFile;
        if (!targetProject) {
            const projects = await this.qtProjectDetector.detectProjects(workspaceFolder.uri.fsPath);
            if (projects.length === 0) {
                void vscode.window.showErrorMessage('No Qt project found');
                return;
            }
            if (projects.length === 1) {
                targetProject = projects[0];
            } else {
                const selected = await vscode.window.showQuickPick(
                    projects.map(p => ({ label: path.basename(p), description: p, value: p })),
                    { placeHolder: 'Select project to deploy remotely' }
                );
                if (!selected) { return; }
                targetProject = selected.value;
            }
        }

        const buildType = this.qtConfigManager.getProjectBuildType(targetProject);
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const exePath = await this.qtProjectDetector.findExecutable(targetProject, buildDir);

        if (!exePath || !fs.existsSync(exePath)) {
            void vscode.window.showErrorMessage('No built executable found. Build the project first.');
            return;
        }

        const tools = this.detectRemoteTools();
        if (mode === 'rsync' && !tools.rsync) {
            void vscode.window.showWarningMessage('rsync not found. Falling back to scp.');
        }
        const useRsync = mode === 'rsync' && tools.rsync;
        const deployCmd = useRsync
            ? `"${tools.rsync}" -avz --delete "${path.dirname(exePath)}/" "${user}@${host}:${remotePath}/"`
            : `"${tools.scp || 'scp'}" -r "${path.dirname(exePath)}" "${user}@${host}:${remotePath}"`;

        this.outputChannel.appendLine(`[Remote] Deploying ${path.basename(exePath)} to ${user}@${host}:${remotePath}...`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Deploying to ${host}...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                try {
                    execSync(deployCmd, { encoding: 'utf-8', stdio: 'pipe' });
                    void vscode.window.showInformationMessage(`Deployed to ${user}@${host}:${remotePath}`);
                    this.outputChannel.appendLine('[Remote] Deployment successful');
                    resolve();
                } catch (error) {
                    const err = error as { stderr?: string; stdout?: string };
                    const msg = err.stderr || err.stdout || String(error);
                    void vscode.window.showErrorMessage(`Remote deploy failed: ${msg}`);
                    reject(new Error(msg));
                }
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Remote Debug Config
    // ─────────────────────────────────────────────────────────────

    async generateRemoteDebugConfig(projectFile?: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        const host = config.get<string>('remoteHost') || '192.168.1.100';
        const user = config.get<string>('remoteUser') || 'root';
        const remotePath = config.get<string>('remotePath') || '/home/' + user + '/qt-app';
        const port = config.get<number>('remoteDebugPort') || 2345;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        let targetProject = projectFile;
        if (!targetProject) {
            const projects = await this.qtProjectDetector.detectProjects(workspaceFolder.uri.fsPath);
            if (projects.length === 0) {
                void vscode.window.showErrorMessage('No Qt project found');
                return;
            }
            if (projects.length === 1) {
                targetProject = projects[0];
            } else {
                const selected = await vscode.window.showQuickPick(
                    projects.map(p => ({ label: path.basename(p), description: p, value: p })),
                    { placeHolder: 'Select project for remote debug config' }
                );
                if (!selected) { return; }
                targetProject = selected.value;
            }
        }

        const projectName = path.basename(targetProject, path.extname(targetProject));
        const buildType = this.qtConfigManager.getProjectBuildType(targetProject);
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const exePath = await this.qtProjectDetector.findExecutable(targetProject, buildDir);
        const localExe = exePath || path.join(buildDir, projectName);
        const remoteExe = path.posix.join(remotePath, path.basename(localExe));

        const tools = this.detectRemoteTools();
        const debuggerPath = tools.gdb || tools.lldb || '/usr/bin/gdb';

        const launchConfig = {
            name: `Remote debug ${projectName} (${host})`,
            type: 'cppdbg',
            request: 'launch',
            program: remoteExe,
            args: [],
            stopAtEntry: false,
            cwd: remotePath,
            environment: [],
            externalConsole: false,
            MIMode: tools.gdb ? 'gdb' : 'lldb',
            miDebuggerPath: debuggerPath,
            miDebuggerServerAddress: `${host}:${port}`,
            setupCommands: [
                {
                    description: 'Enable pretty-printing for gdb',
                    text: '-enable-pretty-printing',
                    ignoreFailures: true
                },
                {
                    description: 'Set sysroot',
                    text: `set sysroot ${remotePath}`,
                    ignoreFailures: true
                }
            ],
            preLaunchTask: undefined as string | undefined
        };

        const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        const launchPath = path.join(vscodeDir, 'launch.json');
        let configurations: unknown[] = [];
        if (fs.existsSync(launchPath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(launchPath, 'utf-8'));
                configurations = Array.isArray(existing.configurations) ? existing.configurations : [];
            } catch {
                // ignore parse errors
            }
        }

        // Replace existing remote debug config for same project/host if present
        const existingIndex = configurations.findIndex((c: any) =>
            c && c.name && c.name.includes(`Remote debug ${projectName}`)
        );
        if (existingIndex >= 0) {
            configurations[existingIndex] = launchConfig;
        } else {
            configurations.push(launchConfig);
        }

        fs.writeFileSync(launchPath, JSON.stringify({ version: '0.2.0', configurations }, null, 4), 'utf-8');
        void vscode.window.showInformationMessage(`Remote debug config generated: ${launchPath}`);
        this.outputChannel.appendLine(`[Remote] Debug config written: ${launchPath}`);
    }
}
