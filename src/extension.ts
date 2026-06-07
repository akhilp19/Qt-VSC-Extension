import * as vscode from 'vscode';
import * as path from 'path';
import { QtTaskProvider } from './qtTaskProvider';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';
import { QtProjectTreeProvider } from './qtProjectTreeProvider';
import {
    ProjectType,
    PROJECT_TYPES,
    QT_MODULES,
    generateQMakeProject,
    generateCMakeProject,
    writeProjectFiles,
    ProjectTemplateOptions
} from './projectTemplates';

let taskProvider: vscode.Disposable | undefined;
let outputChannel: vscode.OutputChannel;
let qtConfigManager: QtConfigManager;
let qtProjectDetector: QtProjectDetector;
let treeProvider: QtProjectTreeProvider;

// Status bar items
let buildStatusBarItem: vscode.StatusBarItem;
let runStatusBarItem: vscode.StatusBarItem;
let cleanStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
    console.log('Qt C++ Tools extension is now active!');
    
    // Create output channel
    outputChannel = vscode.window.createOutputChannel('Qt C++ Tools');
    context.subscriptions.push(outputChannel);
    
    // Initialize managers
    qtConfigManager = new QtConfigManager(outputChannel);
    qtProjectDetector = new QtProjectDetector(outputChannel);
    
    // Create tree provider
    treeProvider = new QtProjectTreeProvider(qtProjectDetector, qtConfigManager, outputChannel);
    
    // Register tree data provider
    const treeDisposable = vscode.window.registerTreeDataProvider('qt-projects', treeProvider);
    context.subscriptions.push(treeDisposable);
    
    // Register task provider
    const qtTaskProviderInstance = new QtTaskProvider(qtConfigManager, qtProjectDetector, outputChannel);
    taskProvider = vscode.tasks.registerTaskProvider('qt', qtTaskProviderInstance);
    context.subscriptions.push(taskProvider);
    
    // Create status bar items
    buildStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    buildStatusBarItem.command = 'qt.buildProject';
    buildStatusBarItem.text = '$(tools) Build';
    buildStatusBarItem.tooltip = 'Qt: Build Project';
    buildStatusBarItem.show();
    context.subscriptions.push(buildStatusBarItem);
    
    runStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    runStatusBarItem.command = 'qt.runProject';
    runStatusBarItem.text = '$(run) Run';
    runStatusBarItem.tooltip = 'Qt: Run Project';
    runStatusBarItem.show();
    context.subscriptions.push(runStatusBarItem);
    
    cleanStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    cleanStatusBarItem.command = 'qt.cleanProject';
    cleanStatusBarItem.text = '$(trash) Clean';
    cleanStatusBarItem.tooltip = 'Qt: Clean Project';
    cleanStatusBarItem.show();
    context.subscriptions.push(cleanStatusBarItem);
    
    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.buildProject', async () => {
            await executeQtTask('build');
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.cleanProject', async () => {
            await executeQtTask('clean');
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.rebuildProject', async () => {
            await executeQtTask('rebuild');
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.runProject', async () => {
            await executeQtTask('run');
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.configureQt', async () => {
            await configureQtPath();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.selectQtVersion', async () => {
            await selectQtVersion();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.createQMakeProject', async () => {
            await createQMakeProject();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.createCMakeProject', async () => {
            await createCMakeProject();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.refreshProjects', async () => {
            await treeProvider.refresh();
        })
    );
    
    // Auto-detect Qt on activation
    void qtConfigManager.detectQtInstallation();
    
    outputChannel.appendLine('Qt C++ Tools extension initialized successfully');
}

async function executeQtTask(taskType: 'build' | 'clean' | 'rebuild' | 'run'): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        void vscode.window.showErrorMessage('No workspace folder open');
        return;
    }
    
    // Find Qt projects in workspace
    const projects = await qtProjectDetector.detectProjects(workspaceFolder.uri.fsPath);
    if (projects.length === 0) {
        void vscode.window.showErrorMessage('No Qt project found in workspace. Looking for .pro or CMakeLists.txt files.');
        return;
    }
    
    // If multiple projects, let user select
    let projectFile: string;
    if (projects.length === 1) {
        projectFile = projects[0];
    } else {
        const selected = await vscode.window.showQuickPick(
            projects.map(p => ({ label: p, description: p })),
            { placeHolder: `Select Qt project to ${taskType}` }
        );
        if (!selected) {
            return;
        }
        projectFile = selected.label;
    }
    
    // Create and execute task
    const taskDef: vscode.TaskDefinition = {
        type: 'qt',
        task: taskType,
        file: projectFile
    };
    
    const tasks = await vscode.tasks.fetchTasks({ type: 'qt' });
    const matchingTask = tasks.find(t => 
        t.definition.task === taskType && 
        t.definition.file === projectFile
    );
    
    if (matchingTask) {
        await vscode.tasks.executeTask(matchingTask);
    } else {
        void vscode.window.showErrorMessage(`Failed to create ${taskType} task`);
    }
}

async function configureQtPath(): Promise<void> {
    const config = vscode.workspace.getConfiguration('qt');
    
    const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            'Executable': ['exe']
        },
        title: 'Select qmake executable'
    });
    
    if (result && result[0]) {
        const qmakePath = result[0].fsPath;
        await config.update('qmakePath', qmakePath, vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage(`Qt qmake path set to: ${qmakePath}`);
        outputChannel.appendLine(`User configured qmake path: ${qmakePath}`);
        
        // Re-detect Qt installation
        await qtConfigManager.detectQtInstallation();
    }
}

async function selectQtVersion(): Promise<void> {
    const qtVersions = await qtConfigManager.findQtInstallations();
    
    if (qtVersions.length === 0) {
        void vscode.window.showErrorMessage('No Qt installations found. Please configure Qt path manually.');
        return;
    }
    
    const items = qtVersions.map(qt => ({
        label: qt.version || 'Unknown',
        description: qt.path,
        detail: `qmake: ${qt.qmakePath}`
    }));
    
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select Qt version to use'
    });
    
    if (selected) {
        const config = vscode.workspace.getConfiguration('qt');
        await config.update('qmakePath', selected.detail.replace('qmake: ', ''), vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage(`Using Qt version: ${selected.label}`);
        outputChannel.appendLine(`Selected Qt version: ${selected.label} at ${selected.description}`);
    }
}

async function createQMakeProject(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        void vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    // 1. Project name
    const projectName = await vscode.window.showInputBox({
        prompt: 'Enter project name',
        placeHolder: 'MyQtApp',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Project name cannot be empty';
            }
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) {
                return 'Project name must start with a letter and contain only letters, numbers, and underscores';
            }
            return null;
        }
    });

    if (!projectName) {
        return;
    }

    // 2. Project type
    const selectedType = await vscode.window.showQuickPick(
        PROJECT_TYPES.map(t => ({ label: t.label, description: t.description, value: t.value })),
        { placeHolder: 'Select project type' }
    );

    if (!selectedType) {
        return;
    }

    // 3. Qt modules
    const selectedModules = await vscode.window.showQuickPick(
        QT_MODULES.map(m => ({ label: m.label, description: m.description, value: m.value, picked: m.picked })),
        { placeHolder: 'Select Qt modules (Space to multi-select)', canPickMany: true }
    );

    const modules = selectedModules?.map(m => m.value) ?? ['core', 'gui'];

    // 4. Window class for widgets app
    let includeWindowClass = false;
    if (selectedType.value === 'widgets-app') {
        const windowChoice = await vscode.window.showQuickPick(
            [
                { label: 'Simple QWidget', description: 'Minimal main.cpp with a QWidget', value: false },
                { label: 'MainWindow with .ui file', description: 'Generate MainWindow class + .ui file', value: true }
            ],
            { placeHolder: 'Select window style' }
        );
        includeWindowClass = windowChoice?.value ?? false;
    }

    // 5. Generate files
    const options: ProjectTemplateOptions = {
        projectName,
        projectType: selectedType.value as ProjectType,
        modules,
        qtVersion: 'qt6',
        includeWindowClass
    };

    const targetDir = path.join(workspaceFolder.uri.fsPath, projectName);
    const files = generateQMakeProject(options);

    try {
        const created = await writeProjectFiles(targetDir, files, outputChannel);
        void vscode.window.showInformationMessage(
            `Created QMake project "${projectName}" with ${created.length} file(s).`,
            'Open Folder'
        ).then(choice => {
            if (choice === 'Open Folder') {
                const proFile = path.join(targetDir, `${projectName}.pro`);
                void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetDir));
            }
        });
    } catch (error) {
        void vscode.window.showErrorMessage(`Failed to create project: ${String(error)}`);
        outputChannel.appendLine(`Error creating QMake project: ${String(error)}`);
    }
}

async function createCMakeProject(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        void vscode.window.showErrorMessage('Please open a folder first');
        return;
    }

    // 1. Project name
    const projectName = await vscode.window.showInputBox({
        prompt: 'Enter project name',
        placeHolder: 'MyQtApp',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Project name cannot be empty';
            }
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) {
                return 'Project name must start with a letter and contain only letters, numbers, and underscores';
            }
            return null;
        }
    });

    if (!projectName) {
        return;
    }

    // 2. Project type
    const selectedType = await vscode.window.showQuickPick(
        PROJECT_TYPES.map(t => ({ label: t.label, description: t.description, value: t.value })),
        { placeHolder: 'Select project type' }
    );

    if (!selectedType) {
        return;
    }

    // 3. Qt version
    const selectedQtVersion = await vscode.window.showQuickPick(
        [
            { label: 'Qt 6', description: 'Use Qt 6 (find_package(Qt6 ...))', value: 'qt6' as const },
            { label: 'Qt 5', description: 'Use Qt 5 (find_package(Qt5 ...))', value: 'qt5' as const }
        ],
        { placeHolder: 'Select Qt version' }
    );

    if (!selectedQtVersion) {
        return;
    }

    // 4. Qt modules
    const selectedModules = await vscode.window.showQuickPick(
        QT_MODULES.map(m => ({ label: m.label, description: m.description, value: m.value, picked: m.picked })),
        { placeHolder: 'Select Qt modules (Space to multi-select)', canPickMany: true }
    );

    const modules = selectedModules?.map(m => m.value) ?? ['core', 'gui'];

    // 5. Generate files
    const options: ProjectTemplateOptions = {
        projectName,
        projectType: selectedType.value as ProjectType,
        modules,
        qtVersion: selectedQtVersion.value,
        includeWindowClass: false
    };

    const targetDir = path.join(workspaceFolder.uri.fsPath, projectName);
    const files = generateCMakeProject(options);

    try {
        const created = await writeProjectFiles(targetDir, files, outputChannel);
        void vscode.window.showInformationMessage(
            `Created CMake project "${projectName}" with ${created.length} file(s).`,
            'Open Folder'
        ).then(choice => {
            if (choice === 'Open Folder') {
                void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetDir));
            }
        });
    } catch (error) {
        void vscode.window.showErrorMessage(`Failed to create project: ${String(error)}`);
        outputChannel.appendLine(`Error creating CMake project: ${String(error)}`);
    }
}

export function deactivate(): void {
    if (taskProvider) {
        taskProvider.dispose();
    }
}
