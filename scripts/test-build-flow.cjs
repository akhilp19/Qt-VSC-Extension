// Run after npm run compile: node --test scripts/test-build-flow.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
class EventEmitter {
    listeners = new Set();
    event = listener => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    };
    fire = value => { for (const listener of this.listeners) { listener(value); } };
    dispose() { this.listeners.clear(); }
}
const start = new EventEmitter(), end = new EventEmitter(), processEnd = new EventEmitter();
let settings = {};
const vscode = {
    EventEmitter,
    ConfigurationTarget: { Workspace: 2 },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback,
        update: async (key, value) => { settings[key] = value; } }),
        isTrusted: true, saveAll: async () => true,
        getWorkspaceFolder: () => ({ uri: { fsPath: '/project' } }) },
    Uri: { file: fsPath => ({ fsPath }) },
    window: { showInformationMessage: async () => undefined, showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined },
    extensions: { getExtension: () => ({ extensionPath: '/extension' }) },
    debug: { startDebugging: async () => true },
    tasks: { onDidStartTask: start.event, onDidEndTask: end.event, onDidEndTaskProcess: processEnd.event },
    CustomExecution: class { constructor(callback) { this.callback = callback; } },
    ShellExecution: class { constructor(command, options) { Object.assign(this, { command, options }); } },
    Task: class { constructor(definition, scope, name, source, execution) { Object.assign(this, { definition, scope, name, source, execution }); } },
    TaskGroup: { Build: 'build' }, TaskRevealKind: { Always: 1 }, TaskPanelKind: { Dedicated: 1 }
};
const originalLoad = Module._load;
Module._load = function (name, ...args) {
    return name === 'vscode' ? vscode : originalLoad.call(this, name, ...args);
};
const { QtTaskProvider } = require('../out/qtTaskProvider');
const { QtBuildTracker } = require('../out/qtBuildTracker');
const { QtBuildPseudoterminal, buildExitCodes } = require('../out/qtBuildTerminal');
const platform = require('../out/platformUtils');
const { QtWorkflow } = require('../out/qtWorkflow');
const { QtProjectDetector } = require('../out/qtProjectDetector');
const { QtBuildKitManager } = require('../out/qtBuildKit');
const { QtPythonSupport } = require('../out/qtPythonSupport');
const { QtDebuggerIntegration } = require('../out/qtDebugger');
const { generateCMakeProject, generateQMakeProject, writeProjectFiles } = require('../out/projectTemplates');
Module._load = originalLoad;
const output = { appendLine() {} };
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-build-flow-'));
    const buildDir = path.join(root, 'build');
    const manager = {
        getQtInstallation: async () => undefined, getProjectBuildType: () => 'debug',
        getBuildDirectory: () => buildDir, getMakeCommand: () => 'make', getParallelJobs: () => 2
    };
    return { root, buildDir, file: path.join(root, 'CMakeLists.txt'), folder: { uri: { fsPath: root } },
        provider: new QtTaskProvider(manager, {}, output) };
}
async function runTask(task) {
    const terminal = await task.execution.callback();
    const code = await new Promise(resolve => { terminal.onDidClose(resolve); terminal.open(); });
    buildExitCodes.delete(task.definition.buildId);
    return code;
}
test('tracker reports shell failures, cancellation, custom results and overlapping executions', () => {
    const tracker = new QtBuildTracker(output);
    const task = { definition: { type: 'qt', file: '/project', task: 'build' } };
    const first = { task }, second = { task };
    start.fire({ execution: first }); start.fire({ execution: second });
    processEnd.fire({ execution: first, exitCode: 7 }); end.fire({ execution: first });
    assert.equal(tracker.getBuildHistory('/project')[0].success, false);
    assert.equal(tracker.isBuilding('/project'), true);
    processEnd.fire({ execution: second, exitCode: 0 }); end.fire({ execution: second });
    assert.equal(tracker.getBuildHistory('/project').filter(r => r.success).length, 1);
    const cancelled = { task }; start.fire({ execution: cancelled }); end.fire({ execution: cancelled });
    assert.equal(tracker.getBuildHistory('/project').filter(r => !r.success).length, 2);
    const custom = { task: { definition: { ...task.definition, buildId: 'custom' } } };
    start.fire({ execution: custom }); buildExitCodes.set('custom', 0); end.fire({ execution: custom });
    assert.equal(buildExitCodes.has('custom'), false);
    assert.equal(tracker.getBuildHistory('/project').filter(r => r.success).length, 2);
    tracker.dispose(); assert.equal(start.listeners.size, 0); assert.equal(end.listeners.size, 0);
});
test('quick build has a distinct identity and configures an empty directory', async () => {
    settings = {}; const f = fixture(); fs.mkdirSync(f.buildDir);
    const quick = await f.provider.createBuildTask(f.file, 'cmake', f.folder, true);
    assert.equal(quick.definition.quickBuild, true);
    assert.match((await quick.execution.callback()).command, /cmake -B/);
    fs.writeFileSync(path.join(f.buildDir, 'CMakeCache.txt'), '');
    const cached = await f.provider.createBuildTask(f.file, 'cmake', f.folder, true);
    assert.doesNotMatch((await cached.execution.callback()).command, /cmake -B/);
});
test('fresh QMake rebuild configures before cleaning', async () => {
    settings = {}; const f = fixture();
    const task = await f.provider.createRebuildTask(path.join(f.root, 'app.pro'), 'qmake', f.folder);
    const { command } = await task.execution.callback();
    assert.ok(command.indexOf("'qmake'") < command.indexOf('make clean'));
});
test('real CMake normal, quick, rebuild, clean and selected preset build use one directory', async () => {
    const f = fixture(); settings = { cmakePresets: { [f.file]: { configure: 'configure', build: 'selected' } } };
    fs.writeFileSync(f.file, 'cmake_minimum_required(VERSION 3.20)\nproject(Check NONE)\nadd_custom_target(selected COMMAND "${CMAKE_COMMAND}" -E touch "${CMAKE_BINARY_DIR}/selected.txt")\n');
    fs.writeFileSync(path.join(f.root, 'CMakePresets.json'), JSON.stringify({ version: 3,
        configurePresets: [{ name: 'configure', generator: 'Unix Makefiles', binaryDir: '${sourceDir}/other' }],
        buildPresets: [{ name: 'selected', configurePreset: 'configure', targets: ['selected'] }] }));
    for (const quick of [false, true]) {
        const task = await f.provider.createBuildTask(f.file, 'cmake', f.folder, quick);
        assert.equal(await runTask(task), 0);
        assert.ok(fs.existsSync(path.join(f.buildDir, 'selected.txt')));
    }
    const rebuild = await f.provider.createRebuildTask(f.file, 'cmake', f.folder);
    assert.equal(await runTask(rebuild), 0);
    assert.equal(fs.existsSync(path.join(f.root, 'other')), false);
    const clean = await f.provider.createCleanTask(f.file, 'cmake', f.folder);
    assert.match(clean.execution.command, new RegExp(f.buildDir));
    settings = {};
    const fresh = fixture(); fs.writeFileSync(fresh.file, fs.readFileSync(f.file));
    assert.equal(await runTask(await fresh.provider.createRebuildTask(fresh.file, 'cmake', fresh.folder)), 0);
});
test('a failing build command stops subsequent hooks and reports its exit code', async () => {
    const f = fixture(); const marker = path.join(f.root, 'should-not-exist');
    const terminal = new QtBuildPseudoterminal(platform.joinCmds('exit 7', `touch ${platform.quotePath(marker)}`), f.root, {}, path.join(f.buildDir, 'log'), output, 'failure');
    const code = await new Promise(resolve => { terminal.onDidClose(resolve); terminal.open(); });
    assert.equal(code, 7); assert.equal(buildExitCodes.get('failure'), 7);
    assert.equal(fs.existsSync(marker), false); buildExitCodes.delete('failure');
});
test('Windows command chains guard failures and missing directories', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    try {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const command = platform.joinCmds('cmake configure', 'cmake build', 'post-build');
        assert.equal((command.match(/if \(-not \$\?\)/g) || []).length, 3);
        assert.equal((command.match(/if \(\$LASTEXITCODE -ne 0\)/g) || []).length, 3);
        assert.match(platform.rmDirCmd('missing'), /^if \(Test-Path/);
    } finally { Object.defineProperty(process, 'platform', descriptor); }
});
test('run resolves the executable from the build directory and fails when it is missing', async () => {
    settings = {}; const f = fixture();
    f.provider.qtProjectDetector = { findExecutable: async (file, dir) => {
        assert.equal(file, f.file); assert.equal(dir, f.buildDir); return undefined;
    } };
    const task = await f.provider.createRunTask(f.file, 'cmake', f.folder);
    assert.match(task.execution.command, /exit 1/);
});
test('executable lookup supports Unix, configuration directories and macOS bundles', async () => {
    const f = fixture();
    fs.mkdirSync(f.buildDir);
    fs.writeFileSync(f.file, 'find_package(Qt6 REQUIRED COMPONENTS Core)\nqt_add_executable(app main.cpp)');
    const detector = Object.create(QtProjectDetector.prototype);
    detector.getProjectInfo = async () => ({ type: 'qmake', name: 'app' });
    detector.parseQMakeProject = async () => ({ target: 'app' });
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const release = path.join(f.buildDir, 'Release', 'app' + suffix);
    fs.mkdirSync(path.dirname(release)); fs.writeFileSync(release, '');
    assert.equal(await detector.findExecutable(f.file, f.buildDir, 'release'), release);
    fs.mkdirSync(path.join(f.buildDir, 'Debug'));
    const debug = path.join(f.buildDir, 'Debug', 'app' + suffix); fs.writeFileSync(debug, '');
    assert.equal(await detector.findExecutable(f.file, f.buildDir, 'debug'), debug);
    fs.unlinkSync(debug); fs.unlinkSync(release);
    const bundle = path.join(f.buildDir, 'app.app', 'Contents', 'MacOS', 'app');
    fs.mkdirSync(path.dirname(bundle), { recursive: true }); fs.writeFileSync(bundle, '');
    assert.equal(await detector.findExecutable(f.file, f.buildDir), bundle);
});
test('Run and Debug wait for successful builds; failures and cancellation prevent launch', async () => {
    settings = {};
    const tracker = new QtBuildTracker(output);
    const workflow = Object.create(QtWorkflow.prototype);
    workflow.busy = new Set(); workflow.tracker = tracker;
    workflow.selectProject = async () => '/project/app.pro';
    workflow.detector = { getProjectInfo: async () => ({ type: 'qmake' }) };
    workflow.config = { getProjectBuildType: () => 'debug' };
    workflow.kits = { getActiveKit: () => ({ name: 'desktop' }), getBuildDirForProject: () => '/project/build', getKitEnvVars: () => ({}) };
    const calls = [];
    workflow.tasks = { resolveTask: async task => task };
    workflow.debuggerIntegration = { startProject: async () => { calls.push('debug'); return true; } };
    let buildCode = 0;
    vscode.tasks.executeTask = async task => {
        calls.push(task.definition.task);
        const execution = { task }; start.fire({ execution });
        processEnd.fire({ execution, exitCode: task.definition.task === 'build' ? buildCode : 0 });
        end.fire({ execution }); // Deliberately finishes before executeTask resolves.
        return execution;
    };
    await workflow.execute('run'); assert.deepEqual(calls.splice(0), ['build', 'run']);
    await workflow.execute('debug'); assert.deepEqual(calls.splice(0), ['build', 'debug']);
    buildCode = 1;
    await workflow.execute('run'); assert.deepEqual(calls.splice(0), ['build']);
    buildCode = undefined;
    await workflow.execute('debug'); assert.deepEqual(calls.splice(0), ['build']);
    vscode.workspace.saveAll = async () => false;
    await workflow.execute('run'); assert.deepEqual(calls.splice(0), []);
    vscode.workspace.saveAll = async () => true;
    vscode.workspace.isTrusted = false;
    await workflow.execute('run'); assert.deepEqual(calls.splice(0), []);
    vscode.workspace.isTrusted = true;
    assert.equal(end.listeners.size, 1); // Only tracker remains, workflow listeners were disposed.
    tracker.dispose();
});
test('run settings preserve arguments with spaces, kit environment and working directory', async () => {
    const f = fixture(); const program = path.join(f.buildDir, 'app');
    fs.mkdirSync(f.buildDir); fs.writeFileSync(program, '');
    f.provider.qtProjectDetector = { findExecutable: async () => program };
    settings = { runSettings: { [f.file]: { args: ['hello world', '--flag'], env: { DEMO: 'yes' }, cwd: 'data' } } };
    const task = await f.provider.createRunTask(f.file, 'cmake', f.folder);
    assert.match(task.execution.command, /'hello world'/);
    assert.equal(task.execution.options.cwd, path.join(f.root, 'data'));
    assert.equal(task.execution.options.env.DEMO, 'yes');
    settings = {};
});
test('the selected kit supplies qmake, Qt CMake prefix and build directory', async () => {
    const f = fixture();
    settings = { buildKits: [{ name: 'selected', qtPath: '/kit Qt', qmakePath: '/kit Qt/bin/qmake',
        qtVersion: '6.8', compiler: 'clang', buildDirTemplate: '${workspaceFolder}/build-${kitName}-${buildType}' }],
        activeKit: { [f.file]: 'selected' } };
    const kits = new QtBuildKitManager({}, output);
    f.provider.qtBuildKitManager = kits;
    const cmake = await f.provider.createBuildTask(f.file, 'cmake', f.folder);
    assert.equal(cmake.definition.buildDir, '/project/build-selected-debug');
    const command = (await cmake.execution.callback()).command;
    assert.match(command, /-DCMAKE_PREFIX_PATH='\/kit Qt'/);
    assert.match(command, /--config Debug/);
    const qmake = await f.provider.createBuildTask(f.file, 'qmake', f.folder);
    assert.match((await qmake.execution.callback()).command, /'\/kit Qt\/bin\/qmake'/);
    settings = {};
});
test('Widgets templates include the window source and Designer form in both build systems', () => {
    const options = { projectName: 'Demo', projectType: 'widgets-app', modules: ['core', 'gui', 'widgets'], qtVersion: 'qt6', includeWindowClass: true };
    for (const generate of [generateQMakeProject, generateCMakeProject]) {
        const files = generate(options);
        assert.ok(files.some(f => f.fileName === 'demo.ui'));
        assert.ok(files.some(f => f.fileName === 'demo.cpp'));
        const buildFile = files.find(f => f.fileName.endsWith('.pro') || f.fileName === 'CMakeLists.txt');
        assert.match(buildFile.content, /demo\.cpp/);
        assert.match(buildFile.content, /demo\.ui/);
        assert.match(files.find(f => f.fileName === 'main.cpp').content, /Demo/);
    }
});
test('Python Qt submodule imports are discoverable and dismissed overwrite prompts preserve files', async () => {
    const f = fixture(); const file = path.join(f.root, 'main.py');
    fs.writeFileSync(file, 'from PySide6.QtWidgets import QApplication\n');
    const python = new QtPythonSupport(output);
    assert.ok(python.detectPythonQtProjects(f.root).includes(file));
    await writeProjectFiles(f.root, [{ fileName: 'main.py', content: 'overwrite' }], output);
    assert.match(fs.readFileSync(file, 'utf8'), /PySide6/);
});
test('debug sessions use the built executable, run settings, kit environment and GDB printers', async () => {
    settings = { debuggerType: 'gdb', runSettings: { '/project/app.pro': { args: ['space argument'], env: { USER_VALUE: 'yes' }, cwd: 'assets' } } };
    const debuggerIntegration = new QtDebuggerIntegration({ getQtInstallation: async () => undefined, getProjectBuildType: () => 'debug' },
        { getProjectInfo: async () => ({ name: 'app', type: 'qmake' }), findExecutable: async () => '/project/build/app' }, output);
    let launch;
    vscode.debug.startDebugging = async (_folder, config) => { launch = config; return true; };
    assert.equal(await debuggerIntegration.startProject('/project/app.pro', '/project/build', { compiler: 'gcc', envVars: { KIT_VALUE: 'yes' } }), true);
    assert.equal(launch.program, '/project/build/app');
    assert.deepEqual(launch.args, ['space argument']);
    assert.equal(launch.cwd, '/project/assets');
    assert.equal(launch.MIMode, 'gdb');
    assert.equal(launch.preLaunchTask, undefined);
    assert.ok(launch.environment.some(v => v.name === 'KIT_VALUE' && v.value === 'yes'));
    assert.ok(launch.setupCommands.some(v => v.text.includes('qt_pretty_printers.py')));
    settings = {};
});
test('run configuration wizard saves arguments and environment only on Save', async () => {
    settings = {};
    const workflow = Object.create(QtWorkflow.prototype);
    workflow.selectProject = async () => '/project/app.pro';
    const picks = [{ id: 'addArg' }, { id: 'setEnv' }, { id: 'cwd' }, { id: 'save' }];
    const inputs = ['an argument with spaces', 'DEMO', 'enabled', 'assets'];
    vscode.window.showQuickPick = async () => picks.shift();
    vscode.window.showInputBox = async () => inputs.shift();
    await workflow.configureRun();
    assert.deepEqual(settings.runSettings['/project/app.pro'], {
        args: ['an argument with spaces'], env: { DEMO: 'enabled' }, cwd: 'assets'
    });
    const before = JSON.stringify(settings);
    picks.push({ id: 'addArg' }, undefined); inputs.push('discarded argument');
    await workflow.configureRun();
    assert.equal(JSON.stringify(settings), before);
    settings = {};
});
test('Qt Quick templates embed QML so launching from a build directory or bundle works', () => {
    const options = { projectName: 'Demo', projectType: 'quick-app', modules: ['core', 'gui', 'qml', 'quick'], qtVersion: 'qt6', includeWindowClass: false };
    for (const generate of [generateQMakeProject, generateCMakeProject]) {
        const files = generate(options);
        assert.ok(files.some(f => f.fileName === 'qml.qrc'));
        assert.match(files.find(f => f.fileName === 'main.cpp').content, /qrc:\/main.qml/);
        const build = files.find(f => f.fileName.endsWith('.pro') || f.fileName === 'CMakeLists.txt');
        assert.match(build.content, /qml.qrc/);
        if (build.fileName === 'CMakeLists.txt') { assert.match(build.content, /Qt6::Qml/); }
    }
});
