import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';
import { QtConfigManager } from './qtConfigManager';
import { QtProjectDetector } from './qtProjectDetector';

interface AndroidDevice {
    id: string;
    name: string;
    status: string;
}

export class QtAndroidDeployment {
    private qtConfigManager: QtConfigManager;
    private qtProjectDetector: QtProjectDetector;
    private outputChannel: vscode.OutputChannel;
    private logcatProcess?: ChildProcess;

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
        this.stopLogcatProcess();
    }

    private stopLogcatProcess(): void {
        if (this.logcatProcess) {
            this.logcatProcess.kill('SIGTERM');
            this.logcatProcess = undefined;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Android SDK / NDK Configuration
    // ─────────────────────────────────────────────────────────────

    async configureAndroidSdk(): Promise<void> {
        const config = vscode.workspace.getConfiguration('qt');

        const sdkPath = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Android SDK',
            title: 'Android SDK Path'
        });

        if (sdkPath && sdkPath[0]) {
            await config.update('androidSdkPath', sdkPath[0].fsPath, vscode.ConfigurationTarget.Workspace);
            this.outputChannel.appendLine(`Android SDK: ${sdkPath[0].fsPath}`);

            // Auto-detect NDK inside the selected SDK
            const autoNdk = this.findNdkInSdk(sdkPath[0].fsPath);
            if (autoNdk) {
                await config.update('androidNdkPath', autoNdk, vscode.ConfigurationTarget.Workspace);
                this.outputChannel.appendLine(`Auto-detected NDK: ${autoNdk}`);
                void vscode.window.showInformationMessage(`Auto-detected Android NDK: ${path.basename(autoNdk)}`);
            }
        }

        const ndkPath = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Android NDK (optional)',
            title: 'Android NDK Path'
        });

        if (ndkPath && ndkPath[0]) {
            await config.update('androidNdkPath', ndkPath[0].fsPath, vscode.ConfigurationTarget.Workspace);
            this.outputChannel.appendLine(`Android NDK: ${ndkPath[0].fsPath}`);
        }

        const platform = await vscode.window.showInputBox({
            prompt: 'Android platform level (e.g., android-34)',
            value: config.get<string>('androidPlatform') || 'android-34',
            placeHolder: 'android-34'
        });

        if (platform) {
            await config.update('androidPlatform', platform, vscode.ConfigurationTarget.Workspace);
        }

        void vscode.window.showInformationMessage('Android SDK configuration saved');
    }

    // ─────────────────────────────────────────────────────────────
    // Build APK
    // ─────────────────────────────────────────────────────────────

    async buildApk(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const sdkPath = this.getAndroidSdkPath();
        if (!sdkPath) {
            const choice = await vscode.window.showWarningMessage(
                'Android SDK not configured.',
                'Configure SDK'
            );
            if (choice === 'Configure SDK') {
                await this.configureAndroidSdk();
            }
            return;
        }

        // Find project
        const projects = await this.qtProjectDetector.detectProjects(workspaceFolder.uri.fsPath);
        if (projects.length === 0) {
            void vscode.window.showErrorMessage('No Qt project found');
            return;
        }

        let projectFile = projects[0];
        if (projects.length > 1) {
            const selected = await vscode.window.showQuickPick(
                projects.map(p => ({ label: path.basename(p), description: p, value: p })),
                { placeHolder: 'Select project to build APK for' }
            );
            if (!selected) { return; }
            projectFile = selected.value;
        }

        const buildDir = this.qtConfigManager.getBuildDirectory();
        const projectName = path.basename(projectFile, path.extname(projectFile));

        if (!fs.existsSync(buildDir)) {
            void vscode.window.showErrorMessage('Build directory not found. Build the project first.');
            return;
        }

        // Prefer Gradle wrapper when available and enabled
        const config = vscode.workspace.getConfiguration('qt');
        const preferGradle = config.get<boolean>('androidPreferGradleWrapper') ?? true;
        const gradlew = preferGradle ? this.findGradleWrapper(buildDir, path.dirname(projectFile)) : undefined;
        if (gradlew) {
            await this.runGradleWrapper(gradlew, buildDir, projectName, 'assembleDebug');
            return;
        }

        const androidDeployQt = await this.findAndroidDeployQt();
        if (!androidDeployQt) {
            void vscode.window.showErrorMessage(
                'androiddeployqt not found. Install Qt for Android (e.g., Qt 6.7.0 Android) and configure Qt path.'
            );
            return;
        }

        // Look for android_deployment_settings.json
        const deploymentSettings = this.findDeploymentSettings(buildDir, projectName);
        if (!deploymentSettings) {
            void vscode.window.showErrorMessage(
                'android_deployment_settings.json not found. Build the project for Android first (qmake/android or CMake with Android toolchain).'
            );
            return;
        }

        const platform = config.get<string>('androidPlatform') || 'android-34';
        const apkOutputDir = path.join(buildDir, `${projectName}_apk`);

        // Ensure output directory exists
        if (!fs.existsSync(apkOutputDir)) {
            fs.mkdirSync(apkOutputDir, { recursive: true });
        }

        const args = [
            '--input', deploymentSettings,
            '--output', apkOutputDir,
            '--android-platform', platform,
            '--gradle'
        ];

        const ndkPath = this.getAndroidNdkPath();
        if (ndkPath) {
            args.push('--ndk-path', ndkPath);
        }

        this.outputChannel.appendLine(`[Android] Building APK...`);
        this.outputChannel.appendLine(`  androiddeployqt: ${androidDeployQt}`);
        this.outputChannel.appendLine(`  Output: ${apkOutputDir}`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building Android APK for ${projectName}...`,
            cancellable: false
        }, async () => {
            return this.runAndroidDeployQt(androidDeployQt!, args, apkOutputDir);
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Build AAB (Android App Bundle)
    // ─────────────────────────────────────────────────────────────

    async buildAab(projectFile?: string): Promise<void> {
        const sdkPath = this.getAndroidSdkPath();
        if (!sdkPath) {
            const choice = await vscode.window.showWarningMessage(
                'Android SDK not configured.',
                'Configure SDK'
            );
            if (choice === 'Configure SDK') {
                await this.configureAndroidSdk();
            }
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
                    { placeHolder: 'Select project to build AAB for' }
                );
                if (!selected) { return; }
                targetProject = selected.value;
            }
        }

        const buildDir = this.qtConfigManager.getBuildDirectory();
        const projectName = path.basename(targetProject, path.extname(targetProject));

        if (!fs.existsSync(buildDir)) {
            void vscode.window.showErrorMessage('Build directory not found. Build the project first.');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        const preferGradle = config.get<boolean>('androidPreferGradleWrapper') ?? true;
        const gradlew = preferGradle ? this.findGradleWrapper(buildDir, path.dirname(targetProject)) : undefined;
        if (gradlew) {
            await this.runGradleWrapper(gradlew, buildDir, projectName, 'bundleDebug');
            return;
        }

        const androidDeployQt = await this.findAndroidDeployQt();
        if (!androidDeployQt) {
            void vscode.window.showErrorMessage('androiddeployqt not found. Ensure Qt for Android is installed.');
            return;
        }

        const deploymentSettings = this.findDeploymentSettings(buildDir, projectName);
        if (!deploymentSettings) {
            void vscode.window.showErrorMessage(
                'android_deployment_settings.json not found. Build the project for Android first.'
            );
            return;
        }

        const platform = config.get<string>('androidPlatform') || 'android-34';
        const aabOutputDir = path.join(buildDir, `${projectName}_aab`);

        if (!fs.existsSync(aabOutputDir)) {
            fs.mkdirSync(aabOutputDir, { recursive: true });
        }

        const args = [
            '--input', deploymentSettings,
            '--output', aabOutputDir,
            '--android-platform', platform,
            '--gradle',
            '--aab'
        ];

        const ndkPath = this.getAndroidNdkPath();
        if (ndkPath) {
            args.push('--ndk-path', ndkPath);
        }

        this.outputChannel.appendLine(`[Android] Building AAB...`);
        this.outputChannel.appendLine(`  androiddeployqt: ${androidDeployQt}`);
        this.outputChannel.appendLine(`  Output: ${aabOutputDir}`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building Android AAB for ${projectName}...`,
            cancellable: false
        }, async () => {
            return this.runAndroidDeployQt(androidDeployQt!, args, aabOutputDir);
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Validate AndroidManifest.xml
    // ─────────────────────────────────────────────────────────────

    async validateManifest(projectFile?: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

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
                    { placeHolder: 'Select project to validate manifest for' }
                );
                if (!selected) { return; }
                targetProject = selected.value;
            }
        }

        const projectDir = path.dirname(targetProject);
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const projectName = path.basename(targetProject, path.extname(targetProject));

        // Search for AndroidManifest.xml
        const candidates = [
            path.join(projectDir, 'android', 'AndroidManifest.xml'),
            path.join(projectDir, 'AndroidManifest.xml'),
            path.join(buildDir, 'android-build', 'AndroidManifest.xml'),
            path.join(buildDir, 'android_build', 'AndroidManifest.xml'),
            path.join(buildDir, projectName, 'AndroidManifest.xml')
        ];

        let manifestPath: string | undefined;
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                manifestPath = p;
                break;
            }
        }

        if (!manifestPath) {
            void vscode.window.showErrorMessage('AndroidManifest.xml not found.');
            return;
        }

        const content = fs.readFileSync(manifestPath, 'utf-8');
        const issues: string[] = [];

        // Check for Qt application class
        const hasQt5App = content.includes('org.qtproject.qt5.android.bindings.QtApplication');
        const hasQt6App = content.includes('org.qtproject.qt6.android.bindings.QtApplication');
        if (!hasQt5App && !hasQt6App) {
            issues.push('Missing Qt application class in <application android:name>. Expected org.qtproject.qt5/6.android.bindings.QtApplication');
        }

        // Check configChanges
        if (!content.includes('android:configChanges')) {
            issues.push('Missing android:configChanges attribute. Qt apps should handle orientation|screenSize|smallestScreenSize|locale changes.');
        }

        // Check INTERNET permission (commonly needed)
        if (!content.includes('android.permission.INTERNET')) {
            issues.push('Missing INTERNET permission. Most Qt apps need <uses-permission android:name="android.permission.INTERNET" />');
        }

        // Check minSdkVersion compatibility
        const minSdkMatch = content.match(/android:minSdkVersion="(\d+)"/);
        if (minSdkMatch) {
            const minSdk = parseInt(minSdkMatch[1], 10);
            if (minSdk < 21) {
                issues.push(`minSdkVersion (${minSdk}) may be too low for modern Qt. Qt 6 recommends API 23+.`);
            }
        } else {
            issues.push('Missing android:minSdkVersion. Qt apps should declare a minimum SDK version.');
        }

        // Report results
        this.outputChannel.appendLine(`[Android] Manifest validation: ${manifestPath}`);
        if (issues.length === 0) {
            void vscode.window.showInformationMessage('AndroidManifest.xml looks good!');
            this.outputChannel.appendLine('[Android] No issues found.');
        } else {
            void vscode.window.showWarningMessage(`AndroidManifest.xml: ${issues.length} issue(s) found. See Output → Qt C++ Tools.`);
            for (const issue of issues) {
                this.outputChannel.appendLine(`  ⚠ ${issue}`);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Install APK
    // ─────────────────────────────────────────────────────────────

    async installApk(): Promise<void> {
        const adbPath = this.findAdb();
        if (!adbPath) {
            void vscode.window.showErrorMessage('adb not found. Configure Android SDK path first.');
            return;
        }

        // Find built APK
        const buildDir = this.qtConfigManager.getBuildDirectory();
        const apkPath = this.findApkFile(buildDir);
        if (!apkPath) {
            void vscode.window.showErrorMessage('No APK found. Build the Android APK first.');
            return;
        }

        // List devices
        const devices = this.listDevices(adbPath);
        if (devices.length === 0) {
            void vscode.window.showErrorMessage('No Android devices connected. Connect a device or start an emulator.');
            return;
        }

        let deviceId = devices[0].id;
        if (devices.length > 1) {
            const selected = await vscode.window.showQuickPick(
                devices.map(d => ({ label: d.name || d.id, description: d.status, id: d.id })),
                { placeHolder: 'Select Android device' }
            );
            if (!selected) { return; }
            deviceId = selected.id;
        }

        this.outputChannel.appendLine(`[Android] Installing ${path.basename(apkPath)} to ${deviceId}...`);

        try {
            execSync(`"${adbPath}" -s ${deviceId} install -r "${apkPath}"`, {
                encoding: 'utf-8',
                stdio: 'pipe'
            });
            void vscode.window.showInformationMessage(`APK installed on ${deviceId}`);
            this.outputChannel.appendLine('[Android] Installation successful');
        } catch (error) {
            const err = error as { stderr?: string; stdout?: string };
            const msg = err.stderr || err.stdout || String(error);
            void vscode.window.showErrorMessage(`APK install failed: ${msg}`);
            this.outputChannel.appendLine(`[Android] Install failed: ${msg}`);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Bundletool AAB → APKS
    // ─────────────────────────────────────────────────────────────

    async buildApksFromAab(projectFile?: string): Promise<void> {
        const bundletool = this.findBundletool();
        if (!bundletool) {
            void vscode.window.showErrorMessage('bundletool.jar not found. Configure qt.androidBundletoolPath or place bundletool.jar in ~/bin/.');
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

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
                    { placeHolder: 'Select project to build APKS for' }
                );
                if (!selected) { return; }
                targetProject = selected.value;
            }
        }

        const buildDir = this.qtConfigManager.getBuildDirectory();
        const aabPath = this.findAabFile(buildDir);
        if (!aabPath) {
            void vscode.window.showErrorMessage('No AAB found. Build the Android AAB first.');
            return;
        }

        const config = vscode.workspace.getConfiguration('qt');
        const keystorePath = config.get<string>('androidKeystorePath') || this.getDefaultDebugKeystore();
        const keystorePassword = config.get<string>('androidKeystorePassword') || 'android';
        const keyAlias = config.get<string>('androidKeyAlias') || 'androiddebugkey';

        const apksPath = aabPath.replace(/\.aab$/i, '.apks');

        let cmd: string;
        if (keystorePath && fs.existsSync(keystorePath)) {
            cmd = `java -jar "${bundletool}" build-apks --bundle="${aabPath}" --output="${apksPath}" --ks="${keystorePath}" --ks-pass=pass:${keystorePassword} --ks-key-alias="${keyAlias}"`;
        } else {
            cmd = `java -jar "${bundletool}" build-apks --bundle="${aabPath}" --output="${apksPath}"`;
        }

        this.outputChannel.appendLine(`[Android] Building APKS from ${path.basename(aabPath)}...`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Building APKS for ${path.basename(aabPath)}...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const child = spawn(cmd, { shell: true });
                child.stdout?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.stderr?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.on('close', (code) => {
                    if (code === 0) {
                        void vscode.window.showInformationMessage(`APKS built: ${path.basename(apksPath)}`, 'Install APKS').then(choice => {
                            if (choice === 'Install APKS') {
                                void this.installApks();
                            }
                        });
                        resolve();
                    } else {
                        reject(new Error(`bundletool build-apks failed (code ${code})`));
                    }
                });
                child.on('error', (err) => reject(err));
            });
        });
    }

    async installApks(projectFile?: string): Promise<void> {
        const bundletool = this.findBundletool();
        if (!bundletool) {
            void vscode.window.showErrorMessage('bundletool.jar not found. Configure qt.androidBundletoolPath.');
            return;
        }

        const buildDir = this.qtConfigManager.getBuildDirectory();
        let apksPath: string | undefined;
        const searchDirs = [buildDir, path.join(buildDir, 'android_build'), path.join(buildDir, 'android-build')];
        for (const dir of searchDirs) {
            if (!fs.existsSync(dir)) { continue; }
            try {
                const entries = fs.readdirSync(dir, { recursive: true }) as string[];
                for (const entry of entries) {
                    if (entry.endsWith('.apks')) {
                        apksPath = path.join(dir, entry);
                        break;
                    }
                }
            } catch {
                // ignore
            }
            if (apksPath) { break; }
        }

        if (!apksPath) {
            void vscode.window.showErrorMessage('No APKS file found. Build APKS from AAB first.');
            return;
        }

        const adbPath = this.findAdb();
        let deviceArg = '';
        if (adbPath) {
            const devices = this.listDevices(adbPath);
            if (devices.length > 1) {
                const selected = await vscode.window.showQuickPick(
                    devices.map(d => ({ label: d.name || d.id, description: d.status, id: d.id })),
                    { placeHolder: 'Select Android device' }
                );
                if (selected) {
                    deviceArg = ` --device-id=${selected.id}`;
                }
            } else if (devices.length === 1) {
                deviceArg = ` --device-id=${devices[0].id}`;
            }
        }

        const cmd = `java -jar "${bundletool}" install-apks --apks="${apksPath}"${deviceArg}`;
        this.outputChannel.appendLine(`[Android] Installing APKS ${path.basename(apksPath)}...`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing APKS on device...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const child = spawn(cmd, { shell: true });
                child.stdout?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.stderr?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.on('close', (code) => {
                    if (code === 0) {
                        void vscode.window.showInformationMessage('APKS installed successfully');
                        resolve();
                    } else {
                        reject(new Error(`bundletool install-apks failed (code ${code})`));
                    }
                });
                child.on('error', (err) => reject(err));
            });
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Android Logcat
    // ─────────────────────────────────────────────────────────────

    async startLogcat(): Promise<void> {
        const adbPath = this.findAdb();
        if (!adbPath) {
            void vscode.window.showErrorMessage('adb not found. Configure Android SDK path first.');
            return;
        }

        if (this.logcatProcess) {
            void vscode.window.showWarningMessage('Logcat is already running. Stop it first.');
            return;
        }

        const devices = this.listDevices(adbPath);
        if (devices.length === 0) {
            void vscode.window.showErrorMessage('No Android devices connected.');
            return;
        }

        let deviceId = devices[0].id;
        if (devices.length > 1) {
            const selected = await vscode.window.showQuickPick(
                devices.map(d => ({ label: d.name || d.id, description: d.status, id: d.id })),
                { placeHolder: 'Select Android device for logcat' }
            );
            if (!selected) { return; }
            deviceId = selected.id;
        }

        const filter = await vscode.window.showInputBox({
            prompt: 'Optional logcat filter (tag:priority, e.g., Qt:D)',
            placeHolder: 'leave empty for all messages'
        });

        const cmd = filter
            ? `"${adbPath}" -s ${deviceId} logcat ${filter}`
            : `"${adbPath}" -s ${deviceId} logcat`;

        this.outputChannel.appendLine(`[Android] Starting logcat for ${deviceId}...`);
        this.logcatProcess = spawn(cmd, { shell: true });
        this.logcatProcess.stdout?.on('data', (data: Buffer) => {
            this.outputChannel.append('[Logcat] ' + data.toString('utf-8'));
        });
        this.logcatProcess.stderr?.on('data', (data: Buffer) => {
            this.outputChannel.append('[Logcat] ' + data.toString('utf-8'));
        });
        this.logcatProcess.on('close', (code) => {
            this.outputChannel.appendLine(`[Android] Logcat exited (code ${code})`);
            this.logcatProcess = undefined;
        });
        this.logcatProcess.on('error', (err) => {
            void vscode.window.showErrorMessage(`Logcat error: ${err.message}`);
            this.logcatProcess = undefined;
        });
    }

    async stopLogcat(): Promise<void> {
        if (!this.logcatProcess) {
            void vscode.window.showInformationMessage('Logcat is not running.');
            return;
        }
        this.stopLogcatProcess();
        void vscode.window.showInformationMessage('Logcat stopped.');
    }

    // ─────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────

    private getDefaultDebugKeystore(): string | undefined {
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        if (!homeDir) { return undefined; }
        const keystore = path.join(homeDir, '.android', 'debug.keystore');
        return fs.existsSync(keystore) ? keystore : undefined;
    }

    private findBundletool(): string | undefined {
        const config = vscode.workspace.getConfiguration('qt');
        const configuredPath = config.get<string>('androidBundletoolPath');
        if (configuredPath && fs.existsSync(configuredPath)) {
            return configuredPath;
        }

        const homeDir = process.env.HOME || process.env.USERPROFILE;
        const commonPaths = [
            homeDir ? path.join(homeDir, 'bin', 'bundletool.jar') : '',
            homeDir ? path.join(homeDir, 'bundletool.jar') : '',
            path.join(process.cwd(), 'bundletool.jar')
        ];

        const sdkPath = this.getAndroidSdkPath();
        if (sdkPath) {
            const cmdlineTools = path.join(sdkPath, 'cmdline-tools');
            if (fs.existsSync(cmdlineTools)) {
                try {
                    const entries = fs.readdirSync(cmdlineTools, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isDirectory()) {
                            commonPaths.push(path.join(cmdlineTools, entry.name, 'lib', 'bundletool.jar'));
                        }
                    }
                } catch {
                    // ignore
                }
            }
        }

        for (const p of commonPaths) {
            if (p && fs.existsSync(p)) { return p; }
        }

        try {
            const result = execSync(
                process.platform === 'win32' ? 'where bundletool' : 'which bundletool',
                { encoding: 'utf-8', stdio: 'pipe' }
            ).trim();
            const first = result.split('\n')[0].trim();
            if (first && fs.existsSync(first)) { return first; }
        } catch {
            // not found
        }

        return undefined;
    }

    private findGradleWrapper(buildDir: string, projectDir: string): string | undefined {
        const isWindows = process.platform === 'win32';
        const wrapperName = isWindows ? 'gradlew.bat' : 'gradlew';
        const candidates = [
            path.join(buildDir, 'android_build', wrapperName),
            path.join(buildDir, 'android-build', wrapperName),
            path.join(buildDir, wrapperName),
            path.join(projectDir, wrapperName)
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }

    private async runGradleWrapper(gradlew: string, buildDir: string, projectName: string, task: 'assembleDebug' | 'bundleDebug'): Promise<void> {
        const cwd = path.dirname(gradlew);
        const isWindows = process.platform === 'win32';
        const cmd = isWindows ? `"${gradlew}" ${task}` : `"${gradlew}" ${task}`;
        this.outputChannel.appendLine(`[Android] Running Gradle wrapper: ${cmd}`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Running Gradle ${task}...`,
            cancellable: false
        }, async () => {
            return new Promise<void>((resolve, reject) => {
                const child = spawn(cmd, { shell: true, cwd });
                child.stdout?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.stderr?.on('data', (data: Buffer) => this.outputChannel.append(data.toString('utf-8')));
                child.on('close', (code) => {
                    if (code === 0) {
                        void vscode.window.showInformationMessage(`Gradle ${task} completed for ${projectName}`);
                        resolve();
                    } else {
                        reject(new Error(`Gradle ${task} failed (code ${code})`));
                    }
                });
                child.on('error', (err) => reject(err));
            });
        });
    }

    private async findAndroidDeployQt(): Promise<string | undefined> {
        const qtInstallation = await this.qtConfigManager.getQtInstallation();
        if (qtInstallation) {
            const candidates = [
                path.join(qtInstallation.path, 'bin', 'androiddeployqt'),
                path.join(qtInstallation.path, 'bin', 'androiddeployqt.exe')
            ];
            for (const p of candidates) {
                if (fs.existsSync(p)) { return p; }
            }
        }

        try {
            const result = execSync(
                process.platform === 'win32' ? 'where androiddeployqt' : 'which androiddeployqt',
                { encoding: 'utf-8', stdio: 'pipe' }
            ).trim();
            const first = result.split('\n')[0].trim();
            if (first && fs.existsSync(first)) { return first; }
        } catch {
            // not found
        }

        return undefined;
    }

    private getAndroidSdkPath(): string | undefined {
        const config = vscode.workspace.getConfiguration('qt');
        const sdkPath = config.get<string>('androidSdkPath');
        if (sdkPath && fs.existsSync(sdkPath)) { return sdkPath; }

        // Check env var
        const envSdk = process.env.ANDROID_SDK || process.env.ANDROID_HOME;
        if (envSdk && fs.existsSync(envSdk)) { return envSdk; }

        // Common paths
        const commonPaths = [
            path.join(process.env.HOME || '', 'Android', 'Sdk'),
            path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Android', 'Sdk'),
            '/usr/lib/android-sdk',
            '/opt/android-sdk'
        ];
        for (const p of commonPaths) {
            if (p && fs.existsSync(p)) { return p; }
        }

        return undefined;
    }

    getAndroidNdkPath(): string | undefined {
        const config = vscode.workspace.getConfiguration('qt');
        const ndkPath = config.get<string>('androidNdkPath');
        if (ndkPath && fs.existsSync(ndkPath)) { return ndkPath; }

        // Check env var
        const envNdk = process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK;
        if (envNdk && fs.existsSync(envNdk)) { return envNdk; }

        // Try to find inside SDK
        const sdkPath = this.getAndroidSdkPath();
        if (sdkPath) {
            const ndkBundle = path.join(sdkPath, 'ndk-bundle');
            if (fs.existsSync(ndkBundle)) { return ndkBundle; }
            const ndkDir = path.join(sdkPath, 'ndk');
            if (fs.existsSync(ndkDir)) {
                const versions = fs.readdirSync(ndkDir).filter(d => /^\d/.test(d));
                if (versions.length > 0) {
                    return path.join(ndkDir, versions.sort().reverse()[0]);
                }
            }
        }

        // Common paths
        const commonPaths = [
            path.join(process.env.HOME || '', 'Android', 'ndk'),
            path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Android', 'ndk'),
            '/usr/lib/android-ndk',
            '/opt/android-ndk'
        ];
        for (const p of commonPaths) {
            if (p && fs.existsSync(p)) { return p; }
        }

        return undefined;
    }

    private findNdkInSdk(sdkPath: string): string | undefined {
        const ndkBundle = path.join(sdkPath, 'ndk-bundle');
        if (fs.existsSync(ndkBundle)) { return ndkBundle; }
        const ndkDir = path.join(sdkPath, 'ndk');
        if (fs.existsSync(ndkDir)) {
            const versions = fs.readdirSync(ndkDir).filter(d => /^\d/.test(d));
            if (versions.length > 0) {
                return path.join(ndkDir, versions.sort().reverse()[0]);
            }
        }
        return undefined;
    }

    private findAdb(): string | undefined {
        const sdkPath = this.getAndroidSdkPath();
        if (sdkPath) {
            const adbPath = path.join(sdkPath, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
            if (fs.existsSync(adbPath)) { return adbPath; }
        }

        try {
            const result = execSync(
                process.platform === 'win32' ? 'where adb' : 'which adb',
                { encoding: 'utf-8', stdio: 'pipe' }
            ).trim();
            const first = result.split('\n')[0].trim();
            if (first && fs.existsSync(first)) { return first; }
        } catch {
            // not found
        }

        return undefined;
    }

    private listDevices(adbPath: string): AndroidDevice[] {
        try {
            const output = execSync(`"${adbPath}" devices -l`, { encoding: 'utf-8', stdio: 'pipe' });
            const devices: AndroidDevice[] = [];
            const lines = output.split('\n');
            for (const line of lines) {
                const match = line.match(/^(\S+)\s+(\w+)\s+(.*)$/);
                if (match && match[2] === 'device') {
                    const id = match[1];
                    const props = match[3];
                    const nameMatch = props.match(/model:(\S+)/);
                    devices.push({
                        id,
                        name: nameMatch ? nameMatch[1] : id,
                        status: 'connected'
                    });
                }
            }
            return devices;
        } catch {
            return [];
        }
    }

    private findDeploymentSettings(buildDir: string, projectName: string): string | undefined {
        const candidates = [
            path.join(buildDir, 'android_deployment_settings.json'),
            path.join(buildDir, 'android-build', 'android_deployment_settings.json'),
            path.join(buildDir, projectName, 'android_deployment_settings.json'),
            path.join(buildDir, 'android', 'android_deployment_settings.json')
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) { return p; }
        }
        return undefined;
    }

    private findApkFile(buildDir: string): string | undefined {
        const searchDirs = [
            buildDir,
            path.join(buildDir, 'android_build'),
            path.join(buildDir, 'android-build')
        ];
        for (const dir of searchDirs) {
            if (!fs.existsSync(dir)) { continue; }
            try {
                const entries = fs.readdirSync(dir, { recursive: true }) as string[];
                for (const entry of entries) {
                    if (entry.endsWith('.apk')) {
                        return path.join(dir, entry);
                    }
                }
            } catch {
                // ignore
            }
        }
        return undefined;
    }

    private findAabFile(buildDir: string): string | undefined {
        const searchDirs = [
            buildDir,
            path.join(buildDir, 'android_build'),
            path.join(buildDir, 'android-build')
        ];
        for (const dir of searchDirs) {
            if (!fs.existsSync(dir)) { continue; }
            try {
                const entries = fs.readdirSync(dir, { recursive: true }) as string[];
                for (const entry of entries) {
                    if (entry.endsWith('.aab')) {
                        return path.join(dir, entry);
                    }
                }
            } catch {
                // ignore
            }
        }
        return undefined;
    }

    private async runAndroidDeployQt(
        executable: string,
        args: string[],
        outputDir: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(executable, args, { shell: true });
            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data: Buffer) => {
                const text = data.toString('utf-8');
                stdout += text;
                this.outputChannel.append(text);
            });

            child.stderr?.on('data', (data: Buffer) => {
                const text = data.toString('utf-8');
                stderr += text;
                this.outputChannel.append(text);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    const apk = this.findApkFile(outputDir);
                    if (apk) {
                        void vscode.window.showInformationMessage(
                            `APK built successfully: ${path.basename(apk)}`,
                            'Install APK'
                        ).then(choice => {
                            if (choice === 'Install APK') {
                                void this.installApk();
                            }
                        });
                    } else {
                        void vscode.window.showInformationMessage('APK build completed.');
                    }
                    resolve();
                } else {
                    void vscode.window.showErrorMessage(
                        `APK build failed (code ${code}). Check Output → Qt C++ Tools for details.`
                    );
                    reject(new Error(`androiddeployqt exited with code ${code}`));
                }
            });

            child.on('error', (err) => {
                void vscode.window.showErrorMessage(`Failed to run androiddeployqt: ${err.message}`);
                reject(err);
            });
        });
    }
}
