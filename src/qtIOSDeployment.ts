import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';
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
    private recordingProcess?: ChildProcess;

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
        this.stopRecordingProcess();
    }

    private stopRecordingProcess(): void {
        if (this.recordingProcess) {
            this.recordingProcess.kill('SIGTERM');
            this.recordingProcess = undefined;
        }
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
    // iOS Device Deployment
    // ─────────────────────────────────────────────────────────────

    async archiveIOSApp(projectFile?: string): Promise<void> {
        if (!this.checkMacOS()) { return; }

        const xcodebuild = this.findTool('xcodebuild');
        if (!xcodebuild) {
            void vscode.window.showErrorMessage('xcodebuild not found. Install Xcode.');
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        let targetProject = projectFile || (await this.pickProject(workspaceFolder.uri.fsPath));
        if (!targetProject) { return; }

        const projectName = path.basename(targetProject, path.extname(targetProject));
        const archivePath = path.join(workspaceFolder.uri.fsPath, 'build-ios', `${projectName}.xcarchive`);

        this.outputChannel.appendLine(`[iOS] Archiving ${projectName}...`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Archiving iOS app: ${projectName}...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const scheme = projectName;
                const cmd = `"${xcodebuild}" archive -project "${targetProject}" -scheme "${scheme}" -archivePath "${archivePath}" -destination 'generic/platform=iOS'`;
                const child = spawn(cmd, { shell: true });
                child.stdout?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.stderr?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.on('close', (code) => {
                    if (code === 0) {
                        void vscode.window.showInformationMessage(`Archive created: ${path.basename(archivePath)}`);
                        resolve();
                    } else {
                        reject(new Error(`xcodebuild archive failed (code ${code})`));
                    }
                });
                child.on('error', (err) => reject(err));
            });
        });
    }

    async exportIOSIpa(projectFile?: string): Promise<void> {
        if (!this.checkMacOS()) { return; }

        const xcodebuild = this.findTool('xcodebuild');
        if (!xcodebuild) {
            void vscode.window.showErrorMessage('xcodebuild not found. Install Xcode.');
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        let targetProject = projectFile || (await this.pickProject(workspaceFolder.uri.fsPath));
        if (!targetProject) { return; }

        const projectName = path.basename(targetProject, path.extname(targetProject));
        const archivePath = path.join(workspaceFolder.uri.fsPath, 'build-ios', `${projectName}.xcarchive`);
        const exportPath = path.join(workspaceFolder.uri.fsPath, 'build-ios', 'ipa');
        const optionsPath = path.join(exportPath, 'ExportOptions.plist');

        if (!fs.existsSync(archivePath)) {
            void vscode.window.showErrorMessage('No archive found. Run "Archive iOS App" first.');
            return;
        }

        if (!fs.existsSync(exportPath)) {
            fs.mkdirSync(exportPath, { recursive: true });
        }

        // Generate minimal ExportOptions.plist
        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>development</string>
    <key>stripSwiftSymbols</key>
    <false/>
    <key> thinning</key>
    <string>&lt;none&gt;</string>
</dict>
</plist>`;
        fs.writeFileSync(optionsPath, plistContent, 'utf-8');

        this.outputChannel.appendLine(`[iOS] Exporting IPA...`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Exporting IPA for ${projectName}...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const cmd = `"${xcodebuild}" -exportArchive -archivePath "${archivePath}" -exportPath "${exportPath}" -exportOptionsPlist "${optionsPath}"`;
                const child = spawn(cmd, { shell: true });
                child.stdout?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.stderr?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.on('close', (code) => {
                    if (code === 0) {
                        void vscode.window.showInformationMessage(`IPA exported to ${exportPath}`);
                        resolve();
                    } else {
                        reject(new Error(`xcodebuild export failed (code ${code})`));
                    }
                });
                child.on('error', (err) => reject(err));
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // iOS TestFlight / App Store Upload
    // ─────────────────────────────────────────────────────────────

    async uploadToTestFlight(projectFile?: string): Promise<void> {
        if (!this.checkMacOS()) { return; }

        const xcrun = this.findTool('xcrun');
        if (!xcrun) {
            void vscode.window.showErrorMessage('xcrun not found. Install Xcode Command Line Tools.');
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        let targetProject = projectFile || (await this.pickProject(workspaceFolder.uri.fsPath));
        if (!targetProject) { return; }

        const projectName = path.basename(targetProject, path.extname(targetProject));
        const exportPath = path.join(workspaceFolder.uri.fsPath, 'build-ios', 'ipa');

        // Find exported IPA
        let ipaPath: string | undefined;
        try {
            const entries = fs.readdirSync(exportPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.ipa')) {
                    ipaPath = path.join(exportPath, entry.name);
                    break;
                }
            }
        } catch {
            // ignore
        }
        if (!ipaPath) {
            void vscode.window.showErrorMessage('No exported IPA found. Run "Export iOS IPA" first.');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        let appleId = config.get<string>('iosAppleId') || '';
        let appPassword = config.get<string>('iosAppSpecificPassword') || '';
        const apiKeyPath = config.get<string>('iosApiKeyPath') || '';
        const apiIssuerId = config.get<string>('iosApiIssuerId') || '';
        const apiKeyId = config.get<string>('iosApiKeyId') || '';

        let useApiKey = apiKeyPath && fs.existsSync(apiKeyPath) && apiIssuerId && apiKeyId;

        if (!useApiKey && !appleId) {
            appleId = await vscode.window.showInputBox({
                prompt: 'Apple ID email for App Store Connect',
                placeHolder: 'name@example.com'
            }) || '';
            if (!appleId) { return; }
            await config.update('iosAppleId', appleId, vscode.ConfigurationTarget.Workspace);
        }

        if (!useApiKey && !appPassword) {
            appPassword = await vscode.window.showInputBox({
                prompt: 'App-specific password for App Store Connect',
                password: true
            }) || '';
            if (!appPassword) { return; }
            await config.update('iosAppSpecificPassword', appPassword, vscode.ConfigurationTarget.Workspace);
        }

        let cmd: string;
        if (useApiKey) {
            cmd = `"${xcrun}" altool --upload-app -f "${ipaPath}" -t ios --apiKey "${apiKeyId}" --apiIssuer "${apiIssuerId}"`;
        } else {
            cmd = `"${xcrun}" altool --upload-app -f "${ipaPath}" -t ios -u "${appleId}" -p "${appPassword}"`;
        }

        this.outputChannel.appendLine(`[iOS] Uploading ${path.basename(ipaPath)} to TestFlight/App Store...`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Uploading ${path.basename(ipaPath)}...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const child = spawn(cmd, { shell: true });
                child.stdout?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.stderr?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.on('close', (code) => {
                    if (code === 0) {
                        void vscode.window.showInformationMessage(`Uploaded ${path.basename(ipaPath!)} to TestFlight/App Store.`);
                        resolve();
                    } else {
                        reject(new Error(`Upload failed (code ${code})`));
                    }
                });
                child.on('error', (err) => reject(err));
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // iOS Simulator Media Capture
    // ─────────────────────────────────────────────────────────────

    async takeSimulatorScreenshot(): Promise<void> {
        if (!this.checkMacOS()) { return; }

        const xcrun = this.findTool('xcrun');
        if (!xcrun) {
            void vscode.window.showErrorMessage('xcrun not found. Install Xcode Command Line Tools.');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        let udid = config.get<string>('iosSelectedSimulator');
        if (!udid) {
            await this.selectSimulator();
            udid = config.get<string>('iosSelectedSimulator');
            if (!udid) { return; }
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        const mediaDirRaw = config.get<string>('iosSimulatorMediaDir') || '${workspaceFolder}/ios-media';
        const mediaDir = mediaDirRaw.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = path.join(mediaDir, `simulator-${timestamp}.png`);

        try {
            execSync(`"${xcrun}" simctl io "${udid}" screenshot "${screenshotPath}"`, {
                encoding: 'utf-8',
                stdio: 'pipe'
            });
            void vscode.window.showInformationMessage(`Screenshot saved: ${screenshotPath}`, 'Open').then(choice => {
                if (choice === 'Open') {
                    void vscode.env.openExternal(vscode.Uri.file(screenshotPath));
                }
            });
            this.outputChannel.appendLine(`[iOS] Screenshot saved: ${screenshotPath}`);
        } catch (error) {
            const err = error as { stderr?: string };
            void vscode.window.showErrorMessage(`Screenshot failed: ${err.stderr || String(error)}`);
        }
    }

    async recordSimulatorVideo(): Promise<void> {
        if (!this.checkMacOS()) { return; }

        const xcrun = this.findTool('xcrun');
        if (!xcrun) {
            void vscode.window.showErrorMessage('xcrun not found. Install Xcode Command Line Tools.');
            return;
        }

        if (this.recordingProcess) {
            void vscode.window.showWarningMessage('A simulator recording is already in progress. Stop it first.');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        let udid = config.get<string>('iosSelectedSimulator');
        if (!udid) {
            await this.selectSimulator();
            udid = config.get<string>('iosSelectedSimulator');
            if (!udid) { return; }
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return; }

        const mediaDirRaw = config.get<string>('iosSimulatorMediaDir') || '${workspaceFolder}/ios-media';
        const mediaDir = mediaDirRaw.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
        if (!fs.existsSync(mediaDir)) {
            fs.mkdirSync(mediaDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const videoPath = path.join(mediaDir, `simulator-${timestamp}.mp4`);

        const cmd = `"${xcrun}" simctl io "${udid}" recordVideo "${videoPath}"`;
        this.recordingProcess = spawn(cmd, { shell: true });

        this.outputChannel.appendLine(`[iOS] Started simulator recording: ${videoPath}`);
        void vscode.window.showInformationMessage('Recording iOS simulator video. Use "Stop Simulator Recording" to finish.');
    }

    async stopSimulatorRecording(): Promise<void> {
        if (!this.recordingProcess) {
            void vscode.window.showInformationMessage('No simulator recording is in progress.');
            return;
        }
        this.stopRecordingProcess();
        void vscode.window.showInformationMessage('Simulator recording stopped.');
        this.outputChannel.appendLine('[iOS] Stopped simulator recording');
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

    private async pickProject(workspacePath: string): Promise<string | undefined> {
        const projects = await this.qtProjectDetector.detectProjects(workspacePath);
        if (projects.length === 0) { return undefined; }
        if (projects.length === 1) { return projects[0]; }
        const selected = await vscode.window.showQuickPick(
            projects.map(p => ({ label: path.basename(p), description: p, value: p })),
            { placeHolder: 'Select project' }
        );
        return selected?.value;
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
