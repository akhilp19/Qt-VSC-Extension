import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync } from 'child_process';
import { createServer } from 'http';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';

export class QtWebAssembly {
    private qtConfigManager: QtConfigManager;
    private qtProjectDetector: QtProjectDetector;
    private outputChannel: vscode.OutputChannel;
    private server: ReturnType<typeof createServer> | undefined;

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
        if (this.server) {
            this.server.close();
            this.server = undefined;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Emscripten SDK Detection
    // ─────────────────────────────────────────────────────────────

    detectEmscripten(): { emsdkPath?: string; emccPath?: string; emcmakePath?: string; emmakePath?: string } {
        const config = vscode.workspace.getConfiguration('qt');
        const configuredPath = config.get<string>('emscriptenPath');

        const candidates: string[] = [];
        if (configuredPath && fs.existsSync(configuredPath)) {
            candidates.push(configuredPath);
        }

        candidates.push(
            path.join(process.env.HOME || '', 'emsdk'),
            path.join(process.env.HOME || '', 'emscripten'),
            path.join(process.env.USERPROFILE || '', 'emsdk'),
            'C:\\emsdk',
            '/usr/lib/emsdk',
            '/opt/emsdk'
        );

        for (const dir of candidates) {
            if (!dir || !fs.existsSync(dir)) { continue; }
            const emcc = path.join(dir, 'upstream', 'emscripten', 'emcc');
            const emccExe = emcc + (process.platform === 'win32' ? '.bat' : '');
            const emcmake = path.join(dir, 'upstream', 'emscripten', 'emcmake');
            const emcmakeExe = emcmake + (process.platform === 'win32' ? '.bat' : '');
            const emmake = path.join(dir, 'upstream', 'emscripten', 'emmake');
            const emmakeExe = emmake + (process.platform === 'win32' ? '.bat' : '');

            const emccExists = fs.existsSync(emcc) || fs.existsSync(emccExe);
            const emcmakeExists = fs.existsSync(emcmake) || fs.existsSync(emcmakeExe);
            const emmakeExists = fs.existsSync(emmake) || fs.existsSync(emmakeExe);

            if (emccExists) {
                return {
                    emsdkPath: dir,
                    emccPath: fs.existsSync(emcc) ? emcc : emccExe,
                    emcmakePath: emcmakeExists ? (fs.existsSync(emcmake) ? emcmake : emcmakeExe) : undefined,
                    emmakePath: emmakeExists ? (fs.existsSync(emmake) ? emmake : emmakeExe) : undefined
                };
            }
        }

        // Fallback: check PATH
        try {
            const result = execSync(
                process.platform === 'win32' ? 'where emcc' : 'which emcc',
                { encoding: 'utf-8', stdio: 'pipe' }
            ).trim().split('\n')[0];
            if (result && fs.existsSync(result)) {
                const emDir = path.dirname(result);
                return {
                    emsdkPath: path.dirname(emDir),
                    emccPath: result,
                    emcmakePath: path.join(emDir, 'emcmake' + (process.platform === 'win32' ? '.bat' : '')),
                    emmakePath: path.join(emDir, 'emmake' + (process.platform === 'win32' ? '.bat' : ''))
                };
            }
        } catch {
            // not found
        }

        return {};
    }

    // ─────────────────────────────────────────────────────────────
    // Qt WASM Detection
    // ─────────────────────────────────────────────────────────────

    async detectQtWasm(): Promise<{ qmakePath?: string; wasmSpec?: string } | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (!qtInstallation) { return undefined; }

        const qtPath = qtInstallation.path;
        const mkspecsDir = path.join(qtPath, 'mkspecs');

        if (fs.existsSync(path.join(mkspecsDir, 'wasm-emscripten'))) {
            return { qmakePath: qtInstallation.qmakePath, wasmSpec: 'wasm-emscripten' };
        }
        if (qtPath.toLowerCase().includes('wasm')) {
            return { qmakePath: qtInstallation.qmakePath, wasmSpec: 'wasm-emscripten' };
        }

        return undefined;
    }

    // ─────────────────────────────────────────────────────────────
    // Configuration
    // ─────────────────────────────────────────────────────────────

    async configureEmscripten(): Promise<void> {
        const selected = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Emscripten SDK',
            title: 'Emscripten SDK Path'
        });

        if (!selected || !selected[0]) { return; }

        const emsdkPath = selected[0].fsPath;
        const emcc = path.join(emsdkPath, 'upstream', 'emscripten', 'emcc');
        const emccExe = emcc + (process.platform === 'win32' ? '.bat' : '');

        if (!fs.existsSync(emcc) && !fs.existsSync(emccExe)) {
            void vscode.window.showErrorMessage('Invalid Emscripten SDK: emcc not found.');
            return;
        }

        // Check version
        try {
            const emccPath = fs.existsSync(emcc) ? emcc : emccExe;
            const version = execSync(`"${emccPath}" --version`, { encoding: 'utf-8', stdio: 'pipe' }).split('\n')[0].trim();
            this.outputChannel.appendLine(`[WASM] Emscripten: ${version}`);
        } catch {
            void vscode.window.showWarningMessage('Could not verify Emscripten version.');
        }

        const config = vscode.workspace.getConfiguration('qt');
        await config.update('emscriptenPath', emsdkPath, vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage(`Emscripten SDK configured: ${emsdkPath}`);
        this.outputChannel.appendLine(`[WASM] SDK path: ${emsdkPath}`);
    }

    // ─────────────────────────────────────────────────────────────
    // Build WebAssembly
    // ─────────────────────────────────────────────────────────────

    async buildWebAssembly(projectFile?: string): Promise<void> {
        const emscripten = this.detectEmscripten();
        if (!emscripten.emccPath) {
            const choice = await vscode.window.showWarningMessage(
                'Emscripten SDK not found.',
                'Configure SDK'
            );
            if (choice === 'Configure SDK') {
                await this.configureEmscripten();
            }
            return;
        }

        const qtWasm = await this.detectQtWasm();
        if (!qtWasm) {
            void vscode.window.showErrorMessage('No Qt for WebAssembly installation found.');
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // Find project
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
                    { placeHolder: 'Select project to build for WebAssembly' }
                );
                if (!selected) { return; }
                targetProject = selected.value;
            }
        }

        const config = vscode.workspace.getConfiguration('qt');
        const buildType = this.qtConfigManager.getProjectBuildType(targetProject);
        const wasmBuildDir = (config.get<string>('wasmBuildDirectory') || '${workspaceFolder}/build-wasm')
            .replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
        const projectName = path.basename(targetProject, path.extname(targetProject));

        if (!fs.existsSync(wasmBuildDir)) {
            fs.mkdirSync(wasmBuildDir, { recursive: true });
        }

        const isCMake = targetProject.toLowerCase().endsWith('cmakelists.txt');

        this.outputChannel.appendLine(`[WASM] Building ${projectName} for WebAssembly...`);
        this.outputChannel.appendLine(`  emcmake: ${emscripten.emcmakePath || 'not found'}`);
        this.outputChannel.appendLine(`  emmake: ${emscripten.emmakePath || 'not found'}`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building WebAssembly: ${projectName}...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const commands: string[] = [];

                if (isCMake && emscripten.emcmakePath) {
                    commands.push(
                        `cd "${wasmBuildDir}"`,
                        `"${emscripten.emcmakePath}" cmake -B . -S "${path.dirname(targetProject)}" -DCMAKE_BUILD_TYPE=${buildType}`,
                        `"${emscripten.emmakePath || 'make'}" make`
                    );
                } else {
                    const buildTypeArg = buildType === 'release' ? 'CONFIG+=release' : 'CONFIG+=debug';
                    commands.push(
                        `cd "${wasmBuildDir}"`,
                        `"${qtWasm.qmakePath}" -spec wasm-emscripten "${targetProject}" ${buildTypeArg}`,
                        `${emscripten.emmakePath || 'make'} make`
                    );
                }

                const shellCmd = commands.join(' && ');
                const child = spawn(shellCmd, { shell: true });

                child.stdout?.on('data', (data: Buffer) => {
                    this.outputChannel.append(data.toString('utf-8'));
                });
                child.stderr?.on('data', (data: Buffer) => {
                    this.outputChannel.append(data.toString('utf-8'));
                });
                child.on('close', (code) => {
                    if (code === 0) {
                        void vscode.window.showInformationMessage(`WebAssembly build successful: ${projectName}`);
                        this.outputChannel.appendLine('[WASM] Build successful');
                        resolve();
                    } else {
                        void vscode.window.showErrorMessage(`WASM build failed (code ${code})`);
                        reject(new Error(`WASM build exited with code ${code}`));
                    }
                });
                child.on('error', (err) => {
                    void vscode.window.showErrorMessage(`WASM build error: ${err.message}`);
                    reject(err);
                });
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Serve WebAssembly Preview
    // ─────────────────────────────────────────────────────────────

    async serveWebAssembly(projectFile?: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        const wasmBuildDir = (config.get<string>('wasmBuildDirectory') || '${workspaceFolder}/build-wasm')
            .replace('${workspaceFolder}', workspaceFolder.uri.fsPath);

        // Find HTML file
        const htmlFile = this.findHtmlFile(wasmBuildDir);
        if (!htmlFile) {
            void vscode.window.showErrorMessage('No HTML output found. Build for WebAssembly first.');
            return;
        }

        const port = config.get<number>('wasmServePort') || 8080;
        const serveDir = path.dirname(htmlFile);

        // Stop existing server
        if (this.server) {
            this.server.close();
            this.server = undefined;
        }

        this.server = createServer((req, res) => {
            const reqPath = req.url === '/' ? '/index.html' : req.url || '/index.html';
            const filePath = path.join(serveDir, reqPath);
            const ext = path.extname(filePath);
            const mimeTypes: Record<string, string> = {
                '.html': 'text/html',
                '.js': 'application/javascript',
                '.wasm': 'application/wasm',
                '.css': 'text/css',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.svg': 'image/svg+xml'
            };

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
                res.end(data);
            });
        });

        this.server.listen(port, () => {
            const url = `http://localhost:${port}`;
            void vscode.window.showInformationMessage(`WASM preview server running at ${url}`, 'Open Browser');
            this.outputChannel.appendLine(`[WASM] Preview server: ${url}`);
        });
    }

    private findHtmlFile(buildDir: string): string | undefined {
        try {
            const entries = fs.readdirSync(buildDir, { recursive: true }) as string[];
            for (const entry of entries) {
                if (entry.toLowerCase().endsWith('.html')) {
                    return path.join(buildDir, entry);
                }
            }
        } catch {
            // ignore
        }
        return undefined;
    }
}
