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
    workspace: { getConfiguration: () => ({ get: key => settings[key] }) },
    tasks: { onDidStartTask: start.event, onDidEndTask: end.event, onDidEndTaskProcess: processEnd.event },
    CustomExecution: class { constructor(callback) { this.callback = callback; } },
    ShellExecution: class { constructor(command) { this.command = command; } },
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
