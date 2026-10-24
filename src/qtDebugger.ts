import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QtConfigManager } from './qtConfigManager';
import { BuildKit } from './qtBuildKit';
import { QtProjectDetector } from './qtProjectDetector';
import { isWindows, isMacOS, exe } from './platformUtils';

export class QtDebuggerIntegration {
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

    async startProject(projectFile: string, buildDir: string, kit?: BuildKit): Promise<boolean> {
        const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectFile));
        const info = await this.qtProjectDetector.getProjectInfo(projectFile);
        if (!folder || !info) { return false; }
        if (info.type === 'python') {
            if (!vscode.extensions.getExtension('ms-python.debugpy')) {
                await vscode.commands.executeCommand('workbench.extensions.search', '@id:ms-python.debugpy');
                return false;
            }
        }
        const program = info.type === 'python' ? projectFile : await this.qtProjectDetector.findExecutable(projectFile, buildDir, this.qtConfigManager.getProjectBuildType(projectFile));
        if (!program) {
            void vscode.window.showErrorMessage('No application executable found. Select an application target and build it before debugging.');
            return false;
        }
        const debuggerInfo = await this.getDebuggerType(kit?.compiler);
        const type = info.type === 'python' ? 'debugpy' : debuggerInfo.miMode === 'lldb' ? 'lldb' : debuggerInfo.type;
        const adapter = type === 'debugpy' ? 'ms-python.debugpy' : type === 'lldb' ? 'vadimcn.vscode-lldb' : 'ms-vscode.cpptools';
        if (!vscode.extensions.getExtension(adapter)) {
            void vscode.window.showInformationMessage(`Install ${adapter} to debug this project.`);
            await vscode.commands.executeCommand('workbench.extensions.search', `@id:${adapter}`);
            return false;
        }
        const run = vscode.workspace.getConfiguration('qt').get<Record<string, { args?: string[]; env?: Record<string, string>; cwd?: string }>>('runSettings', {})[projectFile] || {};
        const env = { ...kit?.envVars, ...run.env };
        const launch: vscode.DebugConfiguration = {
            name: `Debug ${info.name}`, type, request: 'launch', program,
            cwd: run.cwd ? path.resolve(path.dirname(projectFile), run.cwd) : path.dirname(program),
            args: run.args || []
        };
        if (type === 'cppdbg' || type === 'cppvsdbg') {
            launch.environment = Object.entries(env).map(([name, value]) => ({ name, value }));
            if (debuggerInfo.miMode) { launch.MIMode = debuggerInfo.miMode; }
            if (debuggerInfo.miMode === 'gdb') {
                const printer = vscode.extensions.getExtension('akhilp19.qt-vsc-extension')?.extensionPath;
                launch.setupCommands = [{ text: '-enable-pretty-printing', ignoreFailures: true }];
                if (printer) { launch.setupCommands.push({ text: `source ${JSON.stringify(path.join(printer, 'scripts', 'qt_pretty_printers.py'))}`, ignoreFailures: true }); }
            }
        } else { launch.env = env; }
        if (type === 'debugpy') {
            const python = vscode.workspace.getConfiguration('qt').get<string>('pythonExecutable');
            if (python) { launch.python = python; }
        }
        // The workflow already built successfully; no launch.json or second build is needed.
        return vscode.debug.startDebugging(folder, launch);
    }

    /**
     * Generate debug launch configurations for the current Qt project.
     */
    async generateLaunchConfig(projectFile?: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // Resolve project file
        let targetProject = projectFile;
        if (!targetProject) {
            const projects = await this.qtProjectDetector.detectProjects(workspaceFolder.uri.fsPath);
            if (projects.length === 0) {
                void vscode.window.showErrorMessage('No Qt project found in workspace');
                return;
            }
            if (projects.length === 1) {
                targetProject = projects[0];
            } else {
                const selected = await vscode.window.showQuickPick(
                    projects.map(p => ({ label: path.basename(p), description: p, value: p })),
                    { placeHolder: 'Select Qt project to generate debug config for' }
                );
                if (!selected) { return; }
                targetProject = selected.value;
            }
        }

        if (!targetProject) { return; }

        // Determine project type and name
        const projectInfo = await this.qtProjectDetector.getProjectInfo(targetProject);
        const projectName = path.basename(targetProject, path.extname(targetProject));
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const executablePath = this.findBuiltExecutable(projectName, buildDir, targetProject, projectInfo?.type || 'qmake');

        // Detect debugger
        const debuggerInfo = await this.getDebuggerType();
        const config = vscode.workspace.getConfiguration('qt');
        const extraArgs = config.get<string>('debugAdditionalArgs') || '';
        const qmlDebugPort = config.get<number>('qmlDebugPort') || 3768;

        // Build launch configurations
        const launchConfigs: unknown[] = [];

        // Standard debug config
        const standardConfig: Record<string, unknown> = {
            name: `Debug ${projectName}`,
            type: debuggerInfo.type,
            request: 'launch',
            program: executablePath,
            args: extraArgs ? extraArgs.split(/\s+/) : [],
            stopAtEntry: false,
            cwd: '${workspaceFolder}',
            environment: [],
            externalConsole: false,
            preLaunchTask: `qt: Build ${projectName}`
        };

        if (debuggerInfo.miMode) {
            standardConfig.MIMode = debuggerInfo.miMode;
            standardConfig.setupCommands = [
                {
                    description: 'Enable pretty-printing for gdb',
                    text: '-enable-pretty-printing',
                    ignoreFailures: true
                }
            ];
        }

        launchConfigs.push(standardConfig);

        // QML debug config
        const qmlArgs = extraArgs ? extraArgs.split(/\s+/) : [];
        qmlArgs.push(`-qmljsdebugger=port:${qmlDebugPort},block`);

        const qmlConfig: Record<string, unknown> = {
            name: `Debug ${projectName} (QML)`,
            type: debuggerInfo.type,
            request: 'launch',
            program: executablePath,
            args: qmlArgs,
            stopAtEntry: false,
            cwd: '${workspaceFolder}',
            environment: [],
            externalConsole: false,
            preLaunchTask: `qt: Build ${projectName}`
        };

        if (debuggerInfo.miMode) {
            qmlConfig.MIMode = debuggerInfo.miMode;
            qmlConfig.setupCommands = [
                {
                    description: 'Enable pretty-printing for gdb',
                    text: '-enable-pretty-printing',
                    ignoreFailures: true
                }
            ];
        }

        launchConfigs.push(qmlConfig);

        // Write to launch.json
        const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        const launchJsonPath = path.join(vscodeDir, 'launch.json');
        let launchJson: { version: string; configurations: unknown[] };

        if (fs.existsSync(launchJsonPath)) {
            try {
                launchJson = JSON.parse(fs.readFileSync(launchJsonPath, 'utf-8')) as { version: string; configurations: unknown[] };
                if (!Array.isArray(launchJson.configurations)) {
                    launchJson.configurations = [];
                }
            } catch {
                launchJson = { version: '0.2.0', configurations: [] };
            }
        } else {
            launchJson = { version: '0.2.0', configurations: [] };
        }

        // Avoid duplicates by name
        let added = 0;
        for (const newConfig of launchConfigs) {
            const newName = (newConfig as Record<string, string>).name;
            const exists = launchJson.configurations.some(
                (c: unknown) => (c as Record<string, string>).name === newName
            );
            if (!exists) {
                launchJson.configurations.push(newConfig);
                added++;
            }
        }

        fs.writeFileSync(launchJsonPath, JSON.stringify(launchJson, null, 4), 'utf-8');

        this.outputChannel.appendLine(`Generated ${added} launch config(s) for ${projectName}`);
        void vscode.window.showInformationMessage(
            `Added ${added} debug configuration(s) to .vscode/launch.json`,
            'Open launch.json'
        ).then(choice => {
            if (choice === 'Open launch.json') {
                void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(launchJsonPath));
            }
        });
    }

    /**
     * Setup Qt pretty printers for the workspace.
     */
    async setupPrettyPrinters(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // Copy pretty printer script to workspace
        const extensionPath = vscode.extensions.getExtension('akhilp19.qt-vsc-extension')?.extensionPath;
        if (!extensionPath) {
            void vscode.window.showErrorMessage('Could not find extension path');
            return;
        }

        const sourceScript = path.join(extensionPath, 'scripts', 'qt_pretty_printers.py');
        const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
        const targetScript = path.join(vscodeDir, 'qt_pretty_printers.py');

        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        if (fs.existsSync(targetScript)) {
            const overwrite = await vscode.window.showQuickPick(
                ['Overwrite', 'Skip'],
                { placeHolder: 'Qt pretty printers already exist in .vscode/' }
            );
            if (overwrite !== 'Overwrite') {
                return;
            }
        }

        try {
            fs.copyFileSync(sourceScript, targetScript);
            this.outputChannel.appendLine(`Copied Qt pretty printers to ${targetScript}`);
        } catch (error) {
            void vscode.window.showErrorMessage(`Failed to copy pretty printers: ${String(error)}`);
            return;
        }

        // Ask user how they want to load the printers
        const mode = await vscode.window.showQuickPick(
            [
                {
                    label: 'Add to launch.json',
                    description: 'Injects setupCommands into Qt debug configs',
                    value: 'launch'
                },
                {
                    label: 'Generate .gdbinit',
                    description: 'Creates a .gdbinit file in workspace root',
                    value: 'gdbinit'
                }
            ],
            { placeHolder: 'How do you want to load the pretty printers?' }
        );

        if (!mode) { return; }

        if (mode.value === 'launch') {
            await this.addPrettyPrintersToLaunchJson(targetScript);
        } else {
            await this.generateGdbinit(targetScript, workspaceFolder.uri.fsPath);
        }
    }

    /**
     * Add a function breakpoint on QObject::connect to trace signal/slot connections.
     */
    async addSignalSlotBreakpoint(): Promise<void> {
        const breakpoint = new vscode.FunctionBreakpoint('QObject::connect', true);
        vscode.debug.addBreakpoints([breakpoint]);
        void vscode.window.showInformationMessage(
            'Added function breakpoint on QObject::connect. Start debugging to trace signal/slot connections.',
            'OK'
        );
        this.outputChannel.appendLine('Added signal/slot breakpoint on QObject::connect');
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private async addPrettyPrintersToLaunchJson(scriptPath: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        const launchJsonPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json');
        if (!fs.existsSync(launchJsonPath)) {
            void vscode.window.showWarningMessage('No launch.json found. Generate debug config first.');
            return;
        }

        try {
            const launchJson = JSON.parse(fs.readFileSync(launchJsonPath, 'utf-8')) as { configurations: Array<Record<string, unknown>> };
            let modified = 0;

            for (const config of launchJson.configurations) {
                if (config.type !== 'cppdbg') { continue; }

                const setupCommands = (config.setupCommands as Array<Record<string, unknown>>) || [];
                const printerCmd = {
                    description: 'Load Qt pretty printers',
                    text: `-interpreter-exec console "source ${scriptPath}"`,
                    ignoreFailures: true
                };

                // Avoid duplicate
                const exists = setupCommands.some(
                    (cmd: Record<string, unknown>) => (cmd.text as string)?.includes('qt_pretty_printers')
                );
                if (!exists) {
                    setupCommands.push(printerCmd);
                    config.setupCommands = setupCommands;
                    modified++;
                }
            }

            fs.writeFileSync(launchJsonPath, JSON.stringify(launchJson, null, 4), 'utf-8');
            void vscode.window.showInformationMessage(`Added pretty printer setup to ${modified} debug config(s)`);
        } catch (error) {
            void vscode.window.showErrorMessage(`Failed to update launch.json: ${String(error)}`);
        }
    }

    private async generateGdbinit(scriptPath: string, workspaceRoot: string): Promise<void> {
        const gdbinitPath = path.join(workspaceRoot, '.gdbinit');
        const sourceLine = `source ${scriptPath}\n`;

        let content = '';
        if (fs.existsSync(gdbinitPath)) {
            content = fs.readFileSync(gdbinitPath, 'utf-8');
            if (content.includes('qt_pretty_printers')) {
                void vscode.window.showInformationMessage('.gdbinit already references Qt pretty printers');
                return;
            }
        }

        content += `\n# Qt Pretty Printers\n${sourceLine}`;
        fs.writeFileSync(gdbinitPath, content, 'utf-8');
        void vscode.window.showInformationMessage(`Updated ${gdbinitPath}`);
    }

    private findBuiltExecutable(projectName: string, buildDir: string, projectFile: string, projectType: string): string {
        const isQmake = projectType === 'qmake' || projectFile.endsWith('.pro');
        const baseName = projectName;

        // Possible executable paths
        const candidates: string[] = [];

        if (isWindows()) {
            candidates.push(
                path.join(buildDir, `${baseName}${exe('')}`),
                path.join(buildDir, 'Debug', `${baseName}${exe('')}`),
                path.join(buildDir, 'Release', `${baseName}${exe('')}`),
                path.join(buildDir, 'debug', `${baseName}${exe('')}`),
                path.join(buildDir, 'release', `${baseName}${exe('')}`)
            );
        } else {
            candidates.push(
                path.join(buildDir, baseName),
                path.join(buildDir, 'Debug', baseName),
                path.join(buildDir, 'Release', baseName),
                path.join(buildDir, 'debug', baseName),
                path.join(buildDir, 'release', baseName)
            );
        }

        // Return first existing, or the primary candidate if none exist yet
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return candidates[0]; // Most likely path even if not built yet
    }

    private async getDebuggerType(compilerOverride?: string): Promise<{ type: string; miMode?: string }> {
        const config = vscode.workspace.getConfiguration('qt');
        const override = config.get<string>('debuggerType') || 'auto';

        if (override !== 'auto') {
            if (override === 'cppvsdbg') {
                return { type: 'cppvsdbg' };
            }
            return { type: 'cppdbg', miMode: override };
        }

        // Auto-detect from compiler
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (compilerOverride || qtInstallation?.compiler) {
            const compiler = (compilerOverride || qtInstallation?.compiler || '').toLowerCase();
            if (compiler.includes('msvc')) {
                return { type: 'cppvsdbg' };
            } else if (compiler.includes('mingw') || compiler.includes('gcc')) {
                return { type: 'cppdbg', miMode: 'gdb' };
            } else if (compiler.includes('clang') || compiler.includes('apple')) {
                return { type: 'cppdbg', miMode: 'lldb' };
            }
        }

        // Platform fallback
        if (isWindows()) {
            return { type: 'cppvsdbg' };
        } else if (isMacOS()) {
            return { type: 'cppdbg', miMode: 'lldb' };
        }
        return { type: 'cppdbg', miMode: 'gdb' };
    }
}
