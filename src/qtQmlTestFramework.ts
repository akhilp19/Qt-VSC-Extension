import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { QtConfigManager } from './qtConfigManager';

interface QmlTestCaseInfo {
    name: string;
    filePath: string;
    line: number;
    testFunctions: { name: string; line: number }[];
}

interface QmlTestResult {
    testName: string;
    status: 'pass' | 'fail' | 'skip' | 'xpass' | 'xfail';
    message?: string;
}

/**
 * Discovers and runs QML TestCase tests via qmltestrunner.
 * Integrates with VS Code's native Test Explorer.
 */
export class QtQmlTestFramework implements vscode.Disposable {
    private controller: vscode.TestController;
    private outputChannel: vscode.OutputChannel;
    private qtConfigManager: QtConfigManager;
    private discoveredTests = new Map<string, QmlTestCaseInfo[]>();
    private debounceTimer?: NodeJS.Timeout;

    constructor(qtConfigManager: QtConfigManager, outputChannel: vscode.OutputChannel) {
        this.qtConfigManager = qtConfigManager;
        this.outputChannel = outputChannel;
        this.controller = vscode.tests.createTestController('qtQmlTestController', 'Qt QML Tests');

        this.controller.createRunProfile(
            'Run',
            vscode.TestRunProfileKind.Run,
            (request, token) => this.runHandler(request, token),
            true
        );
    }

    async discoverTests(): Promise<void> {
        this.outputChannel.appendLine('[Qt QML Test] Discovering QML tests...');
        this.controller.items.replace([]);
        this.discoveredTests.clear();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) { return; }

        const excludePatterns = ['**/build/**', '**/out/**', '**/.git/**', '**/node_modules/**'];

        for (const folder of workspaceFolders) {
            await this.scanFolder(folder.uri.fsPath, excludePatterns);
        }

        let totalCases = 0;
        let totalFunctions = 0;

        for (const [filePath, cases] of this.discoveredTests) {
            for (const testCase of cases) {
                totalCases++;
                const caseId = `${filePath}::${testCase.name}`;
                const caseItem = this.controller.createTestItem(
                    caseId,
                    testCase.name,
                    vscode.Uri.file(filePath)
                );
                caseItem.range = new vscode.Range(testCase.line, 0, testCase.line, 0);

                for (const fn of testCase.testFunctions) {
                    totalFunctions++;
                    const fnId = `${caseId}::${fn.name}`;
                    const fnItem = this.controller.createTestItem(
                        fnId,
                        fn.name,
                        vscode.Uri.file(filePath)
                    );
                    fnItem.range = new vscode.Range(fn.line, 0, fn.line, 0);
                    caseItem.children.add(fnItem);
                }

                this.controller.items.add(caseItem);
            }
        }

        this.outputChannel.appendLine(`[Qt QML Test] Discovered ${totalCases} TestCase(s), ${totalFunctions} function(s)`);
    }

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

            if (entry.isFile() && entry.name.endsWith('.qml')) {
                this.scanQmlFile(fullPath);
            }
        }
    }

    private scanQmlFile(filePath: string): void {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            const cases: QmlTestCaseInfo[] = [];
            let currentCase: QmlTestCaseInfo | undefined;
            let braceDepth = 0;
            let caseStartDepth = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Track braces
                const openBraces = (line.match(/\{/g) || []).length;
                const closeBraces = (line.match(/\}/g) || []).length;

                // Detect TestCase { ... }
                const testCaseMatch = trimmed.match(/^TestCase\s*\{/);
                if (testCaseMatch && !currentCase) {
                    currentCase = {
                        name: '',
                        filePath,
                        line: i,
                        testFunctions: []
                    };
                    caseStartDepth = braceDepth;
                    braceDepth += openBraces - closeBraces;
                    continue;
                }

                if (currentCase) {
                    braceDepth += openBraces - closeBraces;

                    // Extract name: "TestName" property
                    const nameMatch = trimmed.match(/^name\s*:\s*["']([^"']+)["']/);
                    if (nameMatch && !currentCase.name) {
                        currentCase.name = nameMatch[1];
                    }

                    // Extract test functions: function test_xyz()
                    const fnMatch = trimmed.match(/^function\s+(test_\w+)\s*\(/);
                    if (fnMatch) {
                        currentCase.testFunctions.push({ name: fnMatch[1], line: i });
                    }

                    // End of TestCase
                    if (braceDepth <= caseStartDepth) {
                        if (currentCase.name && currentCase.testFunctions.length > 0) {
                            cases.push(currentCase);
                        }
                        currentCase = undefined;
                    }
                } else {
                    braceDepth += openBraces - closeBraces;
                }
            }

            if (cases.length > 0) {
                this.discoveredTests.set(filePath, cases);
            }
        } catch {
            // ignore
        }
    }

    private async runHandler(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
        const run = this.controller.createTestRun(request);
        const qmltestrunner = await this.findQmlTestRunner();

        if (!qmltestrunner) {
            run.appendOutput('qmltestrunner not found. It ships with Qt.\n');
            run.end();
            return;
        }

        const testsToRun = this.resolveTestsToRun(request);
        if (testsToRun.length === 0) {
            run.appendOutput('No QML tests selected.\n');
            run.end();
            return;
        }

        for (const test of testsToRun) {
            run.enqueued(test);
        }

        // Group by file for efficient execution
        const fileGroups = new Map<string, vscode.TestItem[]>();
        for (const test of testsToRun) {
            const parent = test.parent;
            if (!parent) { continue; }
            const filePath = parent.uri?.fsPath;
            if (!filePath) { continue; }
            const existing = fileGroups.get(filePath) || [];
            existing.push(test);
            fileGroups.set(filePath, existing);
        }

        for (const [filePath, methods] of fileGroups) {
            if (token.isCancellationRequested) { break; }

            const caseItem = methods[0].parent;
            if (!caseItem) { continue; }

            run.started(caseItem);
            for (const method of methods) {
                run.started(method);
            }

            const args: string[] = ['-input', filePath];
            if (methods.length < caseItem.children.size) {
                // Run specific functions only
                const fnNames = methods.map(m => m.label).join(',');
                args.push('-functions', fnNames);
            }

            const results = await this.executeTest(qmltestrunner, args, run, token);
            this.applyResults(caseItem, methods, results || [], run);
            run.passed(caseItem);
        }

        run.end();
    }

    private resolveTestsToRun(request: vscode.TestRunRequest): vscode.TestItem[] {
        const result: vscode.TestItem[] = [];
        if (request.include && request.include.length > 0) {
            for (const item of request.include) {
                this.collectLeafTests(item, result);
            }
        } else {
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
        token: vscode.CancellationToken
    ): Promise<QmlTestResult[]> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        const env = { ...process.env };
        if (qtInstallation) {
            const qmlDir = path.join(qtInstallation.path, 'qml');
            if (fs.existsSync(qmlDir)) {
                env.QML2_IMPORT_PATH = env.QML2_IMPORT_PATH
                    ? `${env.QML2_IMPORT_PATH}${path.delimiter}${qmlDir}`
                    : qmlDir;
            }
        }

        return new Promise((resolve) => {
            const results: QmlTestResult[] = [];
            run.appendOutput(`> ${executable} ${args.join(' ')}\n`);

            const child = spawn(executable, args, { cwd: process.cwd(), env });
            let buffer = '';

            child.stdout?.on('data', (data: Buffer) => {
                const text = data.toString('utf-8');
                buffer += text;
                run.appendOutput(text);
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const r = this.parseOutput(line);
                    if (r) { results.push(r); }
                }
            });

            child.stderr?.on('data', (data: Buffer) => {
                run.appendOutput(data.toString('utf-8'));
            });

            child.on('close', () => {
                if (buffer) {
                    const r = this.parseOutput(buffer);
                    if (r) { results.push(r); }
                }
                resolve(results);
            });

            token.onCancellationRequested(() => {
                child.kill();
                run.appendOutput('\nQML test run cancelled.\n');
                resolve(results);
            });
        });
    }

    private parseOutput(line: string): QmlTestResult | undefined {
        const trimmed = line.trim();

        // PASS   : test_name
        const passMatch = trimmed.match(/^PASS\s+:\s+(\w+)/);
        if (passMatch) {
            return { testName: passMatch[1], status: 'pass' };
        }

        // FAIL!  : test_name message
        const failMatch = trimmed.match(/^FAIL!\s+:\s+(\w+)\s*(.*)/);
        if (failMatch) {
            return { testName: failMatch[1], status: 'fail', message: failMatch[2].trim() };
        }

        // SKIP   : test_name message
        const skipMatch = trimmed.match(/^SKIP\s+:\s+(\w+)\s*(.*)/);
        if (skipMatch) {
            return { testName: skipMatch[1], status: 'skip', message: skipMatch[2].trim() };
        }

        // XPASS  : test_name
        const xpassMatch = trimmed.match(/^XPASS\s+:\s+(\w+)/);
        if (xpassMatch) {
            return { testName: xpassMatch[1], status: 'xpass' };
        }

        // XFAIL  : test_name message
        const xfailMatch = trimmed.match(/^XFAIL\s+:\s+(\w+)\s*(.*)/);
        if (xfailMatch) {
            return { testName: xfailMatch[1], status: 'xfail', message: xfailMatch[2].trim() };
        }

        return undefined;
    }

    private applyResults(
        caseItem: vscode.TestItem,
        methods: vscode.TestItem[],
        results: QmlTestResult[],
        run: vscode.TestRun
    ): void {
        const resultMap = new Map<string, QmlTestResult>();
        for (const r of results) {
            resultMap.set(r.testName, r);
        }

        for (const method of methods) {
            const result = resultMap.get(method.label);
            if (!result) {
                run.passed(method);
                continue;
            }
            switch (result.status) {
                case 'pass':
                case 'xpass':
                    run.passed(method);
                    break;
                case 'skip':
                case 'xfail':
                    run.skipped(method);
                    break;
                case 'fail':
                    run.failed(method, new vscode.TestMessage(result.message || 'Test failed'));
                    break;
            }
        }
    }

    private async findQmlTestRunner(): Promise<string | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (qtInstallation) {
            const qtBinPath = path.join(qtInstallation.path, 'bin');
            const candidates = ['qmltestrunner', 'qmltestrunner.exe'];
            for (const name of candidates) {
                const p = path.join(qtBinPath, name);
                if (fs.existsSync(p)) { return p; }
            }
        }
        try {
            const cmd = process.platform === 'win32' ? 'where qmltestrunner' : 'which qmltestrunner';
            const { execSync } = await import('child_process');
            const result = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            const first = result.split('\n')[0].trim();
            if (first && fs.existsSync(first)) { return first; }
        } catch {
            // not found
        }
        return undefined;
    }
}
