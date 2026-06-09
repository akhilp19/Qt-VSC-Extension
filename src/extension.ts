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
import { QtDesignerIntegration } from './qtDesignerIntegration';
import { QrcSupport } from './qrcSupport';
import { QtDeployment } from './qtDeployment';
import { IntelliSenseHelper } from './intelliSenseHelper';
import { QtCompletionProvider } from './qtCompletionProvider';
import { QtHoverProvider } from './qtHoverProvider';
import { QtBuildTracker } from './qtBuildTracker';
import { QtCreatorImporter } from './qtCreatorImporter';
import { QtCodeActionProvider } from './qtCodeActionProvider';
import { sourceDisplayName } from './packageManagerDetector';
import { QmlSupport } from './qmlSupport';
import { QmlCppBridgeIndexer } from './qmlCppBridge';
import { QmlDefinitionProvider, QmlCompletionProvider as QmlBridgeCompletionProvider, CppReferenceProvider, QmlTypeHoverProvider } from './qmlCppBridgeProviders';
import { QtDebuggerIntegration } from './qtDebugger';
import { QtTestFramework } from './qtTestFramework';
import { QtTranslationProvider } from './qtTranslation';
import { QtPythonSupport } from './qtPythonSupport';
import { QtCodeGenerator } from './qtCodeGenerator';
import { QtGeneratedCodeNavigation } from './qtGeneratedCodeNavigation';
import { QtPchSupport } from './qtPchSupport';
import { QtCustomBuildSystem } from './qtCustomBuildSystem';
import { QtPchBuildIntegration } from './qtPchBuildIntegration';
import { QtBuildScriptInjector } from './qtBuildScriptInjector';
import { QtPchCompilerConfig } from './qtPchCompilerConfig';
import { QtCiCdIntegration } from './qtCiCdIntegration';
import { QtInstallerFramework } from './qtInstallerFramework';
import { QtBuildAnalytics } from './qtBuildAnalytics';
import { QtBuildAnalyticsProvider } from './qtBuildAnalyticsProvider';
import { QtProfiling } from './qtProfiling';
import { QtQmlLanguageServer } from './qtQmlLanguageServer';
import { QtCMakePresets } from './qtCMakePresets';

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
    
    // Create build analytics and tracker
    const buildAnalytics = new QtBuildAnalytics(outputChannel);
    const buildTracker = new QtBuildTracker(outputChannel, buildAnalytics);
    context.subscriptions.push(buildTracker);
    
    // Create tree provider
    treeProvider = new QtProjectTreeProvider(qtProjectDetector, qtConfigManager, buildTracker, outputChannel);
    
    // Register tree data provider
    const treeDisposable = vscode.window.registerTreeDataProvider('qt-projects', treeProvider);
    context.subscriptions.push(treeDisposable);
    
    // Initialize QML support
    const qmlSupport = new QmlSupport(qtConfigManager, outputChannel);
    context.subscriptions.push(qmlSupport);
    
    // Initialize QML Language Server (qmlls) if available
    const qmlLanguageServer = new QtQmlLanguageServer(qtConfigManager, outputChannel);
    context.subscriptions.push(qmlLanguageServer);
    
    // Start qmlls after a short delay with detected QML import paths
    setTimeout(async () => {
        const importPaths = qmlCppBridge.getQmlImportPaths();
        const qtInstallation = await qtConfigManager.getQtInstallation();
        if (qtInstallation) {
            const qtQmlDir = path.join(qtInstallation.path, 'qml');
            if (!importPaths.includes(qtQmlDir)) {
                importPaths.push(qtQmlDir);
            }
        }
        qmlSupport.setQmlImportPaths(importPaths);
        await qmlLanguageServer.start(importPaths);
    }, 5000);
    
    // Initialize CMake Presets
    const qtCMakePresets = new QtCMakePresets(outputChannel);
    
    // Initialize Qt Designer integration
    const qtDesigner = new QtDesignerIntegration(qtConfigManager, outputChannel);
    
    // Initialize QRC support
    const qrcSupport = new QrcSupport(qtConfigManager, outputChannel);
    
    // Initialize deployment
    const qtDeployment = new QtDeployment(qtConfigManager, qtProjectDetector, outputChannel);
    
    // Initialize IntelliSense helper
    const intelliSenseHelper = new IntelliSenseHelper(qtConfigManager, outputChannel);
    
    // Register Qt code intelligence providers
    const qtCompletionProvider = new QtCompletionProvider(outputChannel);
    const qtHoverProvider = new QtHoverProvider(outputChannel);
    const qtCodeActionProvider = new QtCodeActionProvider(outputChannel);
    
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { scheme: 'file', pattern: '**/*.{cpp,h,hpp,c}' },
            qtCompletionProvider,
            '.', '>', ':'
        )
    );
    
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { scheme: 'file', pattern: '**/*.{cpp,h,hpp,c}' },
            qtHoverProvider
        )
    );
    
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { scheme: 'file', pattern: '**/*.{cpp,h,hpp,c}' },
            qtCodeActionProvider
        )
    );
    
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
        vscode.commands.registerCommand('qt.showBuildAnalytics', async () => {
            await vscode.commands.executeCommand('qt-build-analytics.focus');
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.configureCcache', async () => {
            await buildAnalytics.configureCcache();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.showCcacheStats', async () => {
            await buildAnalytics.showCcacheStats();
        })
    );
    
    // Qt Profiling & Diagnostics
    const qtProfiling = new QtProfiling(qtConfigManager, qtProjectDetector, outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.launchQmlProfiler', async () => {
            await qtProfiling.launchQmlProfiler();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.launchCpuProfiler', async () => {
            await qtProfiling.launchCpuProfiler();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.launchMemoryProfiler', async () => {
            await qtProfiling.launchMemoryProfiler();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.detectSlowTargets', async () => {
            await qtProfiling.detectSlowTargets();
        })
    );
    
    // CMake Preset commands
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.selectCMakePreset', async (uri?: vscode.Uri) => {
            const projectFile = uri?.fsPath;
            if (!projectFile) {
                void vscode.window.showErrorMessage('No CMake project selected');
                return;
            }
            await qtCMakePresets.selectPreset(projectFile);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.clearCMakePreset', async (uri?: vscode.Uri) => {
            const projectFile = uri?.fsPath;
            if (!projectFile) {
                void vscode.window.showErrorMessage('No CMake project selected');
                return;
            }
            await qtCMakePresets.clearPreset(projectFile);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.buildProject', async (uri?: vscode.Uri) => {
            await executeQtTask('build', uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.quickBuild', async (uri?: vscode.Uri) => {
            await executeQtTask('build', uri?.fsPath, true);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.installQt', async () => {
            await showInstallQtInstructions();
        })
    );
    
    // QML commands
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.formatQml', async () => {
            await qmlSupport.formatQml();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.lintQml', async () => {
            await qmlSupport.lintQml();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.previewQml', async () => {
            await qmlSupport.previewQml();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.stopQmlPreview', async () => {
            qmlSupport.stopPreview();
            void vscode.window.showInformationMessage('QML preview stopped');
        })
    );
    
    // Auto-format / auto-lint / hot-reload QML on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.languageId !== 'qml') {
                return;
            }
            const config = vscode.workspace.getConfiguration('qt');
            
            if (config.get<boolean>('qmlFormatOnSave')) {
                await qmlSupport.formatQml(document.uri.fsPath);
            }
            
            if (config.get<boolean>('qmlLintOnSave') ?? true) {
                await qmlSupport.lintQml(document.uri.fsPath);
            }
            
            // Hot reload QML preview on save
            if (config.get<boolean>('qmlPreviewHotReload') ?? false) {
                await qmlSupport.hotReloadIfEnabled(document.uri.fsPath);
            }
        })
    );
    
    // QML-C++ Bridge
    const qmlCppBridge = new QmlCppBridgeIndexer(outputChannel);
    
    // Build index after a short delay so activation isn't blocked
    setTimeout(() => {
        void qmlCppBridge.indexWorkspace();
    }, 3000);
    
    const qmlDefProvider = new QmlDefinitionProvider(qmlCppBridge, outputChannel);
    const qmlBridgeCompProvider = new QmlBridgeCompletionProvider(qmlCppBridge, outputChannel);
    const cppRefProvider = new CppReferenceProvider(qmlCppBridge, outputChannel);
    const qmlTypeHoverProvider = new QmlTypeHoverProvider(qmlCppBridge, outputChannel);
    
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { scheme: 'file', pattern: '**/*.qml' },
            qmlDefProvider
        )
    );
    
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { scheme: 'file', pattern: '**/*.qml' },
            qmlBridgeCompProvider,
            '.', ':', ' '
        )
    );
    
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(
            { scheme: 'file', pattern: '**/*.{cpp,h,hpp}' },
            cppRefProvider
        )
    );
    
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { scheme: 'file', pattern: '**/*.qml' },
            qmlTypeHoverProvider
        )
    );
    
    // Re-index on save of C++ or QML files
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            const ext = path.extname(document.fileName).toLowerCase();
            if (ext === '.h' || ext === '.hpp' || ext === '.cpp' || ext === '.qml') {
                qmlCppBridge.invalidateCache();
            }
        })
    );
    
    // Manual rebuild command
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.rebuildQmlCppIndex', async () => {
            void vscode.window.showInformationMessage('Rebuilding QML-C++ index...');
            await qmlCppBridge.indexWorkspace();
            void vscode.window.showInformationMessage('QML-C++ index rebuilt');
        })
    );
    
    // Debugger integration
    const qtDebugger = new QtDebuggerIntegration(qtConfigManager, qtProjectDetector, outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.generateLaunchJson', async (uri?: vscode.Uri) => {
            await qtDebugger.generateLaunchConfig(uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.setupPrettyPrinters', async () => {
            await qtDebugger.setupPrettyPrinters();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.addSignalSlotBreakpoint', async () => {
            await qtDebugger.addSignalSlotBreakpoint();
        })
    );
    
    // Qt Test Framework integration
    const qtTestFramework = new QtTestFramework(qtConfigManager, qtProjectDetector, outputChannel);
    context.subscriptions.push(qtTestFramework);
    
    // Discover tests after a short delay
    setTimeout(() => {
        void qtTestFramework.discoverTests();
    }, 4000);
    
    // Re-discover tests on save of C++ files
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            const ext = path.extname(document.fileName).toLowerCase();
            if (ext === '.h' || ext === '.hpp' || ext === '.cpp') {
                qtTestFramework.invalidateCache();
            }
        })
    );
    
    // Translation integration
    const translationProvider = new QtTranslationProvider(qtConfigManager, outputChannel);
    context.subscriptions.push(translationProvider);
    
    const translationTree = vscode.window.registerTreeDataProvider('qt-translations', translationProvider);
    context.subscriptions.push(translationTree);
    
    // Register build analytics tree provider
    const analyticsProvider = new QtBuildAnalyticsProvider(buildAnalytics, buildTracker, outputChannel);
    context.subscriptions.push(analyticsProvider);
    const analyticsTree = vscode.window.registerTreeDataProvider('qt-build-analytics', analyticsProvider);
    context.subscriptions.push(analyticsTree);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.lupdate', async () => {
            await translationProvider.runLupdate();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.lrelease', async () => {
            await translationProvider.runLrelease();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.openInLinguist', async (uri?: vscode.Uri) => {
            await translationProvider.openInLinguist(uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.refreshTranslations', async () => {
            translationProvider.refresh();
        })
    );
    
    // Refresh translation diagnostics on .ts file save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.fileName.endsWith('.ts')) {
                translationProvider.refresh();
            }
        })
    );
    
    // Python Qt support
    const qtPythonSupport = new QtPythonSupport(outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.compileUiToPython', async (uri?: vscode.Uri) => {
            await qtPythonSupport.compileUiToPython(uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.compileRccToPython', async (uri?: vscode.Uri) => {
            await qtPythonSupport.compileRccToPython(uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.openPythonDesigner', async () => {
            await qtPythonSupport.openDesignerForPython();
        })
    );
    
    // Qt Code Generator (MOC/UIC/RCC)
    const qtCodeGenerator = new QtCodeGenerator(qtConfigManager, outputChannel);
    context.subscriptions.push(qtCodeGenerator);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.generateMoc', async (uri?: vscode.Uri) => {
            await qtCodeGenerator.runMoc(uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.generateUic', async (uri?: vscode.Uri) => {
            await qtCodeGenerator.runUic(uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.generateRcc', async (uri?: vscode.Uri) => {
            await qtCodeGenerator.runRcc(uri?.fsPath);
        })
    );
    
    // Qt Generated Code Navigation
    const qtNav = new QtGeneratedCodeNavigation(outputChannel);
    context.subscriptions.push(qtNav);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.goToGeneratedCode', async (uri?: vscode.Uri) => {
            await qtNav.goToGeneratedCode(uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.peekGeneratedCode', async (uri?: vscode.Uri) => {
            await qtNav.peekGeneratedCode(uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { scheme: 'file', pattern: '**/*.{h,hpp}' },
            qtNav.definitionProvider
        )
    );
    
    // Qt PCH Support
    const qtPch = new QtPchSupport(outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.generatePch', async () => {
            await qtPch.generatePch();
        })
    );
    
    // Qt Custom Build System
    const qtCustomBuild = new QtCustomBuildSystem(outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.generateCustomMakefile', async (uri?: vscode.Uri) => {
            await qtCustomBuild.generateMakefile(uri?.fsPath);
        })
    );
    
    // Qt PCH Build Integration
    const qtPchIntegration = new QtPchBuildIntegration(outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.integratePch', async () => {
            await qtPchIntegration.integratePch();
        })
    );
    
    // Qt Build Script Injector
    const qtBuildScriptInjector = new QtBuildScriptInjector(outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.injectBuildScripts', async (uri?: vscode.Uri) => {
            await qtBuildScriptInjector.injectBuildScripts(uri?.fsPath);
        })
    );
    
    // Qt PCH Compiler Config
    const qtPchCompilerConfig = new QtPchCompilerConfig(outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.configurePchCompiler', async () => {
            await qtPchCompilerConfig.configurePchCompiler();
        })
    );
    
    // Qt CI/CD Integration
    const qtCiCd = new QtCiCdIntegration(outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.setupCiCd', async () => {
            await qtCiCd.setupCiCd();
        })
    );
    
    // Qt Installer Framework
    const qtInstaller = new QtInstallerFramework(outputChannel);
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.generateInstallerConfig', async () => {
            await qtInstaller.generateInstallerConfig();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.buildInstaller', async () => {
            await qtInstaller.buildInstaller();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.cleanProject', async (uri?: vscode.Uri) => {
            await executeQtTask('clean', uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.rebuildProject', async (uri?: vscode.Uri) => {
            await executeQtTask('rebuild', uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.runProject', async (uri?: vscode.Uri) => {
            await executeQtTask('run', uri?.fsPath);
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
    
    // Qt Designer commands
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.openInDesigner', async (uri?: vscode.Uri) => {
            await qtDesigner.openInDesigner(uri?.fsPath);
        })
    );
    
    // QRC commands
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.validateQrc', async (uri?: vscode.Uri) => {
            await qrcSupport.validateQrc(uri?.fsPath);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.runRcc', async (uri?: vscode.Uri) => {
            await qrcSupport.runRcc(uri?.fsPath);
        })
    );
    
    // Deployment commands
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.deploy', async () => {
            await qtDeployment.deployApplication();
        })
    );
    
    // IntelliSense commands
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.configureIntelliSense', async () => {
            await intelliSenseHelper.configureIntelliSense();
        })
    );
    
    // Build configuration selector
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.selectBuildConfig', async (projectFile?: string) => {
            await selectBuildConfig(projectFile);
        })
    );
    
    // Qt Creator import
    const qtCreatorImporter = new QtCreatorImporter(outputChannel);
    context.subscriptions.push(
        vscode.commands.registerCommand('qt.importQtCreator', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                void vscode.window.showErrorMessage('No workspace folder open');
                return;
            }
            const projects = await qtProjectDetector.detectProjects(workspaceFolder.uri.fsPath);
            if (projects.length === 0) {
                void vscode.window.showErrorMessage('No Qt project found');
                return;
            }
            let targetFile = projects[0];
            if (projects.length > 1) {
                const selected = await vscode.window.showQuickPick(
                    projects.map(p => ({ label: path.basename(p), description: p, value: p })),
                    { placeHolder: 'Select project to import Qt Creator settings for' }
                );
                if (!selected) { return; }
                targetFile = selected.value;
            }
            await qtCreatorImporter.showImportResults(targetFile);
        })
    );
    
    // Auto-detect Qt on activation
    void qtConfigManager.detectQtInstallation();
    
    outputChannel.appendLine('Qt C++ Tools extension initialized successfully');
}

async function executeQtTask(taskType: 'build' | 'clean' | 'rebuild' | 'run', specificProject?: string, quickBuild: boolean = false): Promise<void> {
    let projectFile: string | undefined = specificProject;
    
    if (!projectFile) {
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
    }
    
    if (!projectFile) {
        return;
    }
    
    // Create and execute task
    const taskDef: vscode.TaskDefinition = {
        type: 'qt',
        task: taskType,
        file: projectFile,
        quickBuild: quickBuild
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
    
    const showSource = vscode.workspace.getConfiguration('qt').get<boolean>('showQtSource') ?? true;
    
    const items = qtVersions.map(qt => ({
        label: showSource && qt.source
            ? `${qt.version || 'Unknown'} [${sourceDisplayName(qt.source)}]`
            : (qt.version || 'Unknown'),
        description: qt.path,
        detail: `qmake: ${qt.qmakePath}`
    }));
    
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select Qt version to use'
    });
    
    if (selected) {
        const config = vscode.workspace.getConfiguration('qt');
        await config.update('qmakePath', selected.detail.replace('qmake: ', ''), vscode.ConfigurationTarget.Workspace);
        const labelClean = selected.label.replace(/\s*\[.*?\]\s*$/, '');
        void vscode.window.showInformationMessage(`Using Qt version: ${labelClean}`);
        outputChannel.appendLine(`Selected Qt version: ${selected.label} at ${selected.description}`);
    }
}

async function showInstallQtInstructions(): Promise<void> {
    const platform = process.platform;
    
    interface InstallOption {
        label: string;
        description: string;
        command: string;
        platforms: string[];
    }
    
    const options: InstallOption[] = [
        {
            label: 'Official Qt Installer',
            description: 'Download from qt.io (all platforms)',
            command: 'Visit https://www.qt.io/download-qt-installer',
            platforms: ['win32', 'darwin', 'linux']
        },
        {
            label: 'Homebrew',
            description: 'macOS / Linux package manager',
            command: 'brew install qt@6',
            platforms: ['darwin', 'linux']
        },
        {
            label: 'APT (Debian/Ubuntu)',
            description: 'Linux package manager',
            command: 'sudo apt update && sudo apt install qtbase5-dev qttools5-dev',
            platforms: ['linux']
        },
        {
            label: 'Pacman (Arch/Manjaro)',
            description: 'Linux package manager',
            command: 'sudo pacman -S qt6-base qt6-tools',
            platforms: ['linux']
        },
        {
            label: 'vcpkg',
            description: 'Cross-platform C++ package manager',
            command: 'vcpkg install qtbase',
            platforms: ['win32', 'darwin', 'linux']
        },
        {
            label: 'Conan',
            description: 'Cross-platform C++ package manager',
            command: 'conan install --requires=qt/6.7.0',
            platforms: ['win32', 'darwin', 'linux']
        },
        {
            label: 'aqtinstall',
            description: 'Unofficial Qt installer (CLI, headless-friendly)',
            command: 'pip install aqtinstall && aqt install-qt linux desktop 6.7.0',
            platforms: ['win32', 'darwin', 'linux']
        }
    ];
    
    const filtered = options.filter(o => o.platforms.includes(platform));
    
    const selected = await vscode.window.showQuickPick(
        filtered.map(o => ({ label: o.label, description: o.description, command: o.command })),
        { placeHolder: 'Select how to install Qt' }
    );
    
    if (selected) {
        void vscode.window.showInformationMessage(
            `Install command: ${selected.command}`,
            'Copy to Clipboard'
        ).then(choice => {
            if (choice === 'Copy to Clipboard') {
                void vscode.env.clipboard.writeText(selected.command);
                void vscode.window.showInformationMessage('Command copied to clipboard');
            }
        });
        outputChannel.appendLine(`User selected Qt install method: ${selected.label}`);
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

async function selectBuildConfig(projectFile?: string): Promise<void> {
    if (!projectFile) {
        void vscode.window.showErrorMessage('No project selected');
        return;
    }
    
    const currentType = qtConfigManager.getProjectBuildType(projectFile);
    const selected = await vscode.window.showQuickPick(
        [
            { label: 'Debug', description: 'Build with debug symbols and no optimization', value: 'debug' },
            { label: 'Release', description: 'Build with optimizations, no debug symbols', value: 'release' }
        ],
        { placeHolder: `Select build configuration (current: ${currentType})` }
    );
    
    if (selected) {
        await qtConfigManager.setProjectBuildType(projectFile, selected.value);
        void vscode.window.showInformationMessage(
            `Build configuration set to ${selected.label} for ${path.basename(projectFile)}`
        );
        outputChannel.appendLine(`Build config for ${projectFile}: ${selected.value}`);
        // Refresh tree to show updated config
        await treeProvider.refresh();
    }
}

export function deactivate(): void {
    if (taskProvider) {
        taskProvider.dispose();
    }
}

// Info message helper for code actions
vscode.commands.registerCommand('qt.showInfoMessage', (message: string) => {
    void vscode.window.showInformationMessage(message);
});
