import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';

interface IOSSimulator {
    udid: string;
    name: string;
    runtime: string;
    state: string;
}

export class QtIOSDeployment {
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
        // No resources to clean up
    }

    // ─────────────────────────────────────────────────────────────
    // Platform Guard
    // ─────────────────────────────────────────────────────────────

    private checkMacOS(): boolean {
        if (process.platform !== 'darwin') {
            void vscode.window.showErrorMessage('iOS deployment is only available on macOS.');
            return false;
        }
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // iOS Tool Detection
    // ─────────────────────────────────────────────────────────────

    private findTool(toolName: string): string | undefined {
        try {
            const result = execSync(`which ${toolName}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            if (result && fs.existsSync(result)) { return result; }
        } catch {
            // not found
        }
        return undefined;
    }

    private detectIOSTools(): { xcrun?: string; xcodebuild?: string } {
        return {
            xcrun: this.findTool('xcrun'),
            xcodebuild: this.findTool('xcodebuild')
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Simulator Management
    // ─────────────────────────────────────────────────────────────

    private listSimulators(): IOSSimulator[] {
        const xcrun = this.findTool('xcrun');
        if (!xcrun) { return []; }

        try {
            const output = execSync(`"${xcrun}" simctl list devices available -j`, {
                encoding: 'utf-8',
                stdio: 'pipe'
            });
            const data = JSON.parse(output);
            const simulators: IOSSimulator[] = [];

            for (const [runtime, devices] of Object.entries(data.devices || {})) {
                if (!Array.isArray(devices)) { continue; }
                for (const device of devices) {
                    if (device.isAvailable) {
                        simulators.push({
                            udid: device.udid,
                            name: device.name,
                            runtime: runtime.replace('com.apple.CoreSimulator.SimRuntime.', ''),
                            state: device.state
                        });
                    }
                }
            }
            return simulators;
        } catch {
            return [];
        }
    }

    async selectSimulator(): Promise<void> {
        if (!this.checkMacOS()) { return; }

        const simulators = this.listSimulators();
        if (simulators.length === 0) {
            void vscode.window.showErrorMessage('No iOS simulators found. Install Xcode and simulators first.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            simulators.map(s => ({
                label: s.name,
                description: `${s.runtime} • ${s.state}`,
                simulator: s
            })),
            { placeHolder: 'Select iOS simulator' }
        );

        if (!selected) { return; }

        const config = vscode.workspace.getConfiguration('qt');
        await config.update('iosSelectedSimulator', selected.simulator.udid, vscode.ConfigurationTarget.Workspace);
        void vscode.window.showInformationMessage(`iOS simulator selected: ${selected.simulator.name}`);
        this.outputChannel.appendLine(`[iOS] Selected simulator: ${selected.simulator.name} (${selected.simulator.udid})`);
    }

    // ─────────────────────────────────────────────────────────────
    // Build iOS App
    // ─────────────────────────────────────────────────────────────

    async buildIOSApp(projectFile?: string): Promise<void> {
        if (!this.checkMacOS()) { return; }

        const tools = this.detectIOSTools();
        if (!tools.xcrun) {
            void vscode.window.showErrorMessage('xcrun not found. Install Xcode Command Line Tools.');
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
                    { placeHolder: 'Select project to build for iOS' }
                );
                if (!selected) { return; }
                targetProject = selected.value;
            }
        }

        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (!qtInstallation) {
            void vscode.window.showErrorMessage('No Qt installation found. Configure Qt path first.');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        const buildForDevice = config.get<boolean>('iosBuildForDevice') || false;
        const buildType = this.qtConfigManager.getProjectBuildType(targetProject);
        const buildDir = this.qtConfigManager.getBuildDirectory().replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
        const iosBuildDir = path.join(buildDir, 'ios_build');
        const projectName = path.basename(targetProject, path.extname(targetProject));

        if (!fs.existsSync(iosBuildDir)) {
            fs.mkdirSync(iosBuildDir, { recursive: true });
        }

        const isCMake = targetProject.toLowerCase().endsWith('cmakelists.txt');

        this.outputChannel.appendLine(`[iOS] Building ${projectName} for ${buildForDevice ? 'device' : 'simulator'}...`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building iOS app: ${projectName}...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const commands: string[] = [];

                if (isCMake) {
                    // CMake iOS build
                    const sysroot = buildForDevice ? 'iphoneos' : 'iphonesimulator';
                    commands.push(
                        `cd "${iosBuildDir}"`,
                        `cmake -B . -S "${path.dirname(targetProject)}" -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=${sysroot} -DCMAKE_BUILD_TYPE=${buildType}`,
                        `cmake --build . --config ${buildType}`
                    );
                } else {
                    // QMake iOS build
                    const spec = 'macx-ios-clang';
                    const configArg = buildForDevice ? 'CONFIG+=iphone' : 'CONFIG+=iphonesimulator';
                    const buildTypeArg = buildType === 'release' ? 'CONFIG+=release' : 'CONFIG+=debug';
                    commands.push(
                        `cd "${iosBuildDir}"`,
                        `"${qtInstallation.qmakePath}" -spec ${spec} "${targetProject}" ${configArg} ${buildTypeArg}`,
                        `make`
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
                        void vscode.window.showInformationMessage(`iOS app built: ${projectName}`);
                        this.outputChannel.appendLine('[iOS] Build successful');
                        resolve();
                    } else {
                        void vscode.window.showErrorMessage(`iOS build failed (code ${code})`);
                        reject(new Error(`iOS build exited with code ${code}`));
                    }
                });
                child.on('error', (err) => {
                    void vscode.window.showErrorMessage(`iOS build error: ${err.message}`);
                    reject(err);
                });
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Run on Simulator
    // ─────────────────────────────────────────────────────────────

    async runOnSimulator(projectFile?: string): Promise<void> {
        if (!this.checkMacOS()) { return; }

        const xcrun = this.findTool('xcrun');
        if (!xcrun) {
            void vscode.window.showErrorMessage('xcrun not found. Install Xcode Command Line Tools.');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        let udid = config.get<string>('iosSelectedSimulator');

        if (!udid) {
            void vscode.window.showWarningMessage('No iOS simulator selected.');
            await this.selectSimulator();
            udid = config.get<string>('iosSelectedSimulator');
            if (!udid) { return; }
        }

        // Build first
        await this.buildIOSApp(projectFile);

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        const buildDir = this.qtConfigManager.getBuildDirectory().replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
        const iosBuildDir = path.join(buildDir, 'ios_build');

        // Find .app bundle
        const appBundle = this.findAppBundle(iosBuildDir);
        if (!appBundle) {
            void vscode.window.showErrorMessage('No .app bundle found. Build the iOS app first.');
            return;
        }

        const bundleId = this.extractBundleId(appBundle);
        if (!bundleId) {
            void vscode.window.showErrorMessage('Could not determine bundle ID from .app bundle.');
            return;
        }

        this.outputChannel.appendLine(`[iOS] Installing ${path.basename(appBundle)} to simulator ${udid}...`);

        try {
            execSync(`"${xcrun}" simctl install "${udid}" "${appBundle}"`, { encoding: 'utf-8', stdio: 'pipe' });
            this.outputChannel.appendLine('[iOS] Install successful');
        } catch (error) {
            const err = error as { stderr?: string };
            void vscode.window.showErrorMessage(`Simulator install failed: ${err.stderr || String(error)}`);
            return;
        }

        this.outputChannel.appendLine(`[iOS] Launching ${bundleId}...`);

        try {
            const result = execSync(`"${xcrun}" simctl launch "${udid}" "${bundleId}"`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            void vscode.window.showInformationMessage(`Launched on simulator: ${bundleId}`);
            this.outputChannel.appendLine(`[iOS] Launch successful: ${result}`);
        } catch (error) {
            const err = error as { stderr?: string };
            void vscode.window.showErrorMessage(`Launch failed: ${err.stderr || String(error)}`);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    private findAppBundle(buildDir: string): string | undefined {
        try {
            const entries = fs.readdirSync(buildDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.endsWith('.app')) {
                    return path.join(buildDir, entry.name);
                }
            }
            // Search recursively one level deeper
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const subPath = path.join(buildDir, entry.name);
                    const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
                    for (const sub of subEntries) {
                        if (sub.isDirectory() && sub.name.endsWith('.app')) {
                            return path.join(subPath, sub.name);
                        }
                    }
                }
            }
        } catch {
            // ignore
        }
        return undefined;
    }

    private extractBundleId(appBundle: string): string | undefined {
        const infoPlist = path.join(appBundle, 'Info.plist');
        if (!fs.existsSync(infoPlist)) { return undefined; }
        try {
            const output = execSync(`plutil -extract CFBundleIdentifier raw "${infoPlist}"`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            return output || undefined;
        } catch {
            return undefined;
        }
    }
}
