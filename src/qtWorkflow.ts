import * as vscode from 'vscode';
import * as path from 'path';
import { QtPythonSupport } from './qtPythonSupport';
import { execFile } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';
import { QtBuildKitManager } from './qtBuildKit';
import { QtTaskProvider } from './qtTaskProvider';
import { QtBuildTracker } from './qtBuildTracker';
import { QtDebuggerIntegration } from './qtDebugger';

export class QtWorkflow implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private busy = new Set<string>();
    private projectBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 104);
    private kitBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 103);
    private configBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);

    constructor(private context: vscode.ExtensionContext, private config: QtConfigManager,
        private detector: QtProjectDetector, private kits: QtBuildKitManager,
        private tasks: QtTaskProvider, private tracker: QtBuildTracker,
        private debuggerIntegration: QtDebuggerIntegration, private output: vscode.OutputChannel) {
        this.projectBar.command = 'qt.selectProject';
        this.kitBar.command = 'qt.selectBuildKit';
        this.configBar.command = 'qt.selectBuildConfig';
        this.disposables.push(this.projectBar, this.kitBar, this.configBar,
            vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('qt')) { void this.refresh(); } }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.refresh(); void this.offerSetup(); }));
        void this.refresh();
    }

    dispose(): void { this.disposables.forEach(d => d.dispose()); }

    async projects(): Promise<string[]> {
        const groups = await Promise.all((vscode.workspace.workspaceFolders || [])
            .map(folder => this.detector.detectProjects(folder.uri.fsPath)));
        return groups.flat();
    }

    async selectProject(force = false, specific?: string): Promise<string | undefined> {
        const projects = await this.projects();
        const saved = this.context.workspaceState.get<string>('qt.activeProject');
        let selected = specific;
        if (!selected && !force && saved && projects.includes(saved)) { selected = saved; }
        if (!selected && !force && projects.length === 1) { selected = projects[0]; }
        if (!selected) {
            if (!projects.length) {
                const choice = await vscode.window.showInformationMessage('Open a Qt project folder or create a new project.', 'New Qt Project');
                if (choice) { await vscode.commands.executeCommand('qt.newProject'); }
                return undefined;
            }
            selected = (await vscode.window.showQuickPick(projects.map(file => ({
                label: path.basename(path.dirname(file)), description: file, file
            })), { placeHolder: 'Select the active Qt project' }))?.file;
        }
        if (selected) {
            await this.context.workspaceState.update('qt.activeProject', selected);
            await this.refresh();
        }
        return selected;
    }

    async refresh(): Promise<void> {
        const projects = await this.projects();
        const saved = this.context.workspaceState.get<string>('qt.activeProject');
        const project = saved && projects.includes(saved) ? saved : projects.length === 1 ? projects[0] : undefined;
        if (!projects.length) {
            this.projectBar.hide(); this.kitBar.hide(); this.configBar.hide(); return;
        }
        this.projectBar.text = `$(project) ${project ? path.basename(path.dirname(project)) : 'Select Qt project'}`;
        this.projectBar.tooltip = project || 'Select the project used by Build, Run and Debug';
        this.projectBar.show();
        this.kitBar.text = `$(tools) ${project ? this.kits.getActiveKit(project)?.name || 'Select Qt kit' : 'Select Qt kit'}`;
        this.kitBar.tooltip = 'Select a Qt installation and toolchain for the active project';
        this.kitBar.show();
        this.configBar.text = `$(gear) ${project ? this.config.getProjectBuildType(project) : 'Debug / Release'}`;
        this.configBar.show();
    }

    async offerSetup(): Promise<void> {
        if (!vscode.workspace.isTrusted || this.context.workspaceState.get('qt.setupOffered') || !(await this.projects()).length) { return; }
        await this.context.workspaceState.update('qt.setupOffered', true);
        if (await vscode.window.showInformationMessage('Qt project detected. Check your tools and choose a build kit to get started.', 'Set Up Qt') === 'Set Up Qt') {
            await this.setup();
        }
    }

    private async toolAvailable(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<boolean> {
        return new Promise(resolve => execFile(command, args, { timeout: 5000, env: { ...process.env, ...env } }, error => resolve(!error)));
    }

    async setup(): Promise<void> {
        if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage('Trust this workspace before configuring or running Qt tools.'); return; }
        const project = await this.selectProject();
        if (!project) { return; }
        const info = await this.detector.getProjectInfo(project);
        if (info?.type === 'python') {
            const python = vscode.workspace.getConfiguration('qt').get<string>('pythonExecutable') || (process.platform === 'win32' ? 'python' : 'python3');
            const binding = new QtPythonSupport(this.output).detectQtBinding(project);
            const pythonReady = await this.toolAvailable(python, ['-c', binding === 'unknown' ? 'import sys' : `import ${binding}`]);
            const items = [
                { label: `${pythonReady ? '$(check)' : '$(warning)'} Python / ${binding}`, description: pythonReady ? python : 'Install the Qt binding in your Python environment; set qt.pythonExecutable if needed.', command: 'qt.openPythonSettings' },
                { label: '$(debug-alt) Python debugger', description: 'Install the Python debugger extension for Debug', command: 'qt.openPythonDebugger' },
                { label: '$(play) Run', description: 'Save files and run with your Python interpreter', command: 'qt.runProject' }
            ];
            const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Python Qt setup' });
            if (choice) { await vscode.commands.executeCommand(choice.command); }
            return;
        }
        if (!(vscode.workspace.getConfiguration('qt').get<unknown[]>('buildKits') || []).length) {
            await this.kits.saveDetectedKits();
        }
        const qt = await this.config.getQtInstallation();
        const kit = this.kits.getActiveKit(project);
        const qmakeReady = !!(kit?.qmakePath || qt?.qmakePath) && await this.toolAvailable(kit?.qmakePath || qt!.qmakePath, ['-query', 'QT_VERSION'], kit?.envVars);
        const compiler = process.platform === 'win32' ? ((kit?.compiler || qt?.compiler || '').toLowerCase().includes('msvc') ? 'cl' : 'g++') : process.platform === 'darwin' ? 'clang++' : 'g++';
        const available = await this.toolAvailable(compiler, compiler === 'cl' ? ['/?'] : ['--version'], kit?.envVars);
        const cmake = info?.type === 'cmake' ? await this.toolAvailable('cmake', ['--version']) : true;
        const make = this.config.getMakeCommand(kit ? { path: kit.qtPath, qmakePath: kit.qmakePath, compiler: kit.compiler } : qt);
        const makeReady = await this.toolAvailable(process.platform === 'win32' ? 'where' : 'which', [make], kit?.envVars);
        const debuggerReady = !!vscode.extensions.getExtension(process.platform === 'darwin' ? 'vadimcn.vscode-lldb' : 'ms-vscode.cpptools');
        const items = [
            { label: `${qmakeReady ? '$(check)' : '$(warning)'} Qt installation`, description: kit?.qtPath || qt?.path || 'Not detected — configure Qt or install it', command: kit ? 'qt.selectBuildKit' : qt ? 'qt.selectQtVersion' : 'qt.configureQt' },
            { label: `${available ? '$(check)' : '$(warning)'} C++ compiler`, description: available ? compiler : `Check ${compiler} and the kit environment`, command: 'qt.runHealthCheck' },
            { label: `${cmake && makeReady ? '$(check)' : '$(warning)'} Build tools`, description: `${info?.type === 'cmake' ? `CMake: ${cmake ? 'available' : 'missing'}; ` : ''}${make}: ${makeReady ? 'available' : 'not found in PATH'}`, command: 'qt.runHealthCheck' },
            { label: `${debuggerReady ? '$(check)' : '$(warning)'} Debug adapter`, description: debuggerReady ? 'Installed' : 'Install the C++ debugger extension', command: 'qt.openDebuggerExtension' },
            { label: '$(search) Detect build kits', description: 'Find Qt installations and add their toolchains', command: 'qt.detectBuildKits' },
            { label: '$(tools) Select build kit', description: kit?.name || 'Choose a kit for this project', command: 'qt.selectBuildKit' },
            { label: '$(gear) Debug / Release', description: this.config.getProjectBuildType(project), command: 'qt.selectBuildConfig' },
            { label: '$(cloud-download) Qt installation instructions', command: 'qt.installQt' },
            { label: '$(play) Build and Run', description: 'Save files, build, then launch after success', command: 'qt.runProject' }
        ];
        const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Qt setup — select an item to configure it. Run Set Up Project again to recheck.' });
        if (choice) { await vscode.commands.executeCommand(choice.command); }
    }

    async execute(kind: 'build' | 'clean' | 'rebuild' | 'run' | 'debug', specific?: string, quick = false): Promise<void> {
        if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage('Trust this workspace before running Qt commands.'); return; }
        const project = await this.selectProject(false, specific);
        if (!project) { return; }
        if (this.busy.has(project) || this.tracker.isBuilding(project)) { void vscode.window.showInformationMessage('A Qt task is already running for this project.'); return; }
        this.busy.add(project);
        try {
            const info = await this.detector.getProjectInfo(project);
            const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project));
            if (!info || !folder) { return; }
            if (info.type !== 'python' && info.type !== 'raw' && !this.kits.getActiveKit(project)) {
                if (await vscode.window.showInformationMessage('Choose a Qt build kit before building this project.', 'Select Kit') !== 'Select Kit') { return; }
                await this.kits.selectKit(project);
                if (!this.kits.getActiveKit(project)) { return; }
            }
            if (info.type === 'python' && (kind === 'build' || kind === 'rebuild' || kind === 'clean')) {
                void vscode.window.showInformationMessage('Python Qt projects do not need a native build. Use Run or Debug.'); return;
            }
            if (kind !== 'clean' && !await vscode.workspace.saveAll(false)) { return; }
            const run = kind === 'run' || kind === 'debug';
            if (info.type !== 'python' && run && vscode.workspace.getConfiguration('qt').get<boolean>('buildBeforeRun', true)) {
                const build = await this.tasks.resolveTask(new vscode.Task({ type: 'qt', task: 'build', file: project }, folder, 'Build', 'qt'), { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
                if (!build || !await this.executeAndWait(build)) {
                    const choice = await vscode.window.showErrorMessage('Qt build did not succeed. Launch cancelled. See the terminal or Problems for details.', 'Show Problems', 'Set Up Project');
                    if (choice === 'Show Problems') { await vscode.commands.executeCommand('workbench.actions.view.problems'); }
                    if (choice === 'Set Up Project') { await this.setup(); }
                    return;
                }
            }
            if (kind === 'debug') {
                const dir = this.kits.getBuildDirForProject(project, this.config.getProjectBuildType(project));
                const kit = this.kits.getActiveKit(project);
                await this.debuggerIntegration.startProject(project, dir, kit ? { ...kit, envVars: this.kits.getKitEnvVars(project) } : undefined);
                return;
            }
            const task = await this.tasks.resolveTask(new vscode.Task({ type: 'qt', task: kind, file: project, quickBuild: quick }, folder, kind, 'qt'), { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });
            if (task) { await this.executeAndWait(task); }
            else { void vscode.window.showInformationMessage(`The ${kind} action is not available for this project type.`); }
        } catch (error) {
            void vscode.window.showErrorMessage(`Qt ${kind} failed: ${String(error)}`);
        } finally { this.busy.delete(project); }
    }

    private async executeAndWait(task: vscode.Task): Promise<boolean> {
        // Subscribe before execution: fast tasks can finish before executeTask resolves.
        const completed = new Map<vscode.TaskExecution, boolean>();
        let execution: vscode.TaskExecution | undefined;
        let resolveResult: ((success: boolean) => void) | undefined;
        const result = new Promise<boolean>(resolve => { resolveResult = resolve; });
        const listener = vscode.tasks.onDidEndTask(e => {
            const success = this.tracker.getExecutionResult(e.execution) === true;
            if (e.execution === execution) { resolveResult?.(success); }
            else { completed.set(e.execution, success); }
        });
        try {
            execution = await vscode.tasks.executeTask(task);
            if (completed.has(execution)) { return completed.get(execution)!; }
            return await result;
        } finally { listener.dispose(); }
    }

    async configureRun(): Promise<void> {
        if (!vscode.workspace.isTrusted) { return; }
        const project = await this.selectProject();
        if (!project) { return; }
        const config = vscode.workspace.getConfiguration('qt');
        const settings = config.get<Record<string, { args?: string[]; env?: Record<string, string>; cwd?: string }>>('runSettings', {});
        const run = { args: [...(settings[project]?.args || [])], env: { ...settings[project]?.env }, cwd: settings[project]?.cwd };
        for (;;) {
            const choice = await vscode.window.showQuickPick([
                { label: 'Add argument', description: run.args.join(' · ') || 'No arguments', id: 'addArg' },
                { label: 'Remove argument', description: `${run.args.length} argument(s)`, id: 'removeArg' },
                { label: 'Set environment variable', description: Object.keys(run.env).join(', ') || 'No overrides', id: 'setEnv' },
                { label: 'Remove environment variable', id: 'removeEnv' },
                { label: 'Working directory', description: run.cwd || 'Executable directory (Python: project directory)', id: 'cwd' },
                { label: 'Save run settings', id: 'save' }
            ], { placeHolder: 'Configure Run and Debug — close to discard changes' });
            if (!choice) { return; }
            if (choice.id === 'save') { break; }
            if (choice.id === 'addArg') {
                const value = await vscode.window.showInputBox({ prompt: 'One argument, including spaces if needed. Do not add shell quotes.' });
                if (value !== undefined) { run.args.push(value); }
            } else if (choice.id === 'removeArg') {
                const selected = await vscode.window.showQuickPick(run.args.map((arg, index) => ({ label: `${index + 1}: ${arg}`, index })), { placeHolder: 'Remove which argument?' });
                if (selected) { run.args.splice(selected.index, 1); }
            } else if (choice.id === 'setEnv') {
                const name = await vscode.window.showInputBox({ prompt: 'Environment variable name', validateInput: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? undefined : 'Enter a variable name such as QT_LOGGING_RULES.' });
                if (name === undefined) { continue; }
                const value = await vscode.window.showInputBox({ prompt: `Value for ${name}`, value: run.env[name] || '' });
                if (value !== undefined) { run.env[name] = value; }
            } else if (choice.id === 'removeEnv') {
                const name = await vscode.window.showQuickPick(Object.keys(run.env), { placeHolder: 'Remove which override?' });
                if (name !== undefined) { delete run.env[name]; }
            } else {
                const value = await vscode.window.showInputBox({ prompt: 'Working directory. Relative paths start at the project directory. Leave empty for the default.', value: run.cwd || '' });
                if (value !== undefined) { run.cwd = value || undefined; }
            }
        }
        settings[project] = run;
        await config.update('runSettings', settings, vscode.ConfigurationTarget.Workspace);
    }
}
