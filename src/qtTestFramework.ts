import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';
import { isWindows, exe } from './platformUtils';

interface QtTestMethodInfo {
    name: string;
    line: number;
    kind: 'test' | 'initTestCase' | 'cleanupTestCase' | 'init' | 'cleanup';
}

interface QtTestClassInfo {
    className: string;
    filePath: string;
    line: number;
    methods: QtTestMethodInfo[];
    hasQTestMain: boolean;
}

interface QTestResult {
    className: string;
    methodName: string;
    status: 'pass' | 'fail' | 'skip';
    message?: string;
    filePath?: string;
    line?: number;
}

/**
 * Integrates Qt Test (QTest) with VS Code's native Test Explorer.
 */
export class QtTestFramework implements vscode.Disposable {
    private controller: vscode.TestController;
    private outputChannel: vscode.OutputChannel;
    private qtConfigManager: QtConfigManager;
    private qtProjectDetector: QtProjectDetector;
    private discoveredTests = new Map<string, QtTestClassInfo[]>();
    private debounceTimer?: NodeJS.Timeout;

    constructor(
        qtConfigManager: QtConfigManager,
        qtProjectDetector: QtProjectDetector,
        outputChannel: vscode.OutputChannel
    ) {
        this.qtConfigManager = qtConfigManager;
        this.qtProjectDetector = qtProjectDetector;
        this.outputChannel = outputChannel;

        this.controller = vscode.tests.createTestController('qtTestController', 'Qt Tests');

        // Run profile
        this.controller.createRunProfile(
            'Run',
            vscode.TestRunProfileKind.Run,
            (request, token) => this.runHandler(request, token),
            true
        );

        // Debug profile
        this.controller.createRunProfile(
            'Debug',
            vscode.TestRunProfileKind.Debug,
            (request, token) => this.runHandler(request, token, true),
            false
        );
    }

    /**
     * Scan the workspace for Qt test classes.
     */
    async discoverTests(): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');
        if (config.get<boolean>('testAutoDiscover') === false) {
            return;
        }

        this.outputChannel.appendLine('[Qt Test] Discovering tests...');
        this.controller.items.replace([]);
        this.discoveredTests.clear();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        const excludePatterns = ['**/build/**', '**/out/**', '**/.git/**', '**/node_modules/**'];

        for (const folder of workspaceFolders) {
            await this.scanFolder(folder.uri.fsPath, excludePatterns);
        }

        // Build TestItem tree
        let totalClasses = 0;
        let totalMethods = 0;

        for (const [filePath, classes] of this.discoveredTests) {
            for (const testClass of classes) {
                totalClasses++;
                const classId = `${filePath}::${testClass.className}`;
                const classItem = this.controller.createTestItem(
                    classId,
                    testClass.className,
                    vscode.Uri.file(filePath)
                );
                classItem.range = new vscode.Range(testClass.line, 0, testClass.line, 0);

                for (const method of testClass.methods) {
                    totalMethods++;
                    const methodId = `${classId}::${method.name}`;
                    const methodItem = this.controller.createTestItem(
                        methodId,
                        method.name,
                        vscode.Uri.file(filePath)
                    );
                    methodItem.range = new vscode.Range(method.line, 0, method.line, 0);
                    classItem.children.add(methodItem);
                }

                this.controller.items.add(classItem);
            }
        }

        this.outputChannel.appendLine(`[Qt Test] Discovered ${totalClasses} class(es), ${totalMethods} method(s)`);
    }

    /**
     * Trigger re-discovery (debounced).
     */
    invalidateCache(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            void this.discoverTests();
        }, 2000);
    }

    dispose(): void {
        this.controller.dispose();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
    }

    // -----------------------------------------------------------------------
    // Private: Discovery scanning
    // -----------------------------------------------------------------------

    private async scanFolder(folderPath: string, excludePatterns: string[]): Promise<void> {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry.name);

            if (entry.isDirectory()) {
                const shouldExclude = excludePatterns.some(pattern => {
                    const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
                    return regex.test(fullPath);
                });
                if (!shouldExclude) {
                    await this.scanFolder(fullPath, excludePatterns);
                }
                continue;
            }

            if (!entry.isFile()) { continue; }

            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.h' || ext === '.hpp' || ext === '.cpp') {
                this.scanCppFile(fullPath);
            }
        }
    }

    private scanCppFile(filePath: string): void {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            const classes: QtTestClassInfo[] = [];
            let inClass = false;
            let braceDepth = 0;
            let classStartLine = -1;
            let currentClass: QtTestClassInfo | undefined;
            let inSlots = false;
            let hasQObject = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Detect class declaration with QObject base
                const classMatch = trimmed.match(/class\s+(\w+)\s*:\s*(?:public|protected|private)\s+(?:QObject|Q[A-Z]\w+)/);
                if (classMatch && !inClass) {
                    inClass = true;
                    braceDepth = 0;
                    classStartLine = i;
                    hasQObject = false;
                    currentClass = {
                        className: classMatch[1],
                        filePath,
                        line: i,
                        methods: [],
                        hasQTestMain: false
                    };
                    continue;
                }

                if (!inClass || !currentClass) { continue; }

                // Track braces
                for (const ch of line) {
                    if (ch === '{') { braceDepth++; }
                    else if (ch === '}') { braceDepth--; }
                }

                // Q_OBJECT macro
                if (/\bQ_OBJECT\b/.test(trimmed)) {
                    hasQObject = true;
                }

                // Detect slots section
                if (/private\s+(?:Q_)?slots\s*:/.test(trimmed) || /(?:Q_)?SLOTS\s*:/.test(trimmed)) {
                    inSlots = true;
                }

                // End of slots section (another access specifier or end of class)
                if (inSlots && (/^\s*(public|protected|private)\s*:/.test(line) || braceDepth <= 0)) {
                    inSlots = false;
                }

                // Detect test methods inside slots
                if (inSlots && hasQObject) {
                    const methodMatch = trimmed.match(/void\s+(test_\w+|initTestCase|cleanupTestCase|init|cleanup)\s*\(/);
                    if (methodMatch) {
                        const name = methodMatch[1];
                        const kind: QtTestMethodInfo['kind'] =
                            name === 'initTestCase' ? 'initTestCase' :
                            name === 'cleanupTestCase' ? 'cleanupTestCase' :
                            name === 'init' ? 'init' :
                            name === 'cleanup' ? 'cleanup' : 'test';
                        currentClass.methods.push({ name, line: i, kind });
                    }
                }

                // Class ended
                if (braceDepth <= 0 && i > classStartLine) {
                    if (hasQObject && currentClass.methods.length > 0) {
                        classes.push(currentClass);
                    }
                    inClass = false;
                    currentClass = undefined;
                    inSlots = false;
                    hasQObject = false;
                }
            }

            // Also scan for QTEST_MAIN in this file
            for (let i = 0; i < lines.length; i++) {
                const qtestMainMatch = lines[i].match(/QTEST_(APPLESS_)?MAIN\s*\(\s*(\w+)\s*\)/);
                if (qtestMainMatch) {
                    const className = qtestMainMatch[2];
                    const cls = classes.find(c => c.className === className);
                    if (cls) {
                        cls.hasQTestMain = true;
                    }
                }
            }

            if (classes.length > 0) {
                this.discoveredTests.set(filePath, classes);
            }
        } catch (error) {
            // Ignore unreadable files
        }
    }

    // -----------------------------------------------------------------------
    // Private: Test execution
    // -----------------------------------------------------------------------

    private async runHandler(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken,
        debug: boolean = false
    ): Promise<void> {
        const run = this.controller.createTestRun(request);
        const startTime = Date.now();

        try {
            // Find executable
            const executable = await this.findTestExecutable();
            if (!executable) {
                run.appendOutput('No test executable found. Build the project first.\n');
                run.end();
                return;
            }

            if (!fs.existsSync(executable)) {
                run.appendOutput(`Test executable not found: ${executable}\n`);
                run.appendOutput('Build the project first.\n');
                run.end();
                return;
            }

            // Determine which tests to run
            const testsToRun = this.resolveTestsToRun(request);

            // Mark all included tests as enqueued
            for (const test of testsToRun) {
                run.enqueued(test);
            }

            if (testsToRun.length === 0) {
                run.appendOutput('No tests selected.\n');
                run.end();
                return;
            }

            // Group by class for efficient execution
            const classGroups = new Map<string, vscode.TestItem[]>();
            for (const test of testsToRun) {
                const parent = test.parent;
                if (!parent) { continue; }
                const existing = classGroups.get(parent.id) || [];
                existing.push(test);
                classGroups.set(parent.id, existing);
            }

            // Run each group
            for (const [classId, methods] of classGroups) {
                if (token.isCancellationRequested) { break; }

                const classItem = this.controller.items.get(classId);
                if (!classItem) { continue; }

                const className = classItem.label;
                const isFullClass = methods.length === classItem.children.size;

                let args: string[];
                if (isFullClass) {
                    args = [className];
                } else {
                    // Run specific methods
                    const methodNames = methods.map(m => `${className}::${m.label}`);
                    args = methodNames;
                }

                // Mark as started
                run.started(classItem);
                for (const method of methods) {
                    run.started(method);
                }

                const result = await this.executeTest(executable, args, run, token, debug);

                // If we ran the full class, update all children based on parsed results
                if (isFullClass && result) {
                    this.applyResultsToChildren(classItem, result, run);
                }

                run.passed(classItem);
            }

            const elapsed = Date.now() - startTime;
            run.appendOutput(`\nTest run completed in ${elapsed}ms\n`);
        } catch (error) {
            run.appendOutput(`Test run error: ${String(error)}\n`);
        } finally {
            run.end();
        }
    }

    private resolveTestsToRun(request: vscode.TestRunRequest): vscode.TestItem[] {
        const result: vscode.TestItem[] = [];

        if (request.include && request.include.length > 0) {
            for (const item of request.include) {
                this.collectLeafTests(item, result);
            }
        } else {
            // Run all tests
            this.controller.items.forEach(item => {
                this.collectLeafTests(item, result);
            });
        }

        return result;
    }

    private collectLeafTests(item: vscode.TestItem, result: vscode.TestItem[]): void {
        if (item.children.size === 0) {
            result.push(item);
        } else {
            item.children.forEach(child => this.collectLeafTests(child, result));
        }
    }

    private async executeTest(
        executable: string,
        args: string[],
        run: vscode.TestRun,
        token: vscode.CancellationToken,
        debug: boolean
    ): Promise<QTestResult[] | undefined> {
        return new Promise((resolve) => {
            const results: QTestResult[] = [];

            run.appendOutput(`> ${executable} ${args.join(' ')}\n`);

            if (debug) {
                // For debug, launch via VS Code debug API
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (folder) {
                    const debugConfig = {
                        name: 'Debug Qt Test',
                        type: isWindows() ? 'cppvsdbg' : 'cppdbg',
                        request: 'launch',
                        program: executable,
                        args,
                        cwd: '${workspaceFolder}',
                        stopAtEntry: false
                    };
                    if (!isWindows()) {
                        (debugConfig as Record<string, unknown>).miMode = 'gdb';
                    }
                    void vscode.debug.startDebugging(folder, debugConfig);
                }
                resolve(undefined);
                return;
            }

            const child = spawn(executable, args, {
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                env: { ...process.env }
            });

            let buffer = '';

            child.stdout?.on('data', (data: Buffer) => {
                const text = data.toString('utf-8');
                buffer += text;
                run.appendOutput(text);

                // Parse complete lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const result = this.parseTestOutput(line);
                    if (result) {
                        results.push(result);
                    }
                }
            });

            child.stderr?.on('data', (data: Buffer) => {
                run.appendOutput(data.toString('utf-8'));
            });

            child.on('close', (code) => {
                // Parse any remaining buffer
                if (buffer) {
                    const result = this.parseTestOutput(buffer);
                    if (result) { results.push(result); }
                }
                run.appendOutput(`\nProcess exited with code ${code ?? 'unknown'}\n`);
                resolve(results);
            });

            token.onCancellationRequested(() => {
                child.kill();
                run.appendOutput('\nTest run cancelled.\n');
                resolve(results);
            });
        });
    }

    private parseTestOutput(line: string): QTestResult | undefined {
        const trimmed = line.trim();

        // PASS   : ClassName::methodName()
        const passMatch = trimmed.match(/^PASS\s+:\s+(\w+)::(\w+)\s*\(\)/);
        if (passMatch) {
            return { className: passMatch[1], methodName: passMatch[2], status: 'pass' };
        }

        // FAIL!  : ClassName::methodName() message (file.cpp:42)
        const failMatch = trimmed.match(/^FAIL!\s+:\s+(\w+)::(\w+)\s*\(\)\s*(.+?)\s*\(([^:]+):(\d+)\)/);
        if (failMatch) {
            return {
                className: failMatch[1],
                methodName: failMatch[2],
                status: 'fail',
                message: failMatch[3].trim(),
                filePath: failMatch[4],
                line: parseInt(failMatch[5], 10) - 1
            };
        }

        // FAIL without file/line
        const failSimpleMatch = trimmed.match(/^FAIL!\s+:\s+(\w+)::(\w+)\s*\(\)\s*(.*)/);
        if (failSimpleMatch) {
            return {
                className: failSimpleMatch[1],
                methodName: failSimpleMatch[2],
                status: 'fail',
                message: failSimpleMatch[3].trim()
            };
        }

        // SKIP   : ClassName::methodName() message
        const skipMatch = trimmed.match(/^SKIP\s+:\s+(\w+)::(\w+)\s*\(\)\s*(.*)/);
        if (skipMatch) {
            return {
                className: skipMatch[1],
                methodName: skipMatch[2],
                status: 'skip',
                message: skipMatch[3].trim()
            };
        }

        return undefined;
    }

    private applyResultsToChildren(
        classItem: vscode.TestItem,
        results: QTestResult[],
        run: vscode.TestRun
    ): void {
        const resultMap = new Map<string, QTestResult>();
        for (const r of results) {
            resultMap.set(r.methodName, r);
        }

        classItem.children.forEach(methodItem => {
            const result = resultMap.get(methodItem.label);
            if (!result) {
                // No result parsed — assume passed if parent passed
                run.passed(methodItem);
                return;
            }

            if (result.status === 'pass') {
                run.passed(methodItem);
            } else if (result.status === 'skip') {
                run.skipped(methodItem);
            } else if (result.status === 'fail') {
                const message = vscode.TestMessage.diff(
                    result.message || 'Test failed',
                    'Expected',
                    'Actual'
                );
                if (result.filePath && result.line !== undefined) {
                    message.location = new vscode.Location(
                        vscode.Uri.file(result.filePath),
                        new vscode.Position(result.line, 0)
                    );
                }
                run.failed(methodItem, message);
            }
        });
    }

    // -----------------------------------------------------------------------
    // Private: Executable discovery
    // -----------------------------------------------------------------------

    private async findTestExecutable(): Promise<string | undefined> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return undefined; }

        const projects = await this.qtProjectDetector.detectProjects(workspaceFolder.uri.fsPath);
        if (projects.length === 0) { return undefined; }

        const projectFile = projects[0];
        const projectName = path.basename(projectFile, path.extname(projectFile));
        const buildDir = this.qtConfigManager.getBuildDirectory();

        // Try various naming conventions for test executables
        const candidates: string[] = [];

        if (isWindows()) {
            candidates.push(
                path.join(buildDir, `${projectName}${exe('')}`),
                path.join(buildDir, 'Debug', `${projectName}${exe('')}`),
                path.join(buildDir, 'Release', `${projectName}${exe('')}`),
                path.join(buildDir, 'debug', `${projectName}${exe('')}`),
                path.join(buildDir, 'release', `${projectName}${exe('')}`),
                path.join(buildDir, `test${projectName}${exe('')}`),
                path.join(buildDir, `${projectName}_test${exe('')}`)
            );
        } else {
            candidates.push(
                path.join(buildDir, projectName),
                path.join(buildDir, 'Debug', projectName),
                path.join(buildDir, 'Release', projectName),
                path.join(buildDir, 'debug', projectName),
                path.join(buildDir, 'release', projectName),
                path.join(buildDir, `test${projectName}`),
                path.join(buildDir, `${projectName}_test`)
            );
        }

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        // Return most likely even if not built yet
        return candidates[0];
    }
}
